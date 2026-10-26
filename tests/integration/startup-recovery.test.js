'use strict';

/**
 * What happens when the app starts on a damaged, locked or half-migrated
 * database. Each test boots the data layer from scratch (fresh modules,
 * fresh userData folder), exactly like a new launch of the app.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const mockState = { dir: null };
jest.mock('electron', () => ({
  app: { getPath: () => mockState.dir, isPackaged: true, getVersion: () => 'test' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

const dirs = [];
let mods = null;

function newDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-boot-'));
  dirs.push(d);
  return d;
}

/** A fresh "app launch": new module instances pointed at `dir`. */
function boot(dir = newDir()) {
  if (mods) { try { mods.database.closeDB(); } catch (_e) {} }
  jest.resetModules();
  mockState.dir = dir;
  mods = {
    dir,
    database: require('../../src/main/db/database'),
    migrate:  require('../../src/main/db/migrate'),
    startup:  require('../../src/main/services/startup.service'),
    backup:   require('../../src/main/services/backup.service'),
    health:   require('../../src/main/services/health.service'),
  };
  return mods;
}

const dbFile = (dir) => path.join(dir, 'bloom-cafe.db');
const GARBAGE = 'this is not a database — the disk lost it '.repeat(200);

function billNos(db) {
  return db.prepare('SELECT bill_no FROM bills').all().map(r => r.bill_no);
}

/** Builds a closed, healthy database file containing one known bill. */
function makeDatabaseWithBill(billNo) {
  const m = boot();
  m.database.getDB();
  m.migrate.migrateFromJSON();
  m.database.getDB().prepare(
    "INSERT INTO bills (bill_no, order_id, items, total, bill_date) VALUES (?, 'Table 1', '[]', 99, '2026-01-01')"
  ).run(billNo);
  m.database.closeDB();
  return dbFile(m.dir);
}

function placeBackup(dir, date, srcFileOrContent) {
  const d = path.join(dir, 'backups', date);
  fs.mkdirSync(d, { recursive: true });
  if (fs.existsSync(srcFileOrContent)) fs.copyFileSync(srcFileOrContent, path.join(d, 'bloom-cafe.db'));
  else fs.writeFileSync(path.join(d, 'bloom-cafe.db'), srcFileOrContent);
}

/** Copies a healthy DB and damages the bills table's root page. */
function writeDamagedCopy(srcFile, destFile) {
  const src = new Database(srcFile, { readonly: true });
  const root = src.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'bills'").get().rootpage;
  const pageSize = src.pragma('page_size', { simple: true });
  src.close();
  fs.copyFileSync(srcFile, destFile);
  const fd = fs.openSync(destFile, 'r+');
  fs.writeSync(fd, Buffer.alloc(64, 0xff), 0, 64, (root - 1) * pageSize);
  fs.closeSync(fd);
}

const preservedFiles = (dir, tag) => fs.readdirSync(dir)
  .filter(f => f.startsWith(`bloom-cafe.db.${tag}-`) && !/-(wal|shm)$/.test(f));

afterEach(() => {
  if (mods) { try { mods.database.closeDB(); } catch (_e) {} }
});

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

// ── Recovery ──────────────────────────────────────────────────────────────────

test('a file that is not a database is replaced by the newest good backup', async () => {
  const good = makeDatabaseWithBill('BC-20260101-1');
  const dir = newDir();
  placeBackup(dir, '2026-01-01', good);
  placeBackup(dir, '2026-01-02', GARBAGE);            // newest backup is itself damaged
  fs.writeFileSync(dbFile(dir), GARBAGE);

  const m = boot(dir);
  const status = m.startup.initDataLayer();

  expect(status.recovered).toMatchObject({ restoredFrom: '2026-01-01' });
  expect(billNos(m.database.getDB())).toContain('BC-20260101-1');
  // The damaged file is kept, never deleted.
  const kept = preservedFiles(dir, 'corrupt');
  expect(kept).toHaveLength(1);
  expect(fs.readFileSync(path.join(dir, kept[0]), 'utf8')).toBe(GARBAGE);
  // The owner is told through the health check.
  const health = await m.health.runHealthChecks();
  expect(health.recovery).toMatchObject({ restoredFrom: '2026-01-01' });
  expect(health.database).toBe(true);
});

test('a file with damaged pages is restored from backup', () => {
  const good = makeDatabaseWithBill('BC-20260101-7');
  const dir = newDir();
  placeBackup(dir, '2026-01-01', good);
  writeDamagedCopy(good, dbFile(dir));

  const m = boot(dir);
  const status = m.startup.initDataLayer();
  expect(status).toMatchObject({ degraded: false, recovered: { restoredFrom: '2026-01-01' } });
  expect(m.database.verifyDatabaseIntegrity().valid).toBe(true);
  expect(billNos(m.database.getDB())).toContain('BC-20260101-7');
  expect(preservedFiles(dir, 'corrupt')).toHaveLength(1);
});

test('with no backup, a damaged file is set aside and a fresh database starts', () => {
  const dir = newDir();
  fs.writeFileSync(dbFile(dir), GARBAGE);

  const m = boot(dir);
  const status = m.startup.initDataLayer();
  expect(status.recovered).toMatchObject({ restoredFrom: null });
  expect(preservedFiles(dir, 'corrupt')).toHaveLength(1);
  const db = m.database.getDB();
  expect(db.prepare('SELECT COUNT(*) AS c FROM categories').get().c).toBeGreaterThan(0);
  expect(m.migrate.getMigrationVersion()).toBe(5);
});

test('damaged pages with no good backup: keep billing, flag it, and do not overwrite backups', async () => {
  const good = makeDatabaseWithBill('BC-20260101-3');
  const dir = newDir();
  placeBackup(dir, '2026-01-01', GARBAGE);            // only backup is unusable
  writeDamagedCopy(good, dbFile(dir));

  const m = boot(dir);
  const status = m.startup.initDataLayer();
  expect(status.degraded).toBe(true);
  expect(preservedFiles(dir, 'corrupt')).toHaveLength(0);   // still running on the original
  const today = require('../../src/main/services/file.service').getToday();
  expect(fs.existsSync(path.join(dir, 'backups', today, 'bloom-cafe.db'))).toBe(false);
  const health = await m.health.runHealthChecks();
  expect(health.status).toBe('degraded');
  expect(health.degraded).toMatchObject({ reason: expect.any(String) });
});

test('foreign-key problems are reported but never trigger a restore', () => {
  const m1 = boot();
  m1.startup.initDataLayer();
  const db1 = m1.database.getDB();
  db1.pragma('foreign_keys = OFF');
  db1.prepare('INSERT INTO product_addons (product_id, addon_id) VALUES (99999, 99999)').run();
  db1.prepare("INSERT INTO bills (bill_no, order_id, items, total, bill_date) VALUES ('BC-20990101-1', 'T', '[]', 1, '2099-01-01')").run();
  const dir = m1.dir;

  const m2 = boot(dir);   // backups exist from the first launch
  expect(m2.backup.findLatestGoodBackup()).not.toBeNull();
  const status = m2.startup.initDataLayer();
  expect(status.recovered).toBeNull();
  expect(billNos(m2.database.getDB())).toContain('BC-20990101-1');
  expect(preservedFiles(dir, 'corrupt')).toHaveLength(0);
});

test('a locked database is reported, not mistaken for a damaged one', () => {
  const good = makeDatabaseWithBill('BC-20260101-2');
  const dir = newDir();
  fs.copyFileSync(good, dbFile(dir));
  placeBackup(dir, '2026-01-01', good);

  const m = boot(dir);
  jest.spyOn(m.database, 'getDB').mockImplementationOnce(() => {
    const e = new Error('database is locked');
    e.code = 'SQLITE_BUSY';
    throw e;
  });
  expect(() => m.startup.initDataLayer()).toThrow('database is locked');
  expect(preservedFiles(dir, 'corrupt')).toHaveLength(0);
  expect(fs.readFileSync(dbFile(dir))).toEqual(fs.readFileSync(good));
});

test('a failed open does not leave a half-initialised connection behind', () => {
  const dir = newDir();
  fs.writeFileSync(dbFile(dir), GARBAGE);
  const m = boot(dir);
  expect(() => m.database.getDB()).toThrow();
  expect(m.database.isDBOpen()).toBe(false);
  expect(() => m.database.getDB()).toThrow();   // not a cached broken handle
});

// ── Migrations ────────────────────────────────────────────────────────────────

test('a migration whose column could not be added is not marked as done', () => {
  const m = boot();
  const db = m.database.getDB();
  m.migrate.migrateFromJSON();
  db.exec('ALTER TABLE bills DROP COLUMN cash_received');
  m.migrate.setMigrationVersion(3);

  const exec = db.exec.bind(db);
  db.exec = (sql) => {
    if (/ADD COLUMN cash_received/.test(sql)) {
      const e = new Error('disk I/O error');
      e.code = 'SQLITE_IOERR';
      throw e;
    }
    return exec(sql);
  };
  try {
    m.migrate.migrateFromJSON();
  } finally {
    db.exec = exec;
  }
  expect(m.migrate.getMigrationVersion()).toBe(3);

  // Next launch: the disk is fine again and the migration completes.
  m.migrate.migrateFromJSON();
  expect(m.migrate.getMigrationVersion()).toBe(5);
  const cols = db.prepare('PRAGMA table_info(bills)').all().map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining(['cash_received', 'discount_amount', 'stock_deducted']));
});

test('a damaged legacy menu.json does not stop the schema migrations', () => {
  const dir = newDir();
  fs.writeFileSync(path.join(dir, 'menu.json'), '{ "categories": [ broken');
  const m = boot(dir);
  m.database.getDB();
  expect(() => m.migrate.migrateFromJSON()).not.toThrow();
  expect(m.migrate.getMigrationVersion()).toBe(5);
  const cols = m.database.getDB().prepare('PRAGMA table_info(bills)').all().map(c => c.name);
  expect(cols).toContain('discount_amount');
});

// ── Bill counter ──────────────────────────────────────────────────────────────

test('the bill counter is rebuilt from the highest bill number, not the count', () => {
  const m1 = boot();
  const db1 = m1.database.getDB();
  m1.migrate.migrateFromJSON();
  const ins = db1.prepare("INSERT INTO bills (bill_no, order_id, items, total, bill_date) VALUES (?, 'T', '[]', 1, '2026-01-01')");
  ins.run('BC-20260101-1');
  ins.run('BC-20260101-5'); // bills 2–4 were deleted
  db1.exec('DELETE FROM bill_sequences');
  const dir = m1.dir;

  const m2 = boot(dir);
  const db2 = m2.database.getDB();
  expect(db2.prepare("SELECT last_number FROM bill_sequences WHERE bill_date = '2026-01-01'").get().last_number).toBe(5);
  const queries = require('../../src/main/db/queries');
  expect(db2.transaction(() => queries.generateBillNo('2026-01-01'))()).toBe('BC-20260101-6');
});
