'use strict';

/**
 * End-to-end main-process flow: a cashier opens a table, adds items, changes
 * quantities, finalizes, prints, sees the sale on the dashboard and deletes
 * it again — all through the real IPC handlers and a real SQLite database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-it-'));
const mockPrinted = [];
let mockPrinters = [];

jest.mock('electron', () => {
  const win = {
    webContents: {
      getPrintersAsync: async () => mockPrinters,
      print: (opts, cb) => { mockPrinted.push(opts); cb(true); },
    },
  };
  return {
    app: { getPath: () => mockTmp, isPackaged: true, getVersion: () => 'test' },
    BrowserWindow: { getFocusedWindow: () => win, getAllWindows: () => [win] },
  };
}, { virtual: false });

const handlers = {};
const ipcMain = {
  handle: (ch, fn) => { handlers[ch] = fn; },
  on: () => {},
};
const call = (ch, ...args) => handlers[ch]({}, ...args);

let db;
beforeAll(() => {
  const { getDB } = require('../../src/main/db/database');
  db = getDB();
  require('../../src/main/db/migrate').migrateFromJSON();
  for (const m of ['menu', 'orders', 'billing', 'inventory', 'dashboard', 'settings', 'printer']) {
    require(`../../src/main/ipc/${m}.ipc`).register(ipcMain);
  }
});

afterAll(() => {
  require('../../src/main/db/database').closeDB();
  fs.rmSync(mockTmp, { recursive: true, force: true });
});

test('fresh database is seeded with a menu', async () => {
  const res = await call('get-menu');
  expect(res.success).toBe(true);
  const cats = res.data.categories || res.data;
  expect(cats.length).toBeGreaterThan(0);
});

test('full sale: add → qty → finalize → sales → delete', async () => {
  await call('add-inventory-item', { name: 'Test Latte', stock: 10, lowStock: 2 });
  await call('save-settings', { inventoryEnabled: true });

  let r = await call('add-to-order', 'Table 1', { name: 'Test Latte', price: 120, addons: [{ name: 'Shot', price: 30 }] });
  expect(r.success).toBe(true);
  r = await call('add-to-order', 'Table 1', { name: 'Water', price: 20 });
  expect(r.data.total).toBe(170);

  await call('increase-cart-item-quantity', 'Table 1', 0); // 2x latte
  const active = await call('get-active-orders');
  expect(active.data['Table 1'][0].quantity).toBe(2);

  await call('decrease-cart-item-quantity', 'Table 1', 1); // remove water
  const bill = await call('finalize-bill', { orderId: 'Table 1', paymentMode: 'Cash', cashReceived: 500, discountAmount: 0 });
  expect(bill.success).toBe(true);
  expect(bill.data.total).toBe(300);
  expect(bill.data.billNo).toMatch(/^BC-\d{8}-\d+$/);
  expect(bill.data.cashReceived).toBe(500);

  // table is closed and stock deducted
  expect((await call('get-active-orders')).data['Table 1']).toBeUndefined();
  const inv = (await call('get-inventory')).data;
  const items = inv.items || inv;
  expect(items.find(i => i.name === 'Test Latte').stock).toBe(8);

  // appears in today's sales
  const { getToday } = require('../../src/main/services/file.service');
  const sales = await call('get-sales-data', getToday());
  const bills = (sales.data.bills || sales.data);
  expect(bills.some(b => b.billNo === bill.data.billNo)).toBe(true);

  // print + mark mockPrinted
  mockPrinters = [{ name: 'Microsoft Print to PDF', isDefault: true }, { name: 'POS-58 Thermal' }];
  const p = await call('print-receipt');
  expect(p.success).toBe(true);
  expect(mockPrinted.at(-1)).toMatchObject({ silent: true, deviceName: 'POS-58 Thermal' });
  expect((await call('get-printer-config')).data.printerName).toBe('POS-58 Thermal');
  expect((await call('mark-bill-printed', bill.data.billNo)).success).toBe(true);

  // deleting restores stock
  expect((await call('delete-bill', bill.data.billNo)).success).toBe(true);
  const inv2 = (await call('get-inventory')).data;
  expect((inv2.items || inv2).find(i => i.name === 'Test Latte').stock).toBe(10);
});

test('bill numbers are sequential and never reused', async () => {
  const nos = [];
  for (let i = 0; i < 3; i++) {
    await call('add-to-order', 'Table 2', { name: 'Tea', price: 10 });
    const r = await call('finalize-bill', { orderId: 'Table 2', paymentMode: 'UPI' });
    expect(r.success).toBe(true);
    expect(r.data.cashReceived).toBeNull();
    nos.push(Number(r.data.billNo.split('-').pop()));
  }
  expect(nos[1]).toBe(nos[0] + 1);
  expect(nos[2]).toBe(nos[1] + 1);
});

test('rejects bad input instead of crashing', async () => {
  expect((await call('finalize-bill', { orderId: 'Nope', paymentMode: 'Cash' })).success).toBe(false);
  expect((await call('finalize-bill', { orderId: 'Table 3', paymentMode: 'Bitcoin' })).success).toBe(false);
  expect((await call('finalize-bill')).success).toBe(false);
  expect((await call('add-to-order', 'Table 3', { name: 'X' })).success).toBe(false);
  expect((await call('increase-cart-item-quantity', 'Table 3', 99)).success).toBe(false);
});

test('discount cannot exceed total', async () => {
  await call('add-to-order', 'Table 4', { name: 'Tea', price: 50 });
  const r = await call('finalize-bill', { orderId: 'Table 4', paymentMode: 'Card', discountAmount: 999 });
  expect(r.data.total).toBe(0);
});

test('out-of-stock items cannot be added', async () => {
  await call('add-inventory-item', { name: 'Sold Out Cake', stock: 0, lowStock: 1 });
  const r = await call('add-to-order', 'Table 5', { name: 'Sold Out Cake', price: 90 });
  expect(r).toEqual({ success: false, error: 'OUT_OF_STOCK' });
});

test('open tables survive an app restart', async () => {
  await call('add-to-order', 'Table 6', { name: 'Tea', price: 10 });
  const session = require('../../src/main/services/session.service');
  for (const k of Object.keys(session.activeOrders)) delete session.activeOrders[k];
  session.loadSessions();
  expect(session.activeOrders['Table 6'].items[0].name).toBe('Tea');
});

test('print falls back to dialog when no printer is installed', async () => {
  mockPrinters = [];
  await call('save-printer-config', { printerName: '', useThermalPrinting: true });
  const r = await call('print-receipt');
  expect(r.success).toBe(true);
  expect(mockPrinted.at(-1).silent).toBe(false);
});

test('list-printers reports what will be used', async () => {
  mockPrinters = [{ name: 'Office Laser', isDefault: true }];
  const r = await call('list-printers');
  expect(r.data.detected).toEqual({ name: 'Office Laser', reason: 'default' });
});
