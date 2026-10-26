'use strict';

/**
 * backup.service.js
 *
 * Backup creation, verification, rotation and restore.
 *
 * Layout: userData/backups/YYYY-MM-DD/{bloom-cafe.db, menu.json, inventory.json}
 * Today's folder is refreshed on every backup, so it always holds the latest
 * good copy; older folders hold each day's last backup.
 */

const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const logger             = require('../logger');
const { logEvent }       = require('../logger');
const { getBackupPath, getToday, getMenuFile, getInventoryFile } = require('./file.service');
const database = require('../db/database');
const { migrateFromJSON } = require('../db/migrate');
const cfg = require('../../../config/app.config');

const BACKUP_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;
/** settings key holding a manual restore's info across the restart. */
const PENDING_RECOVERY_KEY = 'pendingRecoveryNotice';

// ── Directory bootstrap ───────────────────────────────────────────────────────
function ensureBackupDirectory() {
  const dir = getBackupPath();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Verification ──────────────────────────────────────────────────────────────
/**
 * True if `file` is a readable, undamaged Bloom Cafe database.
 * Never throws.
 */
function verifyBackupFile(file) {
  let db = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = db.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || rows[0].integrity_check !== 'ok') return false;
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bills'").get();
  } catch (e) {
    logger.warn('BACKUP_VERIFY_FAILED', { file, error: e.message });
    return false;
  } finally {
    try { if (db) db.close(); } catch (_e) {}
  }
}

// ── Create backup ─────────────────────────────────────────────────────────────
/** Copies a file via a temp file + rename, so the old copy survives a crash mid-copy. */
function copyAtomic(src, dest) {
  const tmp = `${dest}.tmp`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dest);
}

/**
 * Writes a consistent snapshot of the live database to `dest`.
 * VACUUM INTO reads inside one transaction, so it includes everything still
 * in the WAL file (a plain file copy of a WAL database silently misses recent
 * bills). The snapshot is verified before it replaces the previous backup,
 * so a damaged database can never overwrite the last good copy.
 */
function backupDatabaseTo(dest) {
  const tmp = `${dest}.tmp`;
  fs.rmSync(tmp, { force: true });
  try {
    database.getDB().prepare('VACUUM INTO ?').run(tmp);
    if (!verifyBackupFile(tmp)) throw new Error('backup copy failed verification');
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  logger.info('BACKUP_VERIFIED', { path: dest, size: fs.statSync(dest).size });
}

/**
 * Backs up the database (and the legacy menu/inventory JSON files) into
 * today's folder under userData/backups/.
 * Returns { success: true, filesBackedUp } or { success: false, error }.
 */
function createBackup() {
  try {
    const today        = getToday();
    const backupSubDir = path.join(getBackupPath(), today);
    fs.mkdirSync(backupSubDir, { recursive: true });

    let filesBackedUp = 0;
    for (const src of [getMenuFile(), getInventoryFile()]) {
      if (!fs.existsSync(src)) continue;
      copyAtomic(src, path.join(backupSubDir, path.basename(src)));
      filesBackedUp++;
    }

    const { degraded } = database.getDatabaseState();
    if (degraded) {
      // Keep the last good backup instead of replacing it with damaged data.
      logger.error('BACKUP_DB_SKIPPED_DEGRADED', { reason: degraded.reason });
    } else {
      backupDatabaseTo(path.join(backupSubDir, database.DB_FILE_NAME));
      filesBackedUp++;
    }

    logger.info('BACKUP_CREATED', { date: today, files: filesBackedUp });
    logEvent({ type: 'BACKUP_CREATED', date: today, files: filesBackedUp });
    return { success: true, filesBackedUp };

  } catch (error) {
    logger.error('BACKUP_FAILED', { error: error.message, stack: error.stack });
    logEvent({ type: 'BACKUP_FAILED', error: error.message });
    return { success: false, error: `Backup creation failed: ${error.message}. Check disk space and permissions.` };
  }
}

// ── List / find ───────────────────────────────────────────────────────────────
/** Dated backup folders that contain a database copy, newest first. */
function listBackups() {
  const backupDir = getBackupPath();
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(name => BACKUP_DIR_RE.test(name))
    .map(name => {
      const file = path.join(backupDir, name, database.DB_FILE_NAME);
      try {
        const stat = fs.statSync(file);
        return { date: name, path: file, size: stat.size, modifiedAt: stat.mtime.toISOString() };
      } catch (_e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** The newest backup that passes verification, or null. */
function findLatestGoodBackup() {
  return listBackups().find(b => verifyBackupFile(b.path)) || null;
}

// ── Restore ───────────────────────────────────────────────────────────────────
/**
 * Swaps the live database file for `srcFile` (or for nothing, so a fresh
 * database is created on the next open). The current file and its WAL are
 * never deleted: they are renamed to "bloom-cafe.db.<reason>-<timestamp>"
 * so nothing is lost if the swap was a mistake.
 * Returns { preservedAs } — the path the old file was moved to, if any.
 */
function replaceDatabaseFile(srcFile, reason) {
  const dbPath = database.getDBPath();
  database.closeDB();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let preservedAs = null;
  if (fs.existsSync(dbPath)) {
    preservedAs = `${dbPath}.${reason}-${stamp}`;
    fs.renameSync(dbPath, preservedAs);
  }
  for (const suffix of ['-wal', '-shm']) {
    const f = dbPath + suffix;
    if (!fs.existsSync(f)) continue;
    if (preservedAs) fs.renameSync(f, preservedAs + suffix);
    else fs.rmSync(f, { force: true });
  }
  if (srcFile) copyAtomic(srcFile, dbPath);
  return { preservedAs };
}

/**
 * Restores the database from the backup taken on `date` (YYYY-MM-DD).
 * The current database is kept next to it (see replaceDatabaseFile) and the
 * restored copy is migrated to the current schema.
 */
function restoreBackup(date) {
  if (typeof date !== 'string' || !BACKUP_DIR_RE.test(date)) {
    return { success: false, error: 'Invalid backup date' };
  }
  const backup = listBackups().find(b => b.date === date);
  if (!backup) return { success: false, error: 'Backup not found' };
  if (!verifyBackupFile(backup.path)) return { success: false, error: 'Backup file is damaged' };

  try {
    const { preservedAs } = replaceDatabaseFile(backup.path, 'before-restore');
    database.getDB();
    migrateFromJSON();
    const info = { at: new Date().toISOString(), reason: 'manual restore', restoredFrom: date, preservedAs };
    database.setRecoveryInfo(info);
    // The app restarts right after a restore, which clears the in-memory info;
    // keep it in the restored database so the next launch can confirm it.
    database.getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(PENDING_RECOVERY_KEY, JSON.stringify(info));
    logger.warn('DATABASE_RESTORED_BY_USER', { from: date, previousSavedAs: preservedAs });
    logEvent({ type: 'DATABASE_RESTORED_BY_USER', from: date, previousSavedAs: preservedAs });
    return { success: true, data: { restoredFrom: date, previousSavedAs: preservedAs } };
  } catch (e) {
    logger.error('DATABASE_RESTORE_FAILED', { from: date, error: e.message, stack: e.stack });
    return { success: false, error: `Restore failed: ${e.message}` };
  }
}

// ── Clean old backups ─────────────────────────────────────────────────────────
/**
 * Deletes dated backup folders older than BACKUP_RETENTION_DAYS, but always
 * keeps the newest BACKUP_MIN_KEEP of them — after a long closure (or if
 * today's backup failed) the café must never be left with no backup at all.
 * Folders that are not YYYY-MM-DD are never touched.
 */
function cleanOldBackups() {
  try {
    const backupDir = getBackupPath();
    if (!fs.existsSync(backupDir)) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cfg.BACKUP_RETENTION_DAYS);
    const cutoffDate = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

    const dated = fs.readdirSync(backupDir)
      .filter(name => BACKUP_DIR_RE.test(name) && fs.statSync(path.join(backupDir, name)).isDirectory())
      .sort()
      .reverse();

    dated.slice(cfg.BACKUP_MIN_KEEP).forEach(name => {
      if (name >= cutoffDate) return;
      fs.rmSync(path.join(backupDir, name), { recursive: true, force: true });
      logEvent({ type: 'BACKUP_CLEANUP', deleted: name });
    });
  } catch (e) {
    logger.error('BACKUP_CLEANUP_FAILED', { error: e.message });
  }
}

/**
 * Returns (and forgets) the restore info saved before the last restart, so
 * the "backup restored" notice is shown once after the app comes back.
 */
function takePendingRecoveryNotice() {
  const db = database.getDB();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PENDING_RECOVERY_KEY);
  if (!row) return null;
  db.prepare('DELETE FROM settings WHERE key = ?').run(PENDING_RECOVERY_KEY);
  try { return JSON.parse(row.value); } catch (_e) { return null; }
}

module.exports = {
  PENDING_RECOVERY_KEY, takePendingRecoveryNotice,
  ensureBackupDirectory, createBackup, cleanOldBackups,
  listBackups, verifyBackupFile, findLatestGoodBackup, replaceDatabaseFile, restoreBackup,
};
