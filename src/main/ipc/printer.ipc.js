'use strict';

/**
 * printer.ipc.js — IPC handlers for receipt printing and printer configuration.
 *
 * Channels: get-printer-config, save-printer-config,
 *           get-next-bill-number, print-receipt
 */

const { BrowserWindow } = require('electron');
const queries           = require('../db/queries');
const logger            = require('../logger');
const { validateSettings } = require('../validator');
const { getToday }         = require('../services/file.service');
const cfg = require('../../../config/app.config');

function register(ipcMain) {

  ipcMain.handle('get-printer-config', async () => {
    try {
      const settings = queries.readSettings();
      return {
        success: true,
        data: {
          printerName:       settings.printerName || '',
          useThermalPrinting: settings.useThermalPrinting !== false,
        },
      };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-printer-config', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('save-printer-config', async (_e, config) => {
    try {
      const safe = validateSettings({
        printerName:        config.printerName || '',
        useThermalPrinting: config.useThermalPrinting !== false,
      });
      queries.saveSettings(safe);
      logger.info('PRINTER_CONFIG_UPDATED', { config: safe });
      return { success: true };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'save-printer-config', error: e.message });
      return { success: false, error: e.message };
    }
  });

  // Preview only — reads bill_sequences without incrementing the counter.
  ipcMain.handle('get-next-bill-number', async () => {
    try {
      return { success: true, data: queries.peekNextBillNo(getToday()) };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-next-bill-number', error: e.message });
      return { success: false, error: e.message, data: 'BC-Preview' };
    }
  });

  ipcMain.handle('print-receipt', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return { success: false, error: 'No window found' };

    const settings            = queries.readSettings();
    const configuredPrinter   = (settings.printerName || '').trim();
    const printSilently       = configuredPrinter.length > 0;

    const printOptions = {
      silent:          printSilently,
      printBackground: false,
      color:           false,
      margins:         { marginType: 'none' },
      landscape:       false,
      scaleFactor:     100,
      pageSize:        { width: cfg.PAGE_WIDTH_MICRONS, height: cfg.PAGE_HEIGHT_MICRONS },
    };
    if (printSilently) printOptions.deviceName = configuredPrinter;

    for (let attempt = 1; attempt <= cfg.MAX_PRINT_ATTEMPTS; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          win.webContents.print(printOptions, (success, errorType) => {
            if (success) resolve();
            else reject(new Error(errorType || 'Print failed'));
          });
        });
        logger.info('PRINT_SUCCESS', { attempt, printer: configuredPrinter || 'dialog' });
        return { success: true };
      } catch (e) {
        if (e.message === 'cancelled') {
          logger.info('PRINT_CANCELLED_BY_USER');
          return { success: false, error: 'cancelled' };
        }
        logger.warn('PRINT_ATTEMPT_FAILED', { attempt, error: e.message });
        if (attempt < cfg.MAX_PRINT_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        } else {
          logger.error('PRINT_FAILED_ALL_ATTEMPTS', { error: e.message });
          return { success: false, error: e.message };
        }
      }
    }
  });
}

module.exports = { register };
