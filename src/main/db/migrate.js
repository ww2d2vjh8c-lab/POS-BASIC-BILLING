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

function setMigrationVersion(version) {
  try {
    const db = getDB();
    db.prepare("INSERT OR REPLACE INTO migration_version (id, version, last_migration) VALUES (1, ?, datetime('now'))").run(version);
  } catch (e) {
    console.error("[MIGRATE] Failed to set migration version:", e.message);
  }
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
 * Migration v3: Product-linked inventory.
 * - Adds product_id FK to inventory (nullable, ON DELETE SET NULL).
 * - Adds archived flag to inventory (soft-delete support).
 * - Adds source column to inventory_audit_log.
 */
function runMigrationV3(db) {
  logger.info("MIGRATE_V3_START");
  db.transaction(() => {
    const alterStatements = [
      "ALTER TABLE inventory ADD COLUMN product_id INTEGER REFERENCES products(id) ON DELETE SET NULL",
      "ALTER TABLE inventory ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE inventory_audit_log ADD COLUMN source TEXT DEFAULT 'manual'",
    ];
    for (const sql of alterStatements) {
      try { db.exec(sql); } catch (_e) { /* column already exists — safe to ignore */ }
    }
    try {
      db.exec("CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_inventory_archived ON inventory(archived)");
    } catch (_e) {}

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
    const alterStatements = [
      "ALTER TABLE bills ADD COLUMN time TEXT",
      "ALTER TABLE bills ADD COLUMN idempotency_key TEXT UNIQUE",
      "ALTER TABLE bills ADD COLUMN print_status TEXT DEFAULT 'pending'",
    ];
    for (const sql of alterStatements) {
      try { db.exec(sql); } catch (_e) { /* column already exists */ }
    }

    setMigrationVersion(2);
    logger.info("MIGRATE_V2_COMPLETE");
  })();
}

function migrateFromJSON() {
  const db = getDB();
  const currentVersion = getMigrationVersion();
  const userData = getUserDataPath();

  if (currentVersion === 0) {
    logger.info("MIGRATE_JSON_TO_SQLITE_START", { version: 1 });
    
    const migrate = db.transaction(() => {
      try {
        const menuPath = path.join(userData, "menu.json");
        if (fs.existsSync(menuPath)) {
          try {
            const menu = JSON.parse(fs.readFileSync(menuPath, "utf-8"));
            const insCat = db.prepare("INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)");
            const insProd = db.prepare("INSERT OR IGNORE INTO products (category_id, name, price, half_price, has_variants, available) VALUES (?, ?, ?, ?, ?, ?)");
            const insAddon = db.prepare("INSERT OR IGNORE INTO addons (name, price) VALUES (?, ?)");
            (menu.categories || []).forEach((cat, i) => {
              insCat.run(cat.name, i);
              const row = db.prepare("SELECT id FROM categories WHERE name = ?").get(cat.name);
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
            logger.error("MIGRATE_MENU_FAILED", { 
              error: e.message, 
              stack: e.stack,
              menuPath,
              categoriesCount: menu.categories?.length || 0
            });
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
            logger.error("MIGRATE_INVENTORY_FAILED", { 
              error: e.message, 
              stack: e.stack,
              invPath,
              itemsCount: inv.items?.length || 0
            });
            throw new Error(`Inventory migration failed: ${e.message}. Check inventory.json format and permissions.`);
          }
        }
        
        // Mark migration as complete
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("migration_done", "true");
        setMigrationVersion(1);
        logger.info("MIGRATE_COMPLETE", { version: 1 });
      } catch (error) {
        logger.error("MIGRATE_TRANSACTION_ROLLBACK", { 
          error: error.message, 
          stack: error.stack,
          operation: "JSON to SQLite migration",
          version: 1
        });
        throw new Error(`Migration transaction failed and rolled back: ${error.message}. Database remains in previous state.`);
      }
    });
    
    try {
      migrate();
    } catch (error) {
      logger.error("MIGRATE_FINAL_FAILED", { 
        error: error.message, 
        stack: error.stack,
        currentVersion,
        userData
      });
      throw new Error(`Migration failed completely: ${error.message}. Please restart the application.`);
    }
  } else {
    logger.info("MIGRATE_SKIP", { currentVersion, reason: "Already migrated" });
  }

  // v2 — schema cleanup (idempotent: only runs when currentVersion < 2)
  const versionAfterV1 = getMigrationVersion();
  if (versionAfterV1 < 2) {
    try {
      runMigrationV2(db);
    } catch (error) {
      logger.error("MIGRATE_V2_FAILED", { error: error.message, stack: error.stack });
      // Non-critical: the app still functions without the cleanup.
      // Will retry on next launch.
    }
  }

  // v3 — product-linked inventory (idempotent: only runs when currentVersion < 3)
  const versionAfterV2 = getMigrationVersion();
  if (versionAfterV2 < 3) {
    try {
      runMigrationV3(db);
    } catch (error) {
      logger.error("MIGRATE_V3_FAILED", { error: error.message, stack: error.stack });
      // Non-critical: the app still functions without the new columns.
      // Will retry on next launch.
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

module.exports = { migrateFromJSON, getMigrationVersion, setMigrationVersion };
