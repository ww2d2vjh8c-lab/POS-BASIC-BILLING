'use strict';

const path = require("path");
const fs = require("fs");
const { getDB, getUserDataPath } = require("./database");
const logger = require("../logger");

/**
 * Migration version tracking
 * Ensures migrations run only once and can be rolled back if needed
 */
function getMigrationVersion() {
  try {
    const db = getDB();
    const row = db.prepare("SELECT version FROM migration_version WHERE id = 1").get();
    return row ? row.version : 0;
  } catch (e) {
    console.warn("[MIGRATE] Could not read migration version:", e.message);
    return 0;
  }
}

/**
 * Records the schema version. Throws on failure so the surrounding migration
 * transaction rolls back and is retried on the next start.
 */
function setMigrationVersion(version) {
  getDB().prepare("INSERT OR REPLACE INTO migration_version (id, version, last_migration) VALUES (1, ?, datetime('now'))").run(version);
}

/**
 * Adds a column unless it is already there. Any other failure (disk error,
 * locked file, bad SQL) is thrown, so a migration can never be marked as done
 * while its column is missing.
 */
function addColumnIfMissing(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
  if (exists) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function migrateProductAddons(db, userData) {
  const migrated = db.prepare("SELECT value FROM settings WHERE key = 'product_addons_migrated'").get();
  if (migrated) {
    logger.info("MIGRATE_PRODUCT_ADDONS_ALREADY_MIGRATED");
    return;
  }

  const menuPath = path.join(userData, "menu.json");
  if (fs.existsSync(menuPath)) {
    const tx = db.transaction(() => {
      const menu = JSON.parse(fs.readFileSync(menuPath, "utf-8"));
      const insAddon = db.prepare("INSERT OR IGNORE INTO addons (name, price) VALUES (?, ?)");
      const getProduct = db.prepare(`
        SELECT p.id
        FROM products p
        INNER JOIN categories c ON c.id = p.category_id
        WHERE c.name = ? AND p.name = ?
      `);
      const getAddon = db.prepare("SELECT id FROM addons WHERE name = ?");
      const linkAddon = db.prepare("INSERT OR IGNORE INTO product_addons (product_id, addon_id) VALUES (?, ?)");

      (menu.categories || []).forEach(cat => {
        (cat.products || []).forEach(product => {
          const productRow = getProduct.get(cat.name, product.name);
          if (!productRow) return;

          (product.addons || []).forEach(addon => {
            insAddon.run(addon.name, addon.price || 0);
            const addonRow = getAddon.get(addon.name);
            if (addonRow) {
              linkAddon.run(productRow.id, addonRow.id);
            }
          });
        });
      });

      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("product_addons_migrated", "true");
      logger.info("MIGRATE_PRODUCT_ADDONS_MIGRATED");
    });

    try {
      tx();
    } catch (err) {
      console.error("[MIGRATE] Migration failed, will retry on next start:", err.message);
    }
  }
}

/**
 * Migration v5: Money and stock bookkeeping on bills.
 * - discount_amount: the discount given, so subtotal = total + discount_amount
 *   and reports / reprints show it (previously it was applied and forgotten).
 * - stock_deducted: 1 if this bill took items out of stock, 0 if inventory
 *   tracking was off. NULL for older bills (unknown). Deleting a bill uses it
 *   so stock that was never taken out is never "restored".
 */
function runMigrationV5(db) {
  logger.info("MIGRATE_V5_START");
  db.transaction(() => {
    addColumnIfMissing(db, "bills", "discount_amount", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "bills", "stock_deducted", "INTEGER");
    setMigrationVersion(5);
    logger.info("MIGRATE_V5_COMPLETE");
  })();
}

/**
 * Migration v4: Persist cash_received on bills.
 * - Adds cash_received REAL column to bills (nullable — only set for Cash payments).
 */
function runMigrationV4(db) {
  logger.info("MIGRATE_V4_START");
  db.transaction(() => {
    addColumnIfMissing(db, "bills", "cash_received", "REAL");
    setMigrationVersion(4);
    logger.info("MIGRATE_V4_COMPLETE");
  })();
}

/**
 * Migration v3: Product-linked inventory.
 * - Adds product_id FK to inventory (nullable, ON DELETE SET NULL).
 * - Adds archived flag to inventory (soft-delete support).
 * - Adds source column to inventory_audit_log.
 */
function runMigrationV3(db) {
  logger.info("MIGRATE_V3_START");
  db.transaction(() => {
    addColumnIfMissing(db, "inventory", "product_id", "INTEGER REFERENCES products(id) ON DELETE SET NULL");
    addColumnIfMissing(db, "inventory", "archived", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "inventory_audit_log", "source", "TEXT DEFAULT 'manual'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_inventory_archived ON inventory(archived)");

    setMigrationVersion(3);
    logger.info("MIGRATE_V3_COMPLETE");
  })();
}

/**
 * Migration v2: Schema cleanup.
 * - Drops the unused bill_number_sequence table (replaced by bill_sequences).
 * - Applies any ADD COLUMN statements that were previously done via try/catch.
 *   Running them here means they only fire once and are tracked properly.
 */
function runMigrationV2(db) {
  logger.info("MIGRATE_V2_START");
  db.transaction(() => {
    // Drop the zombie table that was replaced by bill_sequences
    db.exec("DROP TABLE IF EXISTS bill_number_sequence");

    // These columns were previously added via try/catch ALTER TABLE on every
    // startup. Now they run exactly once, tracked by migration version.
    // (SQLite cannot ADD a UNIQUE column; the base schema declares it UNIQUE.)
    addColumnIfMissing(db, "bills", "time", "TEXT");
    addColumnIfMissing(db, "bills", "idempotency_key", "TEXT");
    addColumnIfMissing(db, "bills", "print_status", "TEXT DEFAULT 'pending'");

    setMigrationVersion(2);
    logger.info("MIGRATE_V2_COMPLETE");
  })();
}

/** Schema migrations, applied in order. Each one runs in its own transaction. */
const SCHEMA_MIGRATIONS = [
  [2, runMigrationV2],
  [3, runMigrationV3],
  [4, runMigrationV4],
  [5, runMigrationV5],
];

/** v1: one-time import of the legacy menu.json / inventory.json files. */
function importLegacyJSON(db, userData) {
  logger.info("MIGRATE_JSON_TO_SQLITE_START", { version: 1 });

  const migrate = db.transaction(() => {
    const menuPath = path.join(userData, "menu.json");
    if (fs.existsSync(menuPath)) {
      try {
        const menu = JSON.parse(fs.readFileSync(menuPath, "utf-8"));
        const insCat = db.prepare("INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)");
        const getCat = db.prepare("SELECT id FROM categories WHERE name = ?");
        const insProd = db.prepare("INSERT OR IGNORE INTO products (category_id, name, price, half_price, has_variants, available) VALUES (?, ?, ?, ?, ?, ?)");
        const insAddon = db.prepare("INSERT OR IGNORE INTO addons (name, price) VALUES (?, ?)");
        (menu.categories || []).forEach((cat, i) => {
          insCat.run(cat.name, i);
          const row = getCat.get(cat.name);
          (cat.products || []).forEach(p => {
            insProd.run(
              row.id,
              p.name,
              p.price || 0,
              p.halfPrice || null,
              p.hasVariants ? 1 : 0,
              p.unavailable === true ? 0 : p.available !== false ? 1 : 0
            );
          });
        });
        (menu.addons || []).forEach(a => insAddon.run(a.name, a.price || 0));
        logger.info("MIGRATE_MENU_MIGRATED", { categories: menu.categories?.length || 0, products: menu.categories?.reduce((sum, cat) => sum + (cat.products?.length || 0), 0) || 0 });
      } catch (e) {
        logger.error("MIGRATE_MENU_FAILED", { error: e.message, stack: e.stack, menuPath });
        throw new Error(`Menu migration failed: ${e.message}. Check menu.json format and permissions.`);
      }
    }

    const invPath = path.join(userData, "inventory.json");
    if (fs.existsSync(invPath)) {
      try {
        const inv = JSON.parse(fs.readFileSync(invPath, "utf-8"));
        const insInv = db.prepare("INSERT OR IGNORE INTO inventory (name, stock, low_stock_alert) VALUES (?, ?, ?)");
        (inv.items || []).forEach(i => insInv.run(i.name, i.stock || 0, i.lowStock || 5));
        logger.info("MIGRATE_INVENTORY_MIGRATED", { items: inv.items?.length || 0 });
      } catch (e) {
        logger.error("MIGRATE_INVENTORY_FAILED", { error: e.message, stack: e.stack, invPath });
        throw new Error(`Inventory migration failed: ${e.message}. Check inventory.json format and permissions.`);
      }
    }

    // Mark migration as complete
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("migration_done", "true");
    setMigrationVersion(1);
    logger.info("MIGRATE_COMPLETE", { version: 1 });
  });

  migrate();
}

/**
 * Brings the database up to the current schema. Never throws: a failed step
 * is logged and retried on the next launch, and the app keeps running.
 */
function migrateFromJSON() {
  const db = getDB();
  const currentVersion = getMigrationVersion();
  const userData = getUserDataPath();

  if (currentVersion === 0) {
    try {
      importLegacyJSON(db, userData);
    } catch (error) {
      // A damaged legacy file must not stop the schema migrations below:
      // without them every sales query fails. The transaction rolled back.
      logger.error("MIGRATE_JSON_IMPORT_FAILED", { error: error.message, stack: error.stack, userData });
    }
  } else {
    logger.info("MIGRATE_SKIP", { currentVersion, reason: "Already migrated" });
  }

  for (const [version, run] of SCHEMA_MIGRATIONS) {
    if (getMigrationVersion() >= version) continue;
    try {
      run(db);
    } catch (error) {
      // Rolled back; later migrations may depend on this one, so stop here
      // and retry everything from this version on the next launch.
      logger.error(`MIGRATE_V${version}_FAILED`, { error: error.message, stack: error.stack });
      break;
    }
  }

  // Run product addons migration (separate transaction)
  try {
    const addonMigrate = db.transaction(() => {
      migrateProductAddons(db, userData);
    });
    addonMigrate();
  } catch (error) {
    logger.error("MIGRATE_ADDONS_FAILED", {
      error: error.message,
      stack: error.stack,
      userData
    });
    // Don't throw - this is not critical
  }
}

module.exports = { migrateFromJSON, getMigrationVersion, setMigrationVersion, addColumnIfMissing };
