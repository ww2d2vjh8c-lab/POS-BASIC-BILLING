'use strict';

/**
 * system.ipc.js — IPC handlers for system-level operations.
 *
 * Channels: get-app-version, log-event, create-backup, list-backups,
 *           restore-backup, get-health-status, get-audit-log
 */

const { app } = require('electron');
const queries         = require('../db/queries');
const logger          = require('../logger');
const { createBackup, listBackups, restoreBackup } = require('../services/backup.service');
const { runHealthChecks } = require('../services/health.service');
const { activeOrders, loadSessions } = require('../services/session.service');
const { closeDB }     = require('../db/database');
const cfg             = require('../../../config/app.config');

const EVENT_TYPE_RE = /^[A-Z0-9_]{1,64}$/;

function register(ipcMain) {

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('get-health-status', async () => {
    try {
      const health = await runHealthChecks();
      return { success: true, data: health };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-audit-log', async () => {
    try {
      return { success: true, data: queries.readAuditLog(100) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('create-backup', async () => {
    try {
      return createBackup();
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'create-backup', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('list-backups', async () => {
    try {
      return { success: true, data: listBackups().map(({ date, size, modifiedAt }) => ({ date, size, modifiedAt })) };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'list-backups', error: e.message });
      return { success: false, error: e.message, data: [] };
    }
  });

  // Restores the database from a dated backup, then restarts the app so every
  // screen and in-memory cart is reloaded from the restored data. The
  // replaced database is kept next to the live one (see backup.service).
  ipcMain.handle('restore-backup', async (_e, date) => {
    try {
      const result = restoreBackup(date);
      if (!result.success) return result;
      for (const k of Object.keys(activeOrders)) delete activeOrders[k];
      loadSessions();
      setTimeout(() => {
        try { closeDB(); } catch (_err) {}
        app.relaunch();
        app.exit(0);
      }, cfg.RESTART_AFTER_RESTORE_MS);
      return { success: true, data: { ...result.data, restarting: true } };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'restore-backup', error: e.message });
      return { success: false, error: e.message };
    }
  });

  // Renderer-side event logging — goes through the main logger so it lands in
  // the rotated app-*.log files, and is size-capped so a runaway error loop
  // in the UI cannot fill the disk.
  ipcMain.handle('log-event', (_e, logData) => {
    try {
      const rawType = typeof logData?.type === 'string' ? logData.type : '';
      const type    = EVENT_TYPE_RE.test(rawType) ? rawType : 'RENDERER_EVENT';
      let detail;
      try { detail = typeof logData === 'string' ? logData : JSON.stringify(logData); } catch (_err) { detail = String(logData); }
      detail = String(detail ?? '');
      if (detail.length > cfg.MAX_RENDERER_LOG_CHARS) {
        detail = `${detail.slice(0, cfg.MAX_RENDERER_LOG_CHARS)}…[truncated ${detail.length - cfg.MAX_RENDERER_LOG_CHARS} chars]`;
      }
      logger.info(type, { source: 'renderer', detail });
      return { success: true };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'log-event', error: e.message });
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
