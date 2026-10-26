'use strict';

/**
 * Backups must be complete (include bills still in the WAL file), must never
 * be replaced by a damaged copy, must be pruned without leaving the café
 * with nothing, and must be restorable.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const mockTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-backup-'));
const mockApp = { relaunch: jest.fn(), exit: jest.fn() };

jest.mock('electron', () => {
  const win = { webContents: { getPrintersAsync: async () => [], print: (opts, cb) => cb(true) } };
  return {
    app: {
      getPath: () => mockTmp, isPackaged: true, getVersion: () => 'test',
      relaunch: (...a) => mockApp.relaunch(...a), exit: (...a) => mockApp.exit(...a),
    },
    BrowserWindow: { getFocusedWindow: () => win, getAllWindows: () => [win] },
  };
});

const handlers = {};
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
const call = (ch, ...args) => handlers[ch]({}, ...args);

let database;
const today = () => require('../../src/main/services/file.service').getToday();
const backupsDir = path.join(mockTmp, 'backups');
const todaysBackup = () => path.join(backupsDir, today(), 'bloom-cafe.db');

function billNosIn(file) {
  const b = new Database(file, { readonly: true });
  try { return b.prepare('SELECT bill_no FROM bills').all().map(r => r.bill_no); } finally { b.close(); }
}

async function sell(table) {
  await call('add-to-order', table, { name: 'Tea', price: 10 });
  const r = await call('finalize-bill', { orderId: table, paymentMode: 'UPI' });
  expect(r.success).toBe(true);
  return r.data.billNo;
}

/** Overwrites the start of the bills table's root page, like a bad disk sector. */
function corruptBillsTable() {
  const db = database.getDB();
  const root = db.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'bills'").get().rootpage;
  const pageSize = db.pragma('page_size', { simple: true });
  database.closeDB(); // checkpoints the WAL into the main file
  const fd = fs.openSync(path.join(mockTmp, 'bloom-cafe.db'), 'r+');
  fs.writeSync(fd, Buffer.alloc(64, 0xff), 0, 64, (root - 1) * pageSize);
  fs.closeSync(fd);
  database.getDB();
}

beforeAll(() => {
  database = require('../../src/main/db/database');
  database.getDB();
  require('../../src/main/db/migrate').migrateFromJSON();
  for (const m of ['orders', 'billing', 'dashboard', 'settings', 'system']) {
    require(`../../src/main/ipc/${m}.ipc`).register(ipcMain);
  }
});

afterAll(() => {
  database.closeDB();
  fs.rmSync(mockTmp, { recursive: true, force: true });
});

let firstBill;

test('a backup includes bills that are still only in the WAL file', async () => {
  firstBill = await sell('Table 1');
  expect(fs.existsSync(path.join(mockTmp, 'bloom-cafe.db-wal'))).toBe(true);

  const r = await call('create-backup');
  expect(r.success).toBe(true);
  expect(billNosIn(todaysBackup())).toContain(firstBill);
});

test('a damaged database never replaces the last good backup', async () => {
  corruptBillsTable();
  const r = await call('create-backup');
  expect(r.success).toBe(false);

  const { verifyBackupFile } = require('../../src/main/services/backup.service');
  expect(verifyBackupFile(todaysBackup())).toBe(true);
  expect(billNosIn(todaysBackup())).toContain(firstBill);
  expect(fs.readdirSync(path.dirname(todaysBackup())).filter(f => f.endsWith('.tmp'))).toEqual([]);
});

test('restore-backup brings the data back, keeps the replaced file, and restarts the app', async () => {
  const r = await call('restore-backup', today());
  expect(r.success).toBe(true);
  expect(r.data).toMatchObject({ restoredFrom: today(), restarting: true });
  expect(fs.existsSync(r.data.previousSavedAs)).toBe(true);

  expect(database.verifyDatabaseIntegrity().valid).toBe(true);
  const bills = (await call('get-sales-data', today())).data.bills;
  expect(bills.map(b => b.billNo)).toContain(firstBill);

  // Billing works again and continues the sequence.
  const next = await sell('Table 2');
  expect(Number(next.split('-').pop())).toBe(Number(firstBill.split('-').pop()) + 1);

  await new Promise(res => setTimeout(res, require('../../config/app.config').RESTART_AFTER_RESTORE_MS + 200));
  expect(mockApp.relaunch).toHaveBeenCalled();
  expect(mockApp.exit).toHaveBeenCalledWith(0);
  database.getDB(); // the mocked "restart" closed it
});

test('after the restart, the restore is confirmed once', async () => {
  const startup = require('../../src/main/services/startup.service');
  database.setRecoveryInfo(null);           // a real restart starts with empty memory
  startup.initDataLayer();
  expect(database.getDatabaseState().recovery).toMatchObject({ reason: 'manual restore', restoredFrom: today() });
  expect(require('../../src/main/db/queries').readSettings()).not.toHaveProperty('pendingRecoveryNotice');

  database.setRecoveryInfo(null);           // the launch after that: nothing to show
  startup.initDataLayer();
  expect(database.getDatabaseState().recovery).toBeNull();
});

test('restore-backup only accepts an existing dated backup', async () => {
  const before = fs.readdirSync(mockTmp).sort();
  for (const bad of ['../../etc', `${today()}/../..`, '..', '', null, 42, '1999-01-01']) {
    expect((await call('restore-backup', bad)).success).toBe(false);
  }
  expect(fs.readdirSync(mockTmp).sort()).toEqual(before);
});

test('restore-backup refuses a damaged backup', async () => {
  const dir = path.join(backupsDir, '2021-06-01');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bloom-cafe.db'), 'not a database');
  const r = await call('restore-backup', '2021-06-01');
  expect(r).toEqual({ success: false, error: 'Backup file is damaged' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('list-backups shows dated backups, newest first', async () => {
  const older = path.join(backupsDir, '2020-01-02');
  fs.mkdirSync(older, { recursive: true });
  fs.copyFileSync(todaysBackup(), path.join(older, 'bloom-cafe.db'));
  const r = await call('list-backups');
  expect(r.success).toBe(true);
  expect(r.data.map(b => b.date)).toEqual([today(), '2020-01-02']);
  expect(r.data[0]).toEqual({ date: today(), size: expect.any(Number), modifiedAt: expect.any(String) });
});

test('old backups are pruned, but the newest ones are always kept', () => {
  const old = new Date('2020-02-01T00:00:00Z');
  const names = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05', 'keep-me'];
  for (const n of names) {
    fs.mkdirSync(path.join(backupsDir, n), { recursive: true });
    fs.writeFileSync(path.join(backupsDir, n, 'menu.json'), '{}');
    fs.utimesSync(path.join(backupsDir, n), old, old);
  }

  require('../../src/main/services/backup.service').cleanOldBackups();

  const left = fs.readdirSync(backupsDir).sort();
  // newest three dated folders (today, 01-05, 01-04) + the non-backup folder
  expect(left).toEqual(['2020-01-04', '2020-01-05', today(), 'keep-me'].sort());
});

test('shutdown takes a final backup with the last bills and closes the database', async () => {
  const lastBill = await sell('Table 3');
  const { shutdownDataLayer } = require('../../src/main/services/startup.service');
  shutdownDataLayer();
  expect(database.isDBOpen()).toBe(false);
  expect(billNosIn(todaysBackup())).toContain(lastBill);
  expect(fs.existsSync(path.join(mockTmp, 'bloom-cafe.db-wal'))).toBe(false);

  shutdownDataLayer(); // a second call must not reopen it
  expect(database.isDBOpen()).toBe(false);
  database.getDB();
});
