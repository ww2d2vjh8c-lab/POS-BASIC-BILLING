'use strict';

/**
 * main.js — Electron main-process entry point.
 *
 * Responsibilities (only):
 *   1. App lifecycle (single-instance lock, ready, quit)
 *   2. BrowserWindow creation
 *   3. Register IPC domain modules
 *   4. Schedule recurring background tasks
 *
 * All business logic lives in src/main/ipc/ and src/main/services/.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const logger     = require('./logger');
const { logEvent } = require('./logger');
const { getDB, closeDB, verifyDatabaseIntegrity } = require('./db/database');
const { migrateFromJSON }    = require('./db/migrate');
const { ensureDataFilesExist, getUserDataPath } = require('./services/file.service');
const { loadSessions }       = require('./services/session.service');
const { createBackup, cleanOldBackups, ensureBackupDirectory } = require('./services/backup.service');
const { runHealthChecks }    = require('./services/health.service');
const cfg = require('../../config/app.config');

// ── Validate Electron context ─────────────────────────────────────────────────
if (!app || typeof app.getPath !== 'function') {
  console.error('Electron app context is unavailable.');
  process.exit(1);
}

// ── Single-instance lock ──────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    const w = windows[0];
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

// ── IPC monitoring wrapper ────────────────────────────────────────────────────
const monitorState = { ipcCallsLastMinute: 0, ipcCallsTotal: 0 };
const _originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => _originalHandle(channel, async (event, ...args) => {
  const t0 = Date.now();
  monitorState.ipcCallsLastMinute++;
  monitorState.ipcCallsTotal++;
  try {
    return await handler(event, ...args);
  } finally {
    const ms = Date.now() - t0;
    if (ms > cfg.SLOW_IPC_THRESHOLD_MS) logEvent({ type: 'SLOW_IPC', channel, durationMs: ms });
  }
});

// ── isDev ─────────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !(app?.isPackaged);

// ── Production hardening ──────────────────────────────────────────────────────
if (!isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
  app.on('web-contents-created', (_e, contents) => {
    contents.on('new-window', (e) => e.preventDefault());
  });
}

// ── Window creation ───────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:  1200,
    height: 800,
    show:   false,
    icon:   path.join(__dirname, '..', '..', '..', 'assets', 'icons', 'app-icon.png'),
    webPreferences: {
      nodeIntegration:        false,
      contextIsolation:       true,
      preload:                path.join(__dirname, 'preload.js'),
      sandbox:                false,
      enableRemoteModule:     false,
      webSecurity:            true,
      allowRunningInsecureContent: false,
      experimentalFeatures:   false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn('WINDOW_BLOCKED', { url });
    return { action: 'deny' };
  });

  if (!isDev) {
    win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());
  }

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools();
}

// ── Startup sequence ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  getUserDataPath();         // cache userData path early
  ensureDataFilesExist();    // bootstrap seed files on first run
  getDB();                   // open / initialise SQLite

  const integrity = verifyDatabaseIntegrity();
  if (!integrity.valid) {
    logger.error('DATABASE_INTEGRITY_STARTUP_FAILED', { error: integrity.error });
    logEvent({ type: 'DATABASE_INTEGRITY_FAILED', error: integrity.error });
  } else {
    logEvent({ type: 'DATABASE_INTEGRITY_OK' });
  }

  migrateFromJSON();
  loadSessions();
  ensureBackupDirectory();
  createBackup();
  cleanOldBackups();
  cleanupOldOrders();
  logger.rotateLogs();

  // Register all IPC domain modules
  require('./ipc/menu.ipc').register(ipcMain);
  require('./ipc/orders.ipc').register(ipcMain);
  require('./ipc/billing.ipc').register(ipcMain);
  require('./ipc/inventory.ipc').register(ipcMain);
  require('./ipc/dashboard.ipc').register(ipcMain);
  require('./ipc/settings.ipc').register(ipcMain);
  require('./ipc/printer.ipc').register(ipcMain);
  require('./ipc/system.ipc').register(ipcMain);

  createWindow();
  runHealthChecks();
});

// ── App lifecycle events ──────────────────────────────────────────────────────
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  event.preventDefault();
  try {
    logger.info('APP_SHUTDOWN_START');
    const db = getDB();
    if (db) db.pragma('wal_checkpoint(FULL)');
    closeDB();
    logger.info('APP_SHUTDOWN_CLEAN');
  } catch (e) {
    logger.error('APP_SHUTDOWN_ERROR', { error: e.message });
  } finally {
    app.exit(0);
  }
});

process.on('unhandledRejection', (reason) => {
  logEvent({ type: 'MAIN_UNHANDLED_REJECTION', reason: reason?.toString(), stack: reason?.stack });
});
process.on('uncaughtException', (error) => {
  logEvent({ type: 'MAIN_UNCAUGHT_EXCEPTION', message: error.message, stack: error.stack });
  app.quit();
});

// ── Recurring background tasks ────────────────────────────────────────────────
function cleanupOldOrders() {
  try {
    const db     = getDB();
    const result = db.prepare(
      "DELETE FROM orders WHERE status = 'completed' AND updated_at < datetime('now', '-7 days')"
    ).run();
    if (result.changes > 0) logger.info('ORDERS_CLEANUP', { deleted: result.changes });
  } catch (e) {
    logger.error('ORDERS_CLEANUP_FAILED', { error: e.message });
  }
}

setInterval(() => {
  try { createBackup(); } catch (e) { logger.error('SCHEDULED_BACKUP_FAILED', { error: e.message }); }
}, cfg.BACKUP_INTERVAL_MS);

setInterval(cleanupOldOrders, cfg.CLEANUP_INTERVAL_MS);

setInterval(() => {
  logger.info('IPC_MINUTE_SUMMARY', {
    ipcCallsLastMinute: monitorState.ipcCallsLastMinute,
    ipcCallsTotal:      monitorState.ipcCallsTotal,
  });
  monitorState.ipcCallsLastMinute = 0;
}, cfg.MONITOR_INTERVAL_MS);

setInterval(() => {
  const m = process.memoryUsage();
  logEvent({ type: 'MEMORY_USAGE', rss: m.rss, heapTotal: m.heapTotal, heapUsed: m.heapUsed });
}, cfg.MEMORY_LOG_INTERVAL_MS);
