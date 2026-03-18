const Database = require("better-sqlite3");
const os = require("os");
const path = require("path");
const { app } = require("electron");
const logger = require("../logger");
const { seedDatabase, isDatabaseSeeded } = require("./seed-data");

let db = null;

function getUserDataPath() {
  if (app && typeof app.getPath === "function") {
    return app.getPath("userData");
  }
  return path.join(os.homedir(), "Library", "Application Support", "bloom-cafe-pos");
}

function getDB() {
  if (db) return db;
  const dbPath = path.join(getUserDataPath(), "bloom-cafe.db");
  logger.info("DATABASE_OPEN", { path: dbPath });
  db = new Database(dbPath);
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (_e) {}
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = FULL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER DEFAULT 0,
      last_migration TEXT
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      half_price REAL,
      has_variants INTEGER DEFAULT 0,
      available INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE(category_id, name)
    );
    CREATE TABLE IF NOT EXISTS addons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS product_addons (
      product_id INTEGER NOT NULL,
      addon_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (product_id, addon_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (addon_id) REFERENCES addons(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      stock INTEGER DEFAULT 0,
      low_stock_alert INTEGER DEFAULT 5,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      total REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_no TEXT UNIQUE NOT NULL,
      order_id TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      total REAL NOT NULL DEFAULT 0,
      payment_mode TEXT DEFAULT 'Cash',
      bill_date TEXT NOT NULL,
      time TEXT,
      idempotency_key TEXT UNIQUE,
      print_status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bill_sequences (
      bill_date TEXT PRIMARY KEY,
      last_number INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log ( 
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      action TEXT NOT NULL, 
      entity_type TEXT NOT NULL, 
      entity_id TEXT NOT NULL, 
      before_value TEXT, 
      after_value TEXT, 
      created_at TEXT DEFAULT (datetime('now')) 
    ); 
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at); 
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action); 
    CREATE TABLE IF NOT EXISTS inventory_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      quantity_change INTEGER NOT NULL,
      reason TEXT,
      bill_no TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(bill_date);
    CREATE INDEX IF NOT EXISTS idx_bills_order ON bills(order_id);
    CREATE INDEX IF NOT EXISTS idx_bills_idempotency ON bills(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_product_addons_product ON product_addons(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_addons_addon ON product_addons(addon_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_audit_bill ON inventory_audit_log(bill_no);
    CREATE INDEX IF NOT EXISTS idx_bill_sequences_date ON bill_sequences(bill_date); 
  `);
  // Note: ALTER TABLE schema changes (time, idempotency_key, print_status columns)
  // are now handled by the migration runner in migrate.js (v2). They no longer
  // run on every startup — only once, tracked by migration_version.

  try {
    const existingSeqs = db.prepare("SELECT COUNT(*) as c FROM bill_sequences").get(); 
    if (existingSeqs.c === 0) { 
      const dates = db.prepare( 
        "SELECT bill_date, COUNT(*) as cnt FROM bills GROUP BY bill_date" 
      ).all(); 
      const insertSeq = db.prepare( 
        "INSERT OR IGNORE INTO bill_sequences (bill_date, last_number) VALUES (?, ?)" 
      ); 
      const tx = db.transaction(() => { 
        dates.forEach(row => insertSeq.run(row.bill_date, row.cnt)); 
      }); 
      tx(); 
      logger.info("DATABASE_SEQUENCES_BACKFILL", { dates: dates.length }); 
    } 
  } catch (e) { 
    console.error("[DB] Sequence backfill failed:", e.message); 
  } 

  try { 
    db.prepare("DELETE FROM audit_log WHERE created_at < datetime('now', '-30 days')").run(); 
  } catch(e) {} 

  const ins = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  ins.run("numberOfTables", "6");
  ins.run("inventoryEnabled", "true");
  
  // Initialize migration version if not exists
  try {
    db.prepare("INSERT OR IGNORE INTO migration_version (id, version) VALUES (1, 0)").run();
  } catch (e) {
    // Table may not exist yet, will be created on first migration
  }
  
  // Check if database needs seeding (only for fresh installations)
  try {
    if (!isDatabaseSeeded(db)) {
      const categoryCount = db.prepare("SELECT COUNT(*) as count FROM categories").get().count;
      const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get().count;
      
      // Only seed if database is completely empty
      if (categoryCount === 0 && productCount === 0) {
        seedDatabase(db);
        logger.info("DATABASE_SEEDED_FRESH_INSTALL");
      }
    }
  } catch (e) {
    logger.warn("DATABASE_SEED_CHECK_FAILED", { error: e.message });
    // Don't fail initialization if seeding fails
  }
  
  return db;
}

function closeDB() {
  if (db) { db.close(); db = null; }
}

/**
 * Verify database integrity at startup
 * Checks for corruption, missing tables, and constraint violations
 */
function verifyDatabaseIntegrity() {
  try {
    const database = getDB();
    
    // Check PRAGMA integrity_check
    const integrityResult = database.prepare("PRAGMA integrity_check").all();
    if (integrityResult.length > 0 && integrityResult[0].integrity_check !== "ok") {
      console.error("[DB INTEGRITY] Database corruption detected:", integrityResult);
      return {
        valid: false,
        error: "Database corruption detected",
        details: integrityResult
      };
    }
    
    // Verify foreign key constraints
    const fkCheck = database.prepare("PRAGMA foreign_key_check").all();
    if (fkCheck.length > 0) {
      console.error("[DB INTEGRITY] Foreign key violations detected:", fkCheck);
      return {
        valid: false,
        error: "Foreign key constraint violations",
        details: fkCheck
      };
    }
    
    // Verify critical tables exist
    const requiredTables = [
      "categories", "products", "addons", "product_addons",
      "inventory", "orders", "bills", "settings", "bill_sequences"
    ];
    
    for (const table of requiredTables) {
      const tableExists = database.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table);
      
      if (!tableExists) {
        console.error(`[DB INTEGRITY] Required table missing: ${table}`);
        return {
          valid: false,
          error: `Required table missing: ${table}`
        };
      }
    }
    
    // Verify critical indexes exist
    const requiredIndexes = [
      "idx_bills_date", "idx_bills_order", "idx_products_category",
      "idx_product_addons_product", "idx_product_addons_addon"
    ];
    
    for (const index of requiredIndexes) {
      const indexExists = database.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get(index);
      
      if (!indexExists) {
        console.warn(`[DB INTEGRITY] Index missing (will recreate): ${index}`);
        // Indexes can be recreated, so this is a warning not an error
      }
    }
    
    console.log("[DB INTEGRITY] Database integrity verified successfully");
    return { valid: true };
  } catch (error) {
    console.error("[DB INTEGRITY] Verification failed:", error);
    return {
      valid: false,
      error: error.message
    };
  }
}

module.exports = { getDB, closeDB, getUserDataPath, verifyDatabaseIntegrity };
