'use strict';

const { getDB } = require("./database");
const { roundMoney } = require("../validator");

/** YYYY-MM-DD in local time (bills are stored by local business date, not UTC). */
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Strips the "(Half)" / "(Full)" variant suffix to get the inventory item name. */
function baseItemName(name) {
  return String(name || "").replace(/\s*\(Half\)|\s*\(Full\)/gi, "").trim();
}

// Prepared statements for hot paths (every cart change / sale), cached per
// connection so a reopened database (restore, recovery) gets fresh ones.
const _stmtCache = new WeakMap();
function stmt(sql) {
  const db = getDB();
  let cache = _stmtCache.get(db);
  if (!cache) { cache = new Map(); _stmtCache.set(db, cache); }
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}

/**
 * Calculates the total cost of a cart items array, rounded to paise.
 * Single source of truth — used by all IPC handlers that touch cart totals.
 */
function calculateCartTotal(items) {
  if (!Array.isArray(items)) return 0;
  return roundMoney(items.reduce((acc, item) => {
    const addonsTotal = Array.isArray(item.addons)
      ? item.addons.reduce((a, ad) => a + (ad.price || 0), 0)
      : 0;
    return acc + ((item.price || 0) + addonsTotal) * (item.quantity || 0);
  }, 0));
}

/**
 * Returns the current stock for a single inventory item by name (case-insensitive).
 * Returns null if the item is not tracked in inventory (no row, or archived).
 */
function getInventoryStockByName(name) {
  const row = stmt(
    "SELECT stock FROM inventory WHERE LOWER(name) = LOWER(?) AND archived = 0"
  ).get(name);
  return row ? row.stock : null;
}

function readMenu() { 
  const db = getDB(); 
 
  const rows = db.prepare(` 
    SELECT 
      c.id as cat_id, 
      c.name as cat_name, 
      c.sort_order as cat_sort, 
      p.id as prod_id, 
      p.name as prod_name, 
      p.price, 
      p.half_price, 
      p.has_variants, 
      p.available, 
      p.sort_order as prod_sort, 
      a.name as addon_name, 
      a.price as addon_price 
    FROM categories c 
    LEFT JOIN products p ON p.category_id = c.id 
    LEFT JOIN product_addons pa ON pa.product_id = p.id 
    LEFT JOIN addons a ON a.id = pa.addon_id 
    ORDER BY c.sort_order ASC, c.name ASC, p.sort_order ASC, p.name ASC, a.name ASC 
  `).all(); 
 
  // Assemble nested structure from flat rows (one row per product × addon)
  const catMap = new Map();
  const productMap = new Map(); // prod_id → product, so assembly stays O(rows)

  rows.forEach(row => {
    if (!catMap.has(row.cat_id)) {
      catMap.set(row.cat_id, { name: row.cat_name, products: [] });
    }
    if (!row.prod_id) return; // Category exists but has no products

    const cat = catMap.get(row.cat_id);
    let product = productMap.get(row.prod_id);
    if (!product) {
      product = { 
        name: row.prod_name, 
        price: row.price, 
        halfPrice: row.half_price, 
        hasVariants: row.has_variants === 1, 
        available: row.available === 1, 
        addons: []
      };
      productMap.set(row.prod_id, product);
      cat.products.push(product);
    }
    if (row.addon_name) { 
      product.addons.push({ name: row.addon_name, price: row.addon_price }); 
    } 
  }); 
 
  const allAddons = db.prepare("SELECT name, price FROM addons ORDER BY name").all(); 
 
  return { 
    categories: Array.from(catMap.values()), 
    addons: allAddons.map(a => ({ name: a.name, price: a.price })) 
  }; 
 }

function addCategory(name) {
  getDB().prepare("INSERT INTO categories (name) VALUES (?)").run(name);
}

function renameCategory(oldName, newName) {
  getDB().prepare("UPDATE categories SET name = ? WHERE name = ?").run(newName, oldName);
}

function deleteCategory(name) {
  getDB().prepare("DELETE FROM categories WHERE name = ?").run(name);
}

function getCategoryId(name) {
  const row = getDB().prepare("SELECT id FROM categories WHERE name = ?").get(name);
  if (!row) throw new Error("Category not found: " + name);
  return row.id;
}

function getProductId(categoryName, productName) {
  const row = getDB().prepare(`
    SELECT p.id
    FROM products p
    INNER JOIN categories c ON c.id = p.category_id
    WHERE c.name = ? AND p.name = ?
  `).get(categoryName, productName);
  if (!row) throw new Error("Product not found: " + productName);
  return row.id;
}

/** Inserts a product and its add-ons in one transaction; returns the new product id. */
function addProduct(categoryName, product) {
  const db = getDB();
  const catId = getCategoryId(categoryName);
  return db.transaction(() => {
    const inserted = db.prepare("INSERT INTO products (category_id, name, price, half_price, has_variants, available) VALUES (?, ?, ?, ?, ?, ?)").run(
      catId,
      product.name,
      product.price || 0,
      product.halfPrice || null,
      product.hasVariants ? 1 : 0,
      product.unavailable === true ? 0 : 1
    );

    if (Array.isArray(product.addons) && product.addons.length > 0) {
      const insertAddon = db.prepare("INSERT OR IGNORE INTO addons (name, price) VALUES (?, ?)");
      const getAddonId = db.prepare("SELECT id FROM addons WHERE name = ?");
      const linkAddon = db.prepare("INSERT OR IGNORE INTO product_addons (product_id, addon_id) VALUES (?, ?)");
      product.addons.forEach(addon => {
        insertAddon.run(addon.name, addon.price || 0);
        const addonRow = getAddonId.get(addon.name);
        if (addonRow) {
          linkAddon.run(inserted.lastInsertRowid, addonRow.id);
        }
      });
    }
    return Number(inserted.lastInsertRowid);
  })();
}

function editProductPrice(categoryName, productName, price, halfPrice) {
  const db = getDB();
  const catId = getCategoryId(categoryName);
  db.prepare("UPDATE products SET price = ?, half_price = ? WHERE category_id = ? AND name = ?").run(price, halfPrice || null, catId, productName);
}

function deleteProduct(categoryName, productName) {
  const db = getDB();
  const catId = getCategoryId(categoryName);
  db.prepare("DELETE FROM products WHERE category_id = ? AND name = ?").run(catId, productName);
}

function toggleProductAvailability(categoryName, productName) {
  const db = getDB();
  const catId = getCategoryId(categoryName);
  db.prepare("UPDATE products SET available = CASE WHEN available = 1 THEN 0 ELSE 1 END WHERE category_id = ? AND name = ?").run(catId, productName);
}

function addAddon(categoryName, productName, addon) {
  const db = getDB();
  const productId = getProductId(categoryName, productName);
  const tx = db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO addons (name, price) VALUES (?, ?)").run(addon.name, addon.price || 0);
    const addonRow = db.prepare("SELECT id FROM addons WHERE name = ?").get(addon.name);
    if (!addonRow) {
      throw new Error("Addon not found after insert: " + addon.name);
    }
    db.prepare("INSERT OR IGNORE INTO product_addons (product_id, addon_id) VALUES (?, ?)").run(productId, addonRow.id);
  });
  tx();
}

function removeAddon(categoryName, productName, name) {
  const db = getDB();
  const productId = getProductId(categoryName, productName);
  const tx = db.transaction(() => {
    const addonRow = db.prepare("SELECT id FROM addons WHERE name = ?").get(name);
    if (!addonRow) return;
    db.prepare("DELETE FROM product_addons WHERE product_id = ? AND addon_id = ?").run(productId, addonRow.id);
    const stillLinked = db.prepare("SELECT 1 FROM product_addons WHERE addon_id = ? LIMIT 1").get(addonRow.id);
    if (!stillLinked) {
      db.prepare("DELETE FROM addons WHERE id = ?").run(addonRow.id);
    }
  });
  tx();
}

// ── Inventory audit log ───────────────────────────────────────────────────────

/**
 * Write a single entry to inventory_audit_log.
 * Never throws — audit must not break the caller.
 */
function writeInventoryAuditLog(itemName, delta, action, source, billNo) {
  try {
    stmt(`
      INSERT INTO inventory_audit_log (item_name, quantity_change, reason, source, bill_no)
      VALUES (?, ?, ?, ?, ?)
    `).run(itemName, delta, action || 'adjusted', source || 'manual', billNo || null);
  } catch (e) {
    console.error('[INVENTORY_AUDIT] Failed to write:', e.message);
  }
}

/**
 * Read recent inventory audit log entries (default 100).
 */
function getInventoryAuditLog(limit = 100) {
  return getDB().prepare(
    "SELECT * FROM inventory_audit_log ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
}

// ── Inventory CRUD ────────────────────────────────────────────────────────────

function readInventory() {
  const db = getDB();
  // Join products + categories so we can sort by category and expose the linked flag.
  // Falls back gracefully if product_id / archived columns don't exist yet (pre-v3).
  let items;
  try {
    items = db.prepare(`
      SELECT
        i.name,
        i.stock,
        i.low_stock_alert,
        i.product_id,
        CASE WHEN i.product_id IS NOT NULL THEN 1 ELSE 0 END AS linked,
        COALESCE(c.name, '') AS category_name
      FROM inventory i
      LEFT JOIN products p ON p.id = i.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE i.archived = 0
      ORDER BY COALESCE(c.name, 'zzz') ASC, i.name ASC
    `).all();
  } catch (_e) {
    // Fallback for pre-migration databases
    items = db.prepare("SELECT * FROM inventory ORDER BY name").all();
  }
  return {
    items: items.map(i => ({
      name: i.name,
      stock: i.stock,
      lowStock: i.low_stock_alert,
      productId: i.product_id || null,
      linked: (i.linked === 1) || false,
      categoryName: i.category_name || null,
    }))
  };
}

/** Sets an item's stock. Returns false if no such item exists. */
function updateStock(name, newStock, source) {
  const prev = stmt("SELECT name, stock FROM inventory WHERE LOWER(name) = LOWER(?)").get(name);
  if (!prev) return false;
  stmt("UPDATE inventory SET stock = ?, updated_at = datetime('now') WHERE name = ?").run(newStock, prev.name);
  writeInventoryAuditLog(prev.name, newStock - (prev.stock || 0), 'adjusted', source || 'manual', null);
  return true;
}

function updateLowstock(name, alertAt) {
  getDB().prepare("UPDATE inventory SET low_stock_alert = ?, updated_at = datetime('now') WHERE LOWER(name) = LOWER(?)").run(alertAt, name);
}

/**
 * Makes sure a product has an active inventory row without touching the
 * stock of a row that already exists (adding a product called "Coke" must
 * not wipe out the 50 Cokes already counted in inventory).
 */
function ensureInventoryItem(name, productId, source) {
  const db = getDB();
  const existing = db.prepare("SELECT name FROM inventory WHERE LOWER(name) = LOWER(?)").get(name);
  if (existing) {
    db.prepare(`
      UPDATE inventory
      SET product_id = COALESCE(product_id, ?), archived = 0, updated_at = datetime('now')
      WHERE name = ?
    `).run(productId || null, existing.name);
    return false;
  }
  addInventoryItem({ name, stock: 0, alertAt: 5, product_id: productId || null, source: source || 'auto' });
  return true;
}

function addInventoryItem(item) {
  const db = getDB();
  try {
    db.prepare(`
      INSERT INTO inventory (name, stock, low_stock_alert, product_id, archived)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(name) DO UPDATE SET
        stock = excluded.stock,
        low_stock_alert = excluded.low_stock_alert,
        product_id = COALESCE(excluded.product_id, inventory.product_id),
        archived = 0,
        updated_at = datetime('now')
    `).run(item.name, item.stock ?? 0, item.alertAt ?? 5, item.product_id || null);
  } catch (_e) {
    // Fallback for pre-v3 schema (no product_id / archived columns)
    db.prepare(`
      INSERT INTO inventory (name, stock, low_stock_alert)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        stock = excluded.stock,
        low_stock_alert = excluded.low_stock_alert,
        updated_at = datetime('now')
    `).run(item.name, item.stock ?? 0, item.alertAt ?? 5);
  }
  writeInventoryAuditLog(item.name, item.stock ?? 0, 'created', item.source || 'manual', null);
}

/**
 * Soft-archive an inventory item instead of hard-deleting.
 * Preserves history in inventory_audit_log.
 */
function archiveInventoryItem(name) {
  try {
    getDB().prepare("UPDATE inventory SET archived = 1, updated_at = datetime('now') WHERE LOWER(name) = LOWER(?)").run(name);
    writeInventoryAuditLog(name, 0, 'archived', 'manual', null);
  } catch (e) {
    console.error('[INVENTORY] archiveInventoryItem failed:', e.message);
  }
}

/**
 * Soft-delete — archives instead of hard-deleting to preserve audit history.
 */
function deleteInventoryItem(name) {
  archiveInventoryItem(name);
}

/**
 * Returns sync status: which inventory rows are linked to products,
 * which are unlinked (manual, no matching product), and which products
 * have no inventory row at all.
 */
function getInventorySyncStatus() {
  const db = getDB();

  // Inventory rows with a product_id FK set
  const linked = db.prepare(`
    SELECT i.name, i.stock, i.low_stock_alert, i.product_id,
           p.name AS product_name, c.name AS category_name
    FROM inventory i
    INNER JOIN products p ON p.id = i.product_id
    INNER JOIN categories c ON c.id = p.category_id
    WHERE i.archived = 0 AND i.product_id IS NOT NULL
    ORDER BY c.name, i.name
  `).all().map(r => ({
    name: r.name, stock: r.stock, lowStock: r.low_stock_alert,
    productId: r.product_id, productName: r.product_name, categoryName: r.category_name,
  }));

  // Inventory rows with no product_id (manually added, not connected to menu)
  let unlinked = [];
  try {
    unlinked = db.prepare(`
      SELECT name, stock, low_stock_alert
      FROM inventory
      WHERE archived = 0 AND product_id IS NULL
      ORDER BY name
    `).all().map(r => ({ name: r.name, stock: r.stock, lowStock: r.low_stock_alert }));
  } catch (_e) {
    // Pre-v3: all items are "unlinked"
    unlinked = db.prepare("SELECT name, stock, low_stock_alert FROM inventory ORDER BY name").all()
      .map(r => ({ name: r.name, stock: r.stock, lowStock: r.low_stock_alert }));
  }

  // Products that have no inventory row at all (or only archived rows)
  const missing = db.prepare(`
    SELECT p.id AS productId, p.name AS productName, c.name AS categoryName
    FROM products p
    INNER JOIN categories c ON c.id = p.category_id
    WHERE NOT EXISTS (
      SELECT 1 FROM inventory i
      WHERE LOWER(i.name) = LOWER(p.name) AND i.archived = 0
    )
    ORDER BY c.name, p.name
  `).all();

  return { linked, unlinked, missing };
}

/**
 * For every product with no active inventory row, create one with stock=0.
 */
function syncInventoryToMenu() {
  const db = getDB();
  const missing = db.prepare(`
    SELECT p.id, p.name
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1 FROM inventory i
      WHERE LOWER(i.name) = LOWER(p.name) AND i.archived = 0
    )
  `).all();

  if (missing.length === 0) return { created: 0 };

  const tx = db.transaction(() => {
    missing.forEach(p => {
      addInventoryItem({ name: p.name, stock: 0, alertAt: 5, product_id: p.id, source: 'sync' });
    });
  });
  tx();
  return { created: missing.length };
}

/**
 * Bulk-update stock for multiple items at once (used by Restock mode).
 * All-or-nothing; returns how many items actually exist and were updated.
 */
function bulkUpdateStock(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return { updated: 0 };
  const db = getDB();
  const tx = db.transaction((list) => {
    let updated = 0;
    list.forEach(u => { if (updateStock(u.name, u.stock, 'restock')) updated++; });
    return updated;
  });
  return { updated: tx(updates) };
}

function restoreInventory(items, billNo = null) {
  const db = getDB();
  const update = db.prepare(
    "UPDATE inventory SET stock = stock + ?, updated_at = datetime('now') WHERE LOWER(name) = LOWER(?)"
  );
  const restore = db.transaction((list) => {
    list.forEach(item => {
      const base = baseItemName(item.name);
      const qty = item.quantity || 1;
      if (update.run(qty, base).changes > 0) {
        writeInventoryAuditLog(base, qty, 'restored', 'bill_delete', billNo);
      }
    });
  });
  restore(items);
}

function readSessions() {
  const orders = getDB().prepare("SELECT * FROM orders WHERE status = 'active'").all();
  const sessions = {};
  orders.forEach(o => {
    try { sessions[o.order_id] = JSON.parse(o.items); } catch(e) { sessions[o.order_id] = []; }
  });
  return { date: localDate(), sessions };
}

/**
 * Persists an open cart. A table that was billed earlier still has its
 * orders row (status 'completed'), so the upsert must flip it back to
 * 'active' — otherwise the new cart is not restored after a restart.
 */
function saveSession(orderId, sessionOrItems) {
  const items = Array.isArray(sessionOrItems) ? sessionOrItems : (sessionOrItems?.items || []);
  stmt(`
    INSERT INTO orders (order_id, items, total, status, updated_at)
    VALUES (?, ?, ?, 'active', datetime('now'))
    ON CONFLICT(order_id) DO UPDATE SET
      items = excluded.items, total = excluded.total, status = 'active', updated_at = datetime('now')
  `).run(orderId, JSON.stringify(items), calculateCartTotal(items));
}

function removeSession(orderId) {
  stmt("UPDATE orders SET status = 'completed', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
}

/** Deletes closed carts older than a week (the bills themselves are kept). */
function cleanupOldOrders() {
  return getDB().prepare(
    "DELETE FROM orders WHERE status = 'completed' AND updated_at < datetime('now', '-7 days')"
  ).run().changes;
}

/**
 * All bills for a business date. `total` is what the customer paid (after
 * discount); `subtotal` is the item value before discount.
 */
function readSalesData(date) {
  const db = getDB();
  const bills = db.prepare(`
    SELECT id, bill_no, order_id, items, total, payment_mode, bill_date, time, print_status, created_at,
           cash_received, discount_amount
    FROM bills WHERE bill_date = ? ORDER BY id ASC
  `).all(date);

  const parsed = bills.map(b => {
    const total = roundMoney(b.total);
    const discountAmount = roundMoney(b.discount_amount || 0);
    return {
      id: b.id,
      billNo: b.bill_no,
      bill_no: b.bill_no,
      orderId: b.order_id,
      items: (() => { try { return JSON.parse(b.items); } catch(e) { return []; } })(),
      total,
      subtotal: roundMoney(total + discountAmount),
      discountAmount,
      paymentMode: b.payment_mode,
      billDate: b.bill_date,
      time: b.time || b.created_at,
      printStatus: b.print_status,
      createdAt: b.created_at,
      cashReceived: b.cash_received != null ? b.cash_received : null,
    };
  });

  const totalRevenue  = roundMoney(parsed.reduce((s, b) => s + (b.total || 0), 0));
  const totalDiscount = roundMoney(parsed.reduce((s, b) => s + b.discountAmount, 0));
  return {
    date,
    bills: parsed,
    totalRevenue,
    totalDiscount,
    grossRevenue: roundMoney(totalRevenue + totalDiscount),
    totalBills: parsed.length
  };
}

function formatBillNo(date, n) {
  return "BC-" + date.replace(/-/g, "") + "-" + n;
}

/**
 * Takes the next bill number for a date. Must run inside the finalize
 * transaction. If the counter has fallen behind the bills table (restored
 * or hand-edited database, legacy backfill), it jumps past the highest
 * number in use instead of failing every sale on a UNIQUE violation.
 */
function generateBillNo(date) {
  stmt(`
    INSERT INTO bill_sequences (bill_date, last_number) VALUES (?, 1)
    ON CONFLICT(bill_date) DO UPDATE SET last_number = last_number + 1
  `).run(date);

  let n = stmt("SELECT last_number FROM bill_sequences WHERE bill_date = ?").get(date).last_number;
  if (stmt("SELECT 1 FROM bills WHERE bill_no = ?").get(formatBillNo(date, n))) {
    const maxUsed = stmt(
      "SELECT COALESCE(MAX(CAST(substr(bill_no, 13) AS INTEGER)), 0) AS m FROM bills WHERE bill_date = ?"
    ).get(date).m;
    n = Math.max(n, maxUsed) + 1;
    while (stmt("SELECT 1 FROM bills WHERE bill_no = ?").get(formatBillNo(date, n))) n++;
    stmt("UPDATE bill_sequences SET last_number = ? WHERE bill_date = ?").run(n, date);
  }
  return formatBillNo(date, n);
}

/**
 * Peek at what the next bill number WOULD be without incrementing the sequence.
 * Used for receipt preview only.
 */
function peekNextBillNo(date) {
  const row = stmt(
    "SELECT last_number FROM bill_sequences WHERE bill_date = ?"
  ).get(date);
  return formatBillNo(date, row ? row.last_number + 1 : 1);
}

/**
 * Saves a bill in ONE transaction: takes the bill number, deducts stock,
 * inserts the bill and closes the table's saved cart. Either all of it
 * happens or none of it does, so a failure can never leave a saved bill
 * behind a cart that is still open (which the cashier would bill again).
 */
function finalizeOrder(bill, items, shouldDeductInventory) {
  const db = getDB();
  const stockWarnings = [];
  const findStock = stmt("SELECT stock FROM inventory WHERE LOWER(name) = LOWER(?) AND archived = 0");
  const takeStock = stmt(
    "UPDATE inventory SET stock = MAX(0, stock - ?), updated_at = datetime('now') WHERE LOWER(name) = LOWER(?) AND archived = 0"
  );

  const tx = db.transaction(() => {
    // Step 1 — Generate bill number first so stock changes can reference it:
    const billDate = bill.billDate || bill.bill_date || localDate();
    const freshBillNo = generateBillNo(billDate);
    const orderId = bill.orderId || bill.order_id || "";

    // Step 2 — If shouldDeductInventory is true, deduct inventory:
    if (shouldDeductInventory) {
      items.forEach(item => {
        const base = baseItemName(item.name);
        const qty = item.quantity || 1;
        const row = findStock.get(base);
        if (!row) {
          console.warn("[INVENTORY_MISS] No match for:", base);
          return;
        }
        takeStock.run(qty, base);
        writeInventoryAuditLog(base, -Math.min(qty, row.stock), 'deducted', 'sale', freshBillNo);
        // Selling more than recorded stock: keep stock at 0 but record the
        // shortfall so the owner can see the count was wrong.
        if (qty > row.stock) {
          const short = qty - row.stock;
          writeInventoryAuditLog(base, -short, 'oversold', 'sale', freshBillNo);
          stockWarnings.push({ name: base, sold: qty, inStock: row.stock, short });
        }
      });
    }

    // Step 3 — Insert bill:
    const cashReceivedVal = (bill.paymentMode === "Cash" && bill.cashReceived != null)
      ? roundMoney(bill.cashReceived)
      : null;
    stmt(`
      INSERT INTO bills (bill_no, order_id, items, total, payment_mode, bill_date, time, cash_received,
                         discount_amount, stock_deducted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      freshBillNo,
      orderId,
      JSON.stringify(bill.items || []),
      roundMoney(bill.total || 0),
      bill.paymentMode || bill.payment_mode || "Cash",
      billDate,
      bill.time || new Date().toISOString(),
      cashReceivedVal,
      roundMoney(bill.discountAmount || 0),
      shouldDeductInventory ? 1 : 0
    );

    // Step 4 — Close the table's saved cart in the same transaction:
    if (orderId) removeSession(orderId);

    // Step 5 — Return freshBillNo from transaction
    return freshBillNo;
  });

  const billNo = tx();
  if (stockWarnings.length) bill.stockWarnings = stockWarnings;
  return billNo;
}

/**
 * Delete a bill and (optionally) put its items back into stock in ONE
 * transaction, so a failure can never leave a deleted bill with stock missing.
 * Only stock that this bill really took out is put back: nothing if inventory
 * tracking was off when it was sold, and never the oversold units.
 */
function deleteBill(billNo, restoreStock = false) {
  const db = getDB();
  const tx = db.transaction(() => {
    const bill = db.prepare("SELECT * FROM bills WHERE bill_no = ?").get(billNo);
    if (!bill) return null;
    let items = [];
    try { items = JSON.parse(bill.items); } catch (_e) { items = []; }
    db.prepare("DELETE FROM bills WHERE bill_no = ?").run(billNo);
    if (restoreStock && bill.stock_deducted === 1) {
      // The sale logged exactly what it took out of stock against this bill.
      const taken = db.prepare(
        "SELECT item_name AS name, SUM(-quantity_change) AS quantity FROM inventory_audit_log WHERE bill_no = ? AND reason = 'deducted' GROUP BY LOWER(item_name)"
      ).all(billNo).filter(r => r.quantity > 0);
      if (taken.length) restoreInventory(taken, billNo);
    } else if (restoreStock && bill.stock_deducted == null && Array.isArray(items) && items.length) {
      // Bill from before stock_deducted existed: restore from its items.
      // Units that were oversold never came out of stock, so don't add them back.
      const oversold = {};
      db.prepare(
        "SELECT LOWER(item_name) AS n, SUM(-quantity_change) AS q FROM inventory_audit_log WHERE bill_no = ? AND reason = 'oversold' GROUP BY LOWER(item_name)"
      ).all(billNo).forEach(r => { oversold[r.n] = r.q; });
      const toRestore = items.map(it => {
        const key = baseItemName(it.name).toLowerCase();
        const skip = Math.min(oversold[key] || 0, it.quantity || 1);
        oversold[key] = (oversold[key] || 0) - skip;
        return { ...it, quantity: (it.quantity || 1) - skip };
      }).filter(it => it.quantity > 0);
      if (toRestore.length) restoreInventory(toRestore, billNo);
    }
    return { ...bill, items };
  });
  return tx();
}

function writeAuditLog(action, entityType, entityId, before, after) { 
  try { 
    getDB().prepare(` 
      INSERT INTO audit_log (action, entity_type, entity_id, before_value, after_value) 
      VALUES (?, ?, ?, ?, ?) 
    `).run( 
      action, 
      entityType, 
      String(entityId), 
      before ? JSON.stringify(before) : null, 
      after ? JSON.stringify(after) : null 
    ); 
  } catch (e) { 
    console.error("[AUDIT] Failed to write audit log:", e.message); 
    // Never throw — audit failure must not break the main operation 
  } 
} 

function readAuditLog(limit = 50) { 
  return getDB().prepare( 
    "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?" 
  ).all(limit); 
} 

function markBillPrinted(billNo) { 
  getDB().prepare( 
    "UPDATE bills SET print_status = 'printed' WHERE bill_no = ?" 
  ).run(billNo); 
} 

function getWeeklyRevenue() { 
  const db = getDB(); 
  const dates = []; 
  for (let i = 6; i >= 0; i--) { 
    const d = new Date(); 
    d.setDate(d.getDate() - i); 
    dates.push(localDate(d)); 
  } 
 
  const placeholders = dates.map(() => "?").join(","); 
  const rows = db.prepare(` 
    SELECT bill_date, SUM(total) as revenue, COUNT(*) as bills 
    FROM bills 
    WHERE bill_date IN (${placeholders}) 
    GROUP BY bill_date 
  `).all(...dates); 
 
  return dates.map(date => { 
    const row = rows.find(r => r.bill_date === date); 
    return {
      date,
      revenue: roundMoney(row?.revenue || 0),
      bills: row?.bills || 0
    };
  }); 
 }

function getSalesDates() {
  return getDB()
    .prepare("SELECT DISTINCT bill_date FROM bills ORDER BY bill_date DESC")
    .all()
    .map(row => row.bill_date);
}

/**
 * Settings are stored as text; booleans and numbers are converted back here
 * so callers never see "false" (a truthy string) where they expect false.
 */
function readSettings() {
  const rows = stmt("SELECT key, value FROM settings").all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  const tables = parseInt(s.numberOfTables, 10);
  const parsed = {
    ...s,
    numberOfTables:   Number.isInteger(tables) && tables > 0 ? tables : 6,
    inventoryEnabled: s.inventoryEnabled === undefined ? true : s.inventoryEnabled === "true",
  };
  if (s.useThermalPrinting !== undefined) parsed.useThermalPrinting = s.useThermalPrinting !== "false";
  return parsed;
}

function saveSettings(settings) {
  const db = getDB();
  const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  db.transaction(() => {
    Object.entries(settings).forEach(([k, v]) => upsert.run(k, String(v)));
  })();
}

module.exports = {
  calculateCartTotal, getInventoryStockByName, baseItemName,
  readMenu, addCategory, renameCategory, deleteCategory, getCategoryId, getProductId,
  addProduct, editProductPrice, deleteProduct, toggleProductAvailability,
  addAddon, removeAddon,
  readInventory, updateStock, updateLowstock, addInventoryItem, ensureInventoryItem,
  deleteInventoryItem, archiveInventoryItem, restoreInventory,
  getInventorySyncStatus, syncInventoryToMenu, bulkUpdateStock,
  writeInventoryAuditLog, getInventoryAuditLog,
  readSessions, saveSession, removeSession, cleanupOldOrders,
  readSalesData, finalizeOrder, deleteBill, markBillPrinted, writeAuditLog, readAuditLog, getWeeklyRevenue, getSalesDates, generateBillNo, peekNextBillNo,
  readSettings, saveSettings
};
