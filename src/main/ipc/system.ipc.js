'use strict';

/**
 * system.ipc.js — IPC handlers for system-level operations.
 *
 * Channels: get-app-version, log-event, create-backup,
 *           get-health-status, get-audit-log
 */

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
const queries         = require('../db/queries');
const logger          = require('../logger');
const { logEvent }    = require('../logger');
const { createBackup } = require('../services/backup.service');
const { runHealthChecks } = require('../services/health.service');
const { getToday }    = require('../services/file.service');

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

  // Renderer-side event logging — writes to the day's log file.
  ipcMain.handle('log-event', (_e, logData) => {
    try {
      const timestamp = new Date().toISOString();
      const type      = logData?.type    || 'INFO';
      const message   = logData?.message || String(logData) || '';

      const logFile = path.join(app.getPath('userData'), 'logs', `${getToday()}.log`);
      const logDir  = path.dirname(logFile);
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(logFile, JSON.stringify({ timestamp, type, message, data: logData }) + '\n');
      return { success: true };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'log-event', error: e.message });
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
