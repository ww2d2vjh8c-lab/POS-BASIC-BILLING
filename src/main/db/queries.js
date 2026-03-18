const { getDB } = require("./database");

/**
 * Calculates the total cost of a cart items array.
 * Single source of truth — used by all IPC handlers that touch cart totals.
 */
function calculateCartTotal(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc, item) => {
    const addonsTotal = Array.isArray(item.addons)
      ? item.addons.reduce((a, ad) => a + (ad.price || 0), 0)
      : 0;
    return acc + ((item.price || 0) + addonsTotal) * (item.quantity || 0);
  }, 0);
}

/**
 * Returns the current stock for a single inventory item by name (case-insensitive).
 * Returns null if the item is not tracked in inventory.
 */
function getInventoryStockByName(name) {
  const row = getDB().prepare(
    "SELECT stock FROM inventory WHERE LOWER(name) = LOWER(?)"
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
 
  // Assemble nested structure from flat rows 
  const catMap = new Map(); 
 
  rows.forEach(row => { 
    if (!catMap.has(row.cat_id)) { 
      catMap.set(row.cat_id, { name: row.cat_name, products: [] }); 
    } 
    if (!row.prod_id) return; // Category exists but has no products 
 
    const cat = catMap.get(row.cat_id); 
    let product = cat.products.find(p => p.name === row.prod_name); 
    if (!product) { 
      product = { 
        name: row.prod_name, 
        price: row.price, 
        halfPrice: row.half_price, 
        hasVariants: row.has_variants === 1, 
        available: row.available === 1, 
        addons: [] 
      }; 
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

function addProduct(categoryName, product) {
  const db = getDB();
  const catId = getCategoryId(categoryName);
  const insertProduct = db.prepare("INSERT INTO products (category_id, name, price, half_price, has_variants, available) VALUES (?, ?, ?, ?, ?, ?)");
  const inserted = insertProduct.run(
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
    getDB().prepare(`
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

function updateStock(name, newStock, source) {
  const db = getDB();
  const prev = db.prepare("SELECT stock FROM inventory WHERE LOWER(name) = LOWER(?)").get(name);
  db.prepare("UPDATE inventory SET stock = ?, updated_at = datetime('now') WHERE name = ?").run(newStock, name);
  if (prev != null) {
    writeInventoryAuditLog(name, newStock - prev.stock, 'adjusted', source || 'manual', null);
  }
}

function updateLowstock(name, alertAt) {
  getDB().prepare("UPDATE inventory SET low_stock_alert = ?, updated_at = datetime('now') WHERE name = ?").run(alertAt, name);
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
    `).run(item.name, item.stock || 0, item.alertAt || 5, item.product_id || null);
  } catch (_e) {
    // Fallback for pre-v3 schema (no product_id / archived columns)
    db.prepare(`
      INSERT INTO inventory (name, stock, low_stock_alert)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        stock = excluded.stock,
        low_stock_alert = excluded.low_stock_alert,
        updated_at = datetime('now')
    `).run(item.name, item.stock || 0, item.alertAt || 5);
  }
  writeInventoryAuditLog(item.name, item.stock || 0, 'created', item.source || 'manual', null);
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
 */
function bulkUpdateStock(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return { updated: 0 };
  const db = getDB();
  const tx = db.transaction((list) => {
    list.forEach(u => updateStock(u.name, u.stock, 'restock'));
  });
  tx(updates);
  return { updated: updates.length };
}

function deductInventory(items) {
  const db = getDB();
  const stmt = db.prepare(  // ← OUTSIDE the loop
    "UPDATE inventory SET stock = MAX(0, stock - ?) WHERE LOWER(name) = LOWER(?)"
  );
  const deduct = db.transaction((list) => {
    list.forEach(soldItem => {
      const base = soldItem.name.replace(/\s*\(Half\)|\s*\(Full\)/gi, "").trim();
      const qty = soldItem.quantity || 1;
      const result = stmt.run(qty, base);
      if (result.changes === 0) {
        console.warn("[INVENTORY_MISS]", base);
      } else {
        writeInventoryAuditLog(base, -qty, 'deducted', 'sale', null);
      }
    });
  });
  deduct(items);
}

function restoreInventory(items) {
  const db = getDB();
  const stmt = db.prepare(  // ← OUTSIDE the loop
    "UPDATE inventory SET stock = stock + ? WHERE LOWER(name) = LOWER(?)"
  );
  const restore = db.transaction((list) => {
    list.forEach(item => {
      const base = item.name.replace(/\s*\(Half\)|\s*\(Full\)/gi, "").trim();
      const qty = item.quantity || 1;
      stmt.run(qty, base);
      writeInventoryAuditLog(base, qty, 'restored', 'bill_delete', null);
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
  return { date: new Date().toISOString().split("T")[0], sessions };
}

function saveSession(orderId, sessionOrItems) {
  const db = getDB();
  const items = Array.isArray(sessionOrItems) ? sessionOrItems : (sessionOrItems?.items || []);
  const total = items.reduce((sum, item) => {
    const addonTotal = (item.addons || []).reduce((a, ad) => a + (ad.price || 0), 0);
    return sum + (item.price + addonTotal) * item.quantity;
  }, 0);
  db.prepare("INSERT INTO orders (order_id, items, total, status, updated_at) VALUES (?, ?, ?, 'active', datetime('now')) ON CONFLICT(order_id) DO UPDATE SET items = excluded.items, total = excluded.total, updated_at = datetime('now')").run(orderId, JSON.stringify(items), total);
}

function removeSession(orderId) {
  getDB().prepare("UPDATE orders SET status = 'completed', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
}

function readSalesData(date) {
  const db = getDB();
  const bills = db.prepare(`
    SELECT id, bill_no, order_id, items, total, payment_mode, bill_date, time, print_status, created_at
    FROM bills WHERE bill_date = ? ORDER BY id ASC
  `).all(date);

  const parsed = bills.map(b => ({
    id: b.id,
    billNo: b.bill_no,
    bill_no: b.bill_no,
    orderId: b.order_id,
    items: (() => { try { return JSON.parse(b.items); } catch(e) { return []; } })(),
    total: b.total,
    paymentMode: b.payment_mode,
    billDate: b.bill_date,
    time: b.time || b.created_at,
    printStatus: b.print_status,
    createdAt: b.created_at
  }));

  return {
    date,
    bills: parsed,
    totalRevenue: parsed.reduce((s, b) => s + (b.total || 0), 0),
    totalBills: parsed.length
  };
}

function generateBillNo(date) {
  const db = getDB();
  const dateStr = date.replace(/-/g, "");

  db.prepare(`
    INSERT INTO bill_sequences (bill_date, last_number) VALUES (?, 1)
    ON CONFLICT(bill_date) DO UPDATE SET last_number = last_number + 1
  `).run(date);

  const row = db.prepare(
    "SELECT last_number FROM bill_sequences WHERE bill_date = ?"
  ).get(date);

  return "BC-" + dateStr + "-" + row.last_number;
}

/**
 * Peek at what the next bill number WOULD be without incrementing the sequence.
 * Used for receipt preview only.
 */
function peekNextBillNo(date) {
  const db = getDB();
  const dateStr = date.replace(/-/g, "");
  const row = db.prepare(
    "SELECT last_number FROM bill_sequences WHERE bill_date = ?"
  ).get(date);
  const nextNum = row ? row.last_number + 1 : 1;
  return "BC-" + dateStr + "-" + nextNum;
} 

function finalizeOrder(bill, items, shouldDeductInventory) {
  const db = getDB();

  const tx = db.transaction(() => {
    // Step 1 — If shouldDeductInventory is true, deduct inventory:
    if (shouldDeductInventory) {
      items.forEach(item => {
        const base = item.name.replace(/\s*\(Half\)|\s*\(Full\)/gi, "").trim();
        const qty = item.quantity || 1;
        const result = db.prepare(
          "UPDATE inventory SET stock = MAX(0, stock - ?) WHERE LOWER(name) = LOWER(?)"
        ).run(qty, base);
        if (result.changes === 0) {
          console.warn("[INVENTORY_MISS] No match for:", base);
        } else {
          writeInventoryAuditLog(base, -qty, 'deducted', 'sale', null); // bill_no added after insert
        }
      });
    }

    // Step 2 — Generate bill number (call generateBillNo inside same tx):
    const billDate = bill.billDate || bill.bill_date || new Date().toISOString().split("T")[0];
    const freshBillNo = generateBillNo(billDate);

    // Step 3 — Insert bill:
    db.prepare(`
      INSERT INTO bills (bill_no, order_id, items, total, payment_mode, bill_date, time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      freshBillNo,
      bill.orderId || bill.order_id || "",
      JSON.stringify(bill.items || []),
      bill.total || 0,
      bill.paymentMode || bill.payment_mode || "Cash",
      billDate,
      bill.time || new Date().toISOString()
    );

    // Step 4 — Return freshBillNo from transaction
    return freshBillNo;
  });

  return tx();
}

function deleteBill(billNo) {
  const db = getDB();
  const bill = db.prepare("SELECT * FROM bills WHERE bill_no = ?").get(billNo);
  if (!bill) return null;
  db.prepare("DELETE FROM bills WHERE bill_no = ?").run(billNo);
  return { ...bill, items: (() => { try { return JSON.parse(bill.items); } catch(e) { return []; } })() };
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
    dates.push(d.toISOString().split("T")[0]); 
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
      revenue: row?.revenue || 0, 
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

function readSettings() {
  const rows = getDB().prepare("SELECT key, value FROM settings").all();
  const s = {};
  rows.forEach(r => {
    s[r.key] = r.key === "numberOfTables" ? parseInt(r.value) : r.key === "inventoryEnabled" ? r.value === "true" : r.value;
  });
  return { numberOfTables: 6, inventoryEnabled: true, ...s };
}

function saveSettings(settings) {
  const db = getDB();
  const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  Object.entries(settings).forEach(([k, v]) => upsert.run(k, String(v)));
}

module.exports = {
  calculateCartTotal, getInventoryStockByName,
  readMenu, addCategory, renameCategory, deleteCategory, getCategoryId, getProductId,
  addProduct, editProductPrice, deleteProduct, toggleProductAvailability,
  addAddon, removeAddon,
  readInventory, updateStock, updateLowstock, addInventoryItem,
  deleteInventoryItem, archiveInventoryItem, deductInventory, restoreInventory,
  getInventorySyncStatus, syncInventoryToMenu, bulkUpdateStock,
  writeInventoryAuditLog, getInventoryAuditLog,
  readSessions, saveSession, removeSession,
  readSalesData, finalizeOrder, deleteBill, markBillPrinted, writeAuditLog, readAuditLog, getWeeklyRevenue, getSalesDates, generateBillNo, peekNextBillNo,
  readSettings, saveSettings
};
