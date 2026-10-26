'use strict';

/**
 * startup.service.js — brings the data layer up and down.
 *
 * Startup must never leave the till dead:
 *   - Every step except opening the database is isolated: if it fails it is
 *     logged and the app still starts.
 *   - A damaged database file is moved aside (never deleted) and replaced
 *     with the newest backup that passes verification; with no backup, a
 *     fresh database is created so billing can continue.
 *   - A database that is merely locked or unreadable for another reason is
 *     NOT replaced — that error is thrown so main.js can tell the user.
 */

const logger       = require('../logger');
const { logEvent } = require('../logger');
const database     = require('../db/database');
const queries      = require('../db/queries');
const { migrateFromJSON }      = require('../db/migrate');
const { ensureDataFilesExist } = require('./file.service');
const { loadSessions }         = require('./session.service');
const backup                   = require('./backup.service');

function runStep(step, fn) {
  try {
    return fn();
  } catch (e) {
    logger.error('STARTUP_STEP_FAILED', { step, error: e.message, stack: e.stack });
    return undefined;
  }
}

/** Replaces the damaged database with the newest good backup (or a new file). */
function recoverDatabase(reason) {
  const latest = backup.findLatestGoodBackup();
  const { preservedAs } = backup.replaceDatabaseFile(latest ? latest.path : null, 'corrupt');
  database.getDB();
  const info = {
    at:           new Date().toISOString(),
    reason,
    restoredFrom: latest ? latest.date : null,
    preservedAs,
  };
  database.setRecoveryInfo(info);
  const event = latest ? 'DATABASE_RESTORED_FROM_BACKUP' : 'DATABASE_RECREATED_EMPTY';
  logger.error(event, info);
  logEvent({ type: event, ...info });
  return info;
}

/**
 * Opens the database, checking it and recovering from corruption.
 * Returns { recovered, degraded }. Throws only if the file cannot be used at
 * all for a reason other than corruption (locked, permissions, disk).
 */
function openDatabaseWithRecovery() {
  try {
    database.getDB();
  } catch (e) {
    if (!database.isCorruptionError(e)) throw e;
    logger.error('DATABASE_OPEN_FAILED_CORRUPT', { error: e.message, code: e.code });
    return { recovered: recoverDatabase(e.message), degraded: false };
  }

  const integrity = database.verifyDatabaseIntegrity();
  if (integrity.valid) {
    logEvent({ type: 'DATABASE_INTEGRITY_OK' });
    return { recovered: null, degraded: false };
  }

  logger.error('DATABASE_INTEGRITY_STARTUP_FAILED', { error: integrity.error, corrupt: !!integrity.corrupt });
  logEvent({ type: 'DATABASE_INTEGRITY_FAILED', error: integrity.error });
  if (!integrity.corrupt) {
    // e.g. foreign-key violations: data needs tidying, but the file is fine.
    return { recovered: null, degraded: false };
  }

  if (backup.findLatestGoodBackup()) {
    const recovered = recoverDatabase(integrity.error);
    if (database.verifyDatabaseIntegrity().valid) return { recovered, degraded: false };
    database.markDegraded('restored database failed its integrity check');
    return { recovered, degraded: true };
  }

  // Nothing to restore from: keep billing on the damaged file rather than
  // stop the till, and stop backups from overwriting older good copies.
  database.markDegraded(integrity.error);
  logger.error('DATABASE_RUNNING_DEGRADED', { error: integrity.error });
  return { recovered: null, degraded: true };
}

/** Everything the main process needs before IPC handlers are registered. */
function initDataLayer() {
  runStep('DATA_FILES', ensureDataFilesExist);
  const status = openDatabaseWithRecovery();
  runStep('MIGRATIONS', migrateFromJSON);
  runStep('PENDING_RECOVERY_NOTICE', () => {
    const pending = backup.takePendingRecoveryNotice();
    if (pending && !status.recovered) database.setRecoveryInfo(pending);
  });
  runStep('SESSIONS', loadSessions);
  runStep('BACKUP', () => {
    backup.ensureBackupDirectory();
    backup.createBackup();
    backup.cleanOldBackups();
  });
  runStep('ORDERS_CLEANUP', () => {
    const deleted = queries.cleanupOldOrders();
    if (deleted > 0) logger.info('ORDERS_CLEANUP', { deleted });
  });
  runStep('LOG_ROTATE', logger.rotateLogs);
  return status;
}

/**
 * Called on quit: takes a final backup (so the day's last bills are in it),
 * checkpoints the WAL and closes the database. Never opens a database that
 * was not open. Never throws.
 */
function shutdownDataLayer() {
  if (!database.isDBOpen()) return;
  runStep('SHUTDOWN_BACKUP', backup.createBackup);
  runStep('SHUTDOWN_CHECKPOINT', () => database.getDB().pragma('wal_checkpoint(TRUNCATE)'));
  runStep('SHUTDOWN_CLOSE', database.closeDB);
}

module.exports = { initDataLayer, openDatabaseWithRecovery, shutdownDataLayer };
