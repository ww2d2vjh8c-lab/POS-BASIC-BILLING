'use strict';

/**
 * settings.ipc.js — IPC handlers for application settings.
 *
 * Channels: get-settings, save-settings, toggle-inventory
 */

const queries = require('../db/queries');
const logger  = require('../logger');
const { validateSettings } = require('../validator');

const SETTINGS_FALLBACK = { inventoryEnabled: true, numberOfTables: 6 };

function register(ipcMain) {

  ipcMain.handle('get-settings', async () => {
    try {
      return { success: true, data: queries.readSettings() };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-settings', error: e.message });
      return { success: false, error: e.message, data: SETTINGS_FALLBACK };
    }
  });

  ipcMain.handle('save-settings', async (_e, settings) => {
    try {
      const safe = validateSettings(settings);
      queries.saveSettings(safe);
      return { success: true, data: safe };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'save-settings', error: e.message });
      return { success: false, error: e.message, data: SETTINGS_FALLBACK };
    }
  });

  ipcMain.handle('toggle-inventory', async () => {
    try {
      const settings = queries.readSettings();
      settings.inventoryEnabled = !settings.inventoryEnabled;
      queries.saveSettings(settings);
      return { success: true, data: settings };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'toggle-inventory', error: e.message });
      return { success: false, error: e.message, data: SETTINGS_FALLBACK };
    }
  });
}

module.exports = { register };
