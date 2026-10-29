'use strict';

/**
 * Data-integrity and money-correctness scenarios a café actually hits:
 * crashes between steps, re-used tables, discounts, paise rounding, short
 * cash, inventory toggled on/off — all through the real IPC handlers and a
 * real SQLite database in a temp folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-integrity-'));

jest.mock('electron', () => {
  const win = { webContents: { getPrintersAsync: async () => [], print: (opts, cb) => cb(true) } };
  return {
    app: { getPath: () => mockTmp, isPackaged: true, getVersion: () => 'test' },
    BrowserWindow: { getFocusedWindow: () => win, getAllWindows: () => [win] },
  };
});

const handlers = {};
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
const call = (ch, ...args) => handlers[ch]({}, ...args);

let db;
let session;
const today = () => require('../../src/main/services/file.service').getToday();
const sales = async () => (await call('get-sales-data', today())).data;
const stockOf = async (name) => (await call('get-inventory')).data.items.find(i => i.name === name)?.stock;
const restart = () => {
  for (const k of Object.keys(session.activeOrders)) delete session.activeOrders[k];
  session.loadSessions();
};

beforeAll(() => {
  const { getDB } = require('../../src/main/db/database');
  db = getDB();
  require('../../src/main/db/migrate').migrateFromJSON();
  session = require('../../src/main/services/session.service');
  for (const m of ['menu', 'orders', 'billing', 'inventory', 'dashboard', 'settings', 'printer']) {
    require(`../../src/main/ipc/${m}.ipc`).register(ipcMain);
  }
});

afterAll(() => {
  require('../../src/main/db/database').closeDB();
  fs.rmSync(mockTmp, { recursive: true, force: true });
});

// ── Open tables ───────────────────────────────────────────────────────────────

test('a table that was billed before keeps its next cart across a restart', async () => {
  await call('add-to-order', 'Table 1', { name: 'Tea', price: 10 });
  expect((await call('finalize-bill', { orderId: 'Table 1', paymentMode: 'UPI' })).success).toBe(true);

  await call('add-to-order', 'Table 1', { name: 'Coffee', price: 30 });
  restart();
  expect(session.activeOrders['Table 1']?.items.map(i => i.name)).toEqual(['Coffee']);
  await call('clear-cart', 'Table 1');
});

test('if saving the cart fails, the screen does not show an item a restart would lose', async () => {
  db.exec("CREATE TRIGGER fail_cart BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  try {
    const r = await call('add-to-order', 'Table 2', { name: 'Tea', price: 10 });
    expect(r.success).toBe(false);
    expect((await call('get-active-orders')).data['Table 2']).toBeUndefined();
  } finally {
    db.exec('DROP TRIGGER fail_cart');
  }

  await call('add-to-order', 'Table 2', { name: 'Tea', price: 10 });
  db.exec("CREATE TRIGGER fail_cart BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  try {
    expect((await call('increase-cart-item-quantity', 'Table 2', 0)).success).toBe(false);
    expect((await call('get-active-orders')).data['Table 2'][0].quantity).toBe(1);
  } finally {
    db.exec('DROP TRIGGER fail_cart');
  }
  await call('clear-cart', 'Table 2');
});

// ── Finalize ──────────────────────────────────────────────────────────────────

test('saving the bill and closing the table happen together or not at all', async () => {
  await call('add-to-order', 'Table 3', { name: 'Tea', price: 10 });
  const before = (await sales()).bills.length;

  db.exec("CREATE TRIGGER fail_close BEFORE UPDATE OF status ON orders WHEN NEW.status = 'completed' BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  let r;
  try {
    r = await call('finalize-bill', { orderId: 'Table 3', paymentMode: 'Cash' });
  } finally {
    db.exec('DROP TRIGGER fail_close');
  }
  expect(r.success).toBe(false);
  expect((await sales()).bills.length).toBe(before);          // no bill left behind
  expect((await call('get-active-orders')).data['Table 3']).toHaveLength(1); // cart still open

  // The cashier retries: exactly one bill.
  expect((await call('finalize-bill', { orderId: 'Table 3', paymentMode: 'Cash' })).success).toBe(true);
  expect((await sales()).bills.length).toBe(before + 1);
  restart();
  expect(session.activeOrders['Table 3']).toBeUndefined();
});

test('a double-clicked finalize creates one bill', async () => {
  await call('add-to-order', 'Table 4', { name: 'Tea', price: 10 });
  const before = (await sales()).bills.length;
  const [a, b] = await Promise.all([
    call('finalize-bill', { orderId: 'Table 4', paymentMode: 'Cash' }),
    call('finalize-bill', { orderId: 'Table 4', paymentMode: 'Cash' }),
  ]);
  expect([a.success, b.success].filter(Boolean)).toHaveLength(1);
  expect((await sales()).bills.length).toBe(before + 1);
});

test('bill numbers never collide even if the day counter falls behind', async () => {
  const used = (await sales()).bills.map(b => b.billNo);
  db.prepare('UPDATE bill_sequences SET last_number = 0 WHERE bill_date = ?').run(today());

  await call('add-to-order', 'Table 5', { name: 'Tea', price: 10 });
  const r = await call('finalize-bill', { orderId: 'Table 5', paymentMode: 'UPI' });
  expect(r.success).toBe(true);
  expect(used).not.toContain(r.data.billNo);
  const max = Math.max(...used.map(n => Number(n.split('-').pop())));
  expect(Number(r.data.billNo.split('-').pop())).toBe(max + 1);
  expect((await call('get-next-bill-number')).data).toBe(r.data.billNo.replace(/\d+$/, String(max + 2)));
});

// ── Money ─────────────────────────────────────────────────────────────────────

test('the discount is stored on the bill and shown in sales and analytics', async () => {
  await call('add-to-order', 'Table 6', { name: 'Coffee', price: 100 });
  await call('add-to-order', 'Table 6', { name: 'Veg Sandwich', price: 100 });
  const r = await call('finalize-bill', { orderId: 'Table 6', paymentMode: 'Card', discountAmount: 20 });
  expect(r.data).toMatchObject({ subtotal: 200, discountAmount: 20, total: 180 });

  const data = await sales();
  const bill = data.bills.find(b => b.billNo === r.data.billNo);
  expect(bill).toMatchObject({ total: 180, discountAmount: 20, subtotal: 200 });
  expect(data.totalDiscount).toBeGreaterThanOrEqual(20);
  expect(data.grossRevenue).toBeCloseTo(data.totalRevenue + data.totalDiscount, 2);

  const analytics = (await call('get-dashboard-analytics', today())).data;
  expect(analytics.totalDiscount).toBe(data.totalDiscount);
});

test('totals are exact to the paisa', async () => {
  await call('add-to-order', 'Table 7', { name: 'Toffee', price: 0.1 });
  const r = await call('add-to-order', 'Table 7', { name: 'Mint', price: 0.2 });
  expect(r.data.total).toBe(0.3);
  const bill = await call('finalize-bill', { orderId: 'Table 7', paymentMode: 'Cash', cashReceived: 0.3 });
  expect(bill.success).toBe(true);
  expect(bill.data.total).toBe(0.3);
  expect((await sales()).bills.find(b => b.billNo === bill.data.billNo).total).toBe(0.3);
});

test('cash received must be a real amount that covers the total', async () => {
  await call('add-to-order', 'Table 8', { name: 'Tea', price: 50 });
  for (const cashReceived of [20, NaN, -5, Infinity]) {
    const r = await call('finalize-bill', { orderId: 'Table 8', paymentMode: 'Cash', cashReceived });
    expect(r.success).toBe(false);
  }
  expect((await call('get-active-orders')).data['Table 8']).toHaveLength(1); // still open

  const ok = await call('finalize-bill', { orderId: 'Table 8', paymentMode: 'Cash', cashReceived: 40, discountAmount: 10 });
  expect(ok.success).toBe(true);
  expect(ok.data).toMatchObject({ total: 40, cashReceived: 40 });
});

test('a garbage discount is ignored rather than turning into a free bill', async () => {
  await call('add-to-order', 'Table 9', { name: 'Tea', price: 50 });
  const r = await call('finalize-bill', { orderId: 'Table 9', paymentMode: 'UPI', discountAmount: Infinity });
  expect(r.data).toMatchObject({ total: 50, discountAmount: 0 });
});

// ── Inventory ─────────────────────────────────────────────────────────────────

test('deleting a bill sold while inventory tracking was off does not add stock', async () => {
  await call('add-inventory-item', { name: 'Brownie', stock: 10, lowStock: 2 });
  await call('save-settings', { inventoryEnabled: false });
  await call('add-to-order', 'Table 10', { name: 'Brownie', price: 60 });
  const r = await call('finalize-bill', { orderId: 'Table 10', paymentMode: 'UPI' });
  expect(await stockOf('Brownie')).toBe(10);

  await call('save-settings', { inventoryEnabled: true });
  expect((await call('delete-bill', r.data.billNo)).success).toBe(true);
  expect(await stockOf('Brownie')).toBe(10);
});

test('deleting a bill puts back exactly what it took, including half/full variants', async () => {
  await call('add-inventory-item', { name: 'Fries', stock: 5, lowStock: 1 });
  await call('add-to-order', 'Table 11', { name: 'Fries (Half)', price: 40 });
  await call('add-to-order', 'Table 11', { name: 'Fries (Full)', price: 70 });
  await call('increase-cart-item-quantity', 'Table 11', 1);
  const r = await call('finalize-bill', { orderId: 'Table 11', paymentMode: 'UPI' });
  expect(await stockOf('Fries')).toBe(2);
  await call('delete-bill', r.data.billNo);
  expect(await stockOf('Fries')).toBe(5);
});

test('adding a menu product does not wipe the stock already counted for it', async () => {
  await call('add-inventory-item', { name: 'Cold Brew', stock: 25, lowStock: 5 });
  const r = await call('add-product', 'Cold Beverages', { name: 'Cold Brew', price: 90 });
  expect(r.success).toBe(true);
  const item = (await call('get-inventory')).data.items.find(i => i.name === 'Cold Brew');
  expect(item.stock).toBe(25);
  expect(item.linked).toBe(true);
});

test('a new product gets an inventory row at zero stock', async () => {
  await call('add-product', 'Snacks', { name: 'Nachos', price: 80 });
  expect(await stockOf('Nachos')).toBe(0);
});

test('an item removed from inventory tracking can still be sold', async () => {
  await call('add-inventory-item', { name: 'Daily Special', stock: 0, lowStock: 1 });
  expect((await call('add-to-order', 'Table 12', { name: 'Daily Special', price: 150 })).error).toBe('OUT_OF_STOCK');
  await call('delete-inventory-item', 'Daily Special');
  expect((await call('add-to-order', 'Table 12', { name: 'Daily Special', price: 150 })).success).toBe(true);
  await call('clear-cart', 'Table 12');
});

test('an inventory alert level of 0 is kept', async () => {
  await call('add-inventory-item', { name: 'Napkins', stock: 100, lowStock: 0 });
  expect((await call('get-inventory')).data.items.find(i => i.name === 'Napkins').lowStock).toBe(0);
});

// ── Settings ──────────────────────────────────────────────────────────────────

test('turning thermal printing off is remembered', async () => {
  await call('save-printer-config', { printerName: '', useThermalPrinting: false });
  expect((await call('get-printer-config')).data.useThermalPrinting).toBe(false);
  await call('save-printer-config', { printerName: '', useThermalPrinting: true });
  expect((await call('get-printer-config')).data.useThermalPrinting).toBe(true);
});

test('toggle-inventory only changes the inventory flag', async () => {
  const setting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k).value;
  db.prepare("UPDATE settings SET value = 'abc' WHERE key = 'numberOfTables'").run();
  try {
    const before = setting('inventoryEnabled');
    await call('toggle-inventory');
    expect(setting('inventoryEnabled')).not.toBe(before);
    await call('toggle-inventory');
    expect(setting('inventoryEnabled')).toBe(before);
    expect(setting('numberOfTables')).toBe('abc');
    expect((await call('get-settings')).data.numberOfTables).toBe(6);
  } finally {
    db.prepare("UPDATE settings SET value = '6' WHERE key = 'numberOfTables'").run();
  }
});

// ── Reads ─────────────────────────────────────────────────────────────────────

test('getSalesByDate (still exposed by the preload) has a handler', async () => {
  const r = await call('get-sales-by-date', today());
  expect(r.success).toBe(true);
  expect(r.data.totalBills).toBe((await sales()).totalBills);
});

test('the menu still groups products and their add-ons correctly', async () => {
  const menu = (await call('get-menu')).data;
  const snacks = menu.categories.find(c => c.name === 'Snacks');
  const fries = snacks.products.find(p => p.name === 'French Fries');
  expect(fries.addons.map(a => a.name)).toEqual(['Cheese Dip', 'Peri Peri']);
  expect(snacks.products.filter(p => p.name === 'French Fries')).toHaveLength(1);
});
