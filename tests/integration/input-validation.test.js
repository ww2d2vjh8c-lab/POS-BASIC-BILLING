'use strict';

/**
 * Every IPC channel must reject bad input (wrong type, NaN, negative, huge,
 * unknown) without crashing and without writing junk to the database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-validate-'));

jest.mock('electron', () => {
  const win = { webContents: { getPrintersAsync: async () => [], print: (opts, cb) => cb(true) } };
  return {
    app: { getPath: () => mockTmp, isPackaged: true, getVersion: () => 'test', relaunch: () => {}, exit: () => {} },
    BrowserWindow: { getFocusedWindow: () => win, getAllWindows: () => [win] },
  };
});

const handlers = {};
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
const call = (ch, ...args) => handlers[ch]({}, ...args);

let db;
const stockOf = async (name) => (await call('get-inventory')).data.items.find(i => i.name === name)?.stock;

beforeAll(() => {
  const { getDB } = require('../../src/main/db/database');
  db = getDB();
  require('../../src/main/db/migrate').migrateFromJSON();
  for (const m of ['menu', 'orders', 'billing', 'inventory', 'dashboard', 'settings', 'printer', 'system']) {
    require(`../../src/main/ipc/${m}.ipc`).register(ipcMain);
  }
});

afterAll(() => {
  require('../../src/main/db/database').closeDB();
  fs.rmSync(mockTmp, { recursive: true, force: true });
});

describe('cart', () => {
  test.each([
    ['NaN price',        { name: 'Tea', price: NaN }],
    ['infinite price',   { name: 'Tea', price: Infinity }],
    ['negative price',   { name: 'Tea', price: -10 }],
    ['absurd price',     { name: 'Tea', price: 1e9 }],
    ['string price',     { name: 'Tea', price: '10' }],
    ['huge name',        { name: 'T'.repeat(5000), price: 10 }],
    ['bad add-on price', { name: 'Tea', price: 10, addons: [{ name: 'Sugar', price: NaN }] }],
    ['add-ons not list', { name: 'Tea', price: 10, addons: { name: 'Sugar' } }],
  ])('add-to-order rejects %s', async (_label, item) => {
    const r = await call('add-to-order', 'Table 1', item);
    expect(r.success).toBe(false);
    expect((await call('get-active-orders')).data['Table 1']).toBeUndefined();
  });

  test('add-to-order rejects bad order ids', async () => {
    for (const id of [null, 42, '', 'x'.repeat(101), { id: 1 }]) {
      expect((await call('add-to-order', id, { name: 'Tea', price: 10 })).success).toBe(false);
    }
  });

  test('prototype keys cannot be used to tamper with shared objects', async () => {
    expect((await call('add-to-order', '__proto__', { name: 'Tea', price: 10 })).success).toBe(false);
    expect(({}).updatedAt).toBeUndefined();
    expect(Object.keys((await call('get-active-orders')).data)).not.toContain('updatedAt');

    await call('add-to-order', 'Table 2', { name: 'Tea', price: 10 });
    expect((await call('increase-cart-item-quantity', 'Table 2', '__proto__')).success).toBe(false);
    expect([].quantity).toBeUndefined();
    expect((await call('remove-cart-item', 'Table 2', '__proto__')).success).toBe(false);
    expect((await call('get-active-orders')).data['Table 2']).toHaveLength(1);
    await call('clear-cart', 'Table 2');
  });

  test('item index must be a whole number in range', async () => {
    await call('add-to-order', 'Table 3', { name: 'Tea', price: 10 });
    for (const idx of [-1, 1, 0.5, NaN, null, 'abc']) {
      expect((await call('increase-cart-item-quantity', 'Table 3', idx)).success).toBe(false);
      expect((await call('decrease-cart-item-quantity', 'Table 3', idx)).success).toBe(false);
      expect((await call('remove-cart-item', 'Table 3', idx)).success).toBe(false);
    }
    expect((await call('get-active-orders')).data['Table 3'][0].quantity).toBe(1);
    await call('clear-cart', 'Table 3');
  });
});

describe('bills', () => {
  test('delete-bill and mark-bill-printed reject non-string bill numbers', async () => {
    for (const bad of [null, 42, {}, '']) {
      expect((await call('delete-bill', bad)).success).toBe(false);
      expect((await call('mark-bill-printed', bad)).success).toBe(false);
    }
  });

  test('sales and analytics reject anything that is not a calendar date', async () => {
    for (const bad of ['2026-13-45', '2026-02-30', '../../etc/passwd', 'today', 123, null]) {
      expect((await call('get-sales-data', bad)).success).toBe(false);
      expect((await call('get-dashboard-analytics', bad)).success).toBe(false);
    }
    expect((await call('get-sales-data', '2026-01-01')).success).toBe(true);
  });
});

describe('settings', () => {
  const stored = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;

  test.each([
    [{ numberOfTables: 1e9 }],
    [{ numberOfTables: -1 }],
    [{ numberOfTables: 'lots' }],
    [{ inventoryEnabled: 'no' }],
    [{ cafeName: 'x'.repeat(5000) }],
    [{ cafePhone: { n: 1 } }],
  ])('save-settings rejects %j and stores nothing', async (bad) => {
    const before = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
    expect((await call('save-settings', bad)).success).toBe(false);
    expect(db.prepare('SELECT key, value FROM settings ORDER BY key').all()).toEqual(before);
  });

  test('save-settings stores valid values', async () => {
    const r = await call('save-settings', { numberOfTables: 10, cafeName: ' Bloom ', ignored: 'x' });
    expect(r).toEqual({ success: true, data: { numberOfTables: 10, cafeName: 'Bloom' } });
    expect(stored('numberOfTables')).toBe('10');
    expect(stored('ignored')).toBeUndefined();
    await call('save-settings', { numberOfTables: 6 });
  });

  test('save-printer-config rejects missing or oversized config', async () => {
    expect((await call('save-printer-config', null)).success).toBe(false);
    expect((await call('save-printer-config', { printerName: 'p'.repeat(1000) })).success).toBe(false);
  });
});

describe('inventory', () => {
  beforeAll(async () => {
    await call('add-inventory-item', { name: 'Milk', stock: 20, lowStock: 5 });
  });

  test.each([NaN, Infinity, -1, 1e21, '5', null])('update-stock rejects %p and keeps the stock', async (bad) => {
    expect((await call('update-stock', 'Milk', bad)).success).toBe(false);
    expect(await stockOf('Milk')).toBe(20);
  });

  test('update-stock reports an unknown item', async () => {
    expect((await call('update-stock', 'Unicorn', 5)).error).toBe('Item not found');
  });

  test('update-stock matches the item name case-insensitively', async () => {
    expect((await call('update-stock', 'milk', 21)).success).toBe(true);
    expect(await stockOf('Milk')).toBe(21);
    await call('update-stock', 'Milk', 20);
  });

  test.each([NaN, Infinity, -3])('update-lowstock rejects %p', async (bad) => {
    expect((await call('update-lowstock', 'Milk', bad)).success).toBe(false);
  });

  test('add-inventory-item rejects bad numbers and names', async () => {
    expect((await call('add-inventory-item', { name: 'Eggs', stock: NaN, lowStock: 1 })).success).toBe(false);
    expect((await call('add-inventory-item', { name: 'Eggs', stock: 1, lowStock: Infinity })).success).toBe(false);
    expect((await call('add-inventory-item', { name: 'E'.repeat(500), stock: 1, lowStock: 1 })).success).toBe(false);
    expect(await stockOf('Eggs')).toBeUndefined();
  });

  test('bulk-update-stock is all-or-nothing on bad rows', async () => {
    await call('add-inventory-item', { name: 'Sugar', stock: 7, lowStock: 1 });
    const r = await call('bulk-update-stock', [{ name: 'Milk', stock: 50 }, { name: 'Sugar', stock: 'abc' }]);
    expect(r.success).toBe(false);
    expect(await stockOf('Milk')).toBe(20);
    expect(await stockOf('Sugar')).toBe(7);

    const ok = await call('bulk-update-stock', [{ name: 'Milk', stock: 50 }, { name: 'Nope', stock: 1 }]);
    expect(ok).toEqual({ success: true, data: { updated: 1 } });
    expect(await stockOf('Milk')).toBe(50);
  });
});

describe('menu', () => {
  test('add-product rejects invalid add-ons and creates nothing', async () => {
    const r = await call('add-product', 'Snacks', { name: 'Bad Toast', price: 40, addons: [{ name: 'Jam', price: -5 }] });
    expect(r.success).toBe(false);
    const snacks = (await call('get-menu')).data.categories.find(c => c.name === 'Snacks');
    expect(snacks.products.some(p => p.name === 'Bad Toast')).toBe(false);
  });

  test('add-product stores valid add-ons', async () => {
    const r = await call('add-product', 'Snacks', { name: 'Good Toast', price: 40, addons: [{ name: 'Jam', price: 5 }] });
    expect(r.success).toBe(true);
    const toast = r.data.categories.find(c => c.name === 'Snacks').products.find(p => p.name === 'Good Toast');
    expect(toast.addons).toEqual([{ name: 'Jam', price: 5 }]);
  });

  test('add-addon rejects an absurd price', async () => {
    expect((await call('add-addon', 'Snacks', 'Good Toast', { name: 'Gold Leaf', price: 1e9 })).success).toBe(false);
  });

  test('rename / toggle reject non-string names', async () => {
    expect((await call('rename-category', 42, 'X')).success).toBe(false);
    expect((await call('rename-category', 'Snacks', { x: 1 })).success).toBe(false);
    expect((await call('toggle-product-availability', null, 'Good Toast')).success).toBe(false);
  });
});

describe('log-event', () => {
  const logsDir = path.join(mockTmp, 'logs');

  test('renderer logs go to the rotated app log and are size-capped', async () => {
    const huge = 'x'.repeat(200000);
    expect((await call('log-event', { type: 'UI_ERROR', message: huge })).success).toBe(true);

    // No separate, never-rotated YYYY-MM-DD.log file.
    expect(fs.readdirSync(logsDir).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))).toEqual([]);

    const lines = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('app-'))
      .flatMap(f => fs.readFileSync(path.join(logsDir, f), 'utf8').split('\n'))
      .filter(l => l.includes('"source":"renderer"') && l.includes('UI_ERROR'));
    expect(lines.length).toBeGreaterThan(0);
    expect(Math.max(...lines.map(l => l.length))).toBeLessThan(10000);
  });

  test('odd payloads are logged without failing', async () => {
    expect((await call('log-event', 'plain text')).success).toBe(true);
    expect((await call('log-event', null)).success).toBe(true);
    expect((await call('log-event', { type: '../../etc', message: 'x' })).success).toBe(true);
  });
});
