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

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

const logger     = require('./logger');
const { logEvent } = require('./logger');
const queries    = require('./db/queries');
const { createBackup } = require('./services/backup.service');
const { runHealthChecks }    = require('./services/health.service');
const { initDataLayer, shutdownDataLayer } = require('./services/startup.service');
const { secureWebPreferences, hardenWebContents } = require('./security');
const cfg = require('../../config/app.config');

// ── Validate Electron context ─────────────────────────────────────────────────
if (!app || typeof app.getPath !== 'function') {
  console.error('Electron app context is unavailable.');
  process.exit(1);
}

// Allow tests / multi-store setups to point the app at an isolated data folder.
if (process.env.POS_USER_DATA) app.setPath('userData', process.env.POS_USER_DATA);

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

// ── Hardening (every webContents, dev and production) ─────────────────────────
if (!isDev) process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
app.on('web-contents-created', (_e, contents) => hardenWebContents(contents));

// ── Window creation ───────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:  1200,
    height: 800,
    show:   false,
    icon:   path.join(__dirname, '..', '..', 'assets', 'icons', 'app-logo-256.png'),
    webPreferences: secureWebPreferences(path.join(__dirname, 'preload.js')),
  });

  if (!isDev) {
    win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());
  }

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev && !process.env.POS_USER_DATA) win.webContents.openDevTools();
}

// ── Startup sequence ──────────────────────────────────────────────────────────
function startApp() {
  try {
    const status = initDataLayer();   // open/recover DB, migrate, sessions, backup
    if (status.recovered) logger.warn('STARTUP_AFTER_DB_RECOVERY', status.recovered);

    // Register all IPC domain modules
    require('./ipc/menu.ipc').register(ipcMain);
    require('./ipc/orders.ipc').register(ipcMain);
    require('./ipc/billing.ipc').register(ipcMain);
    require('./ipc/inventory.ipc').register(ipcMain);
    require('./ipc/dashboard.ipc').register(ipcMain);
    require('./ipc/settings.ipc').register(ipcMain);
    require('./ipc/printer.ipc').register(ipcMain);
    require('./ipc/system.ipc').register(ipcMain);
  } catch (e) {
    // Without this the process would stay alive with no window, holding the
    // single-instance lock, and every later launch would silently do nothing.
    logger.error('STARTUP_FATAL', { error: e.message, code: e.code, stack: e.stack });
    const locked = e && /BUSY|LOCKED/.test(String(e.code));
    dialog.showErrorBox(
      'Bloom Cafe POS could not start',
      locked
        ? 'The sales database is being used by another program. Close any other copy of Bloom Cafe POS (or restart the computer) and open it again.'
        : `The sales database could not be opened.\n\n${e.message}\n\nYour data has not been changed. Please restart the computer and try again, and contact support if this keeps happening.`
    );
    app.exit(1);
    return;
  }

  createWindow();
  startBackgroundTasks();
  runHealthChecks().catch(e => logger.error('HEALTH_CHECK_FAILED', { error: e.message }));
}

app.whenReady().then(startApp).catch(e => {
  logger.error('STARTUP_FATAL', { error: e?.message, stack: e?.stack });
  app.exit(1);
});

// ── App lifecycle events ──────────────────────────────────────────────────────
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  event.preventDefault();
  try {
    logger.info('APP_SHUTDOWN_START');
    shutdownDataLayer();   // final backup, WAL checkpoint, close
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
  // Log and keep running: closing the till mid-service loses the cashier's
  // work, and every write is already in a SQLite transaction.
  logEvent({ type: 'MAIN_UNCAUGHT_EXCEPTION', message: error?.message, stack: error?.stack });
  logger.error('MAIN_UNCAUGHT_EXCEPTION', { error: error?.message });
});

// ── Recurring background tasks ────────────────────────────────────────────────
// Started only after a successful startup; each one is guarded so a failing
// timer can never throw into the event loop.
function every(ms, name, fn) {
  setInterval(() => {
    try { fn(); } catch (e) { logger.error(`${name}_FAILED`, { error: e.message }); }
  }, ms);
}

function startBackgroundTasks() {
  every(cfg.BACKUP_INTERVAL_MS, 'SCHEDULED_BACKUP', createBackup);

  every(cfg.CLEANUP_INTERVAL_MS, 'ORDERS_CLEANUP', () => {
    const deleted = queries.cleanupOldOrders();
    if (deleted > 0) logger.info('ORDERS_CLEANUP', { deleted });
  });

  every(cfg.MONITOR_INTERVAL_MS, 'IPC_MINUTE_SUMMARY', () => {
    logger.info('IPC_MINUTE_SUMMARY', {
      ipcCallsLastMinute: monitorState.ipcCallsLastMinute,
      ipcCallsTotal:      monitorState.ipcCallsTotal,
    });
    monitorState.ipcCallsLastMinute = 0;
  });

  every(cfg.MEMORY_LOG_INTERVAL_MS, 'MEMORY_USAGE', () => {
    const m = process.memoryUsage();
    logEvent({ type: 'MEMORY_USAGE', rss: m.rss, heapTotal: m.heapTotal, heapUsed: m.heapUsed });
  });
}
