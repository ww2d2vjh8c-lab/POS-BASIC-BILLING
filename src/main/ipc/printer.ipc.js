'use strict';

/**
 * printer.ipc.js — IPC handlers for receipt printing and printer configuration.
 *
 * Channels: get-printer-config, save-printer-config, list-printers,
 *           get-next-bill-number, print-receipt
 */

const { BrowserWindow } = require('electron');
const queries           = require('../db/queries');
const logger            = require('../logger');
const { validateSettings } = require('../validator');
const { getToday }         = require('../services/file.service');
const { pickPrinter, listPrinters } = require('../services/printer.service');
const cfg = require('../../../config/app.config');

function getWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

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
      if (!config || typeof config !== 'object') return { success: false, error: 'Invalid printer config' };
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

  ipcMain.handle('list-printers', async () => {
    try {
      const printers = await listPrinters(getWindow()?.webContents);
      const settings = queries.readSettings();
      const detected = pickPrinter(printers, settings.printerName);
      return {
        success: true,
        data: {
          printers: printers.map(p => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault })),
          detected,
        },
      };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'list-printers', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('print-receipt', async () => {
    const win = getWindow();
    if (!win) return { success: false, error: 'No window found' };

    // A settings read failure must not stop the receipt: fall back to defaults.
    let settings = {};
    try { settings = queries.readSettings(); } catch (e) {
      logger.error('IPC_ERROR', { channel: 'print-receipt', error: e.message });
    }
    const savedPrinter  = (settings.printerName || '').trim();
    const directPrint   = settings.useThermalPrinting !== false && settings.useThermalPrinting !== 'false';

    // Auto-detect the printer every time so an unplugged/renamed printer never
    // blocks billing. A detected printer is remembered for next time.
    let deviceName = null;
    if (directPrint) {
      const printers = await listPrinters(win.webContents);
      const choice   = pickPrinter(printers, savedPrinter);
      deviceName     = choice.name;
      if (choice.name && choice.reason !== 'saved') {
        try { queries.saveSettings({ printerName: choice.name }); } catch (_e) {}
        logger.info('PRINTER_AUTO_SELECTED', { printer: choice.name, reason: choice.reason, previous: savedPrinter });
      }
    }
    const printSilently = !!deviceName;

    const printOptions = {
      silent:          printSilently,
      printBackground: false,
      color:           false,
      margins:         { marginType: 'none' },
      landscape:       false,
      scaleFactor:     100,
      pageSize:        { width: cfg.PAGE_WIDTH_MICRONS, height: cfg.PAGE_HEIGHT_MICRONS },
    };
    if (printSilently) printOptions.deviceName = deviceName;

    for (let attempt = 1; attempt <= cfg.MAX_PRINT_ATTEMPTS; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          win.webContents.print(printOptions, (success, errorType) => {
            if (success) resolve();
            else reject(new Error(errorType || 'Print failed'));
          });
        });
        logger.info('PRINT_SUCCESS', { attempt, printer: deviceName || 'dialog' });
        return { success: true, printer: deviceName || null };
      } catch (e) {
        if (e.message === 'cancelled') {
          logger.info('PRINT_CANCELLED_BY_USER');
          return { success: false, error: 'cancelled' };
        }
        logger.warn('PRINT_ATTEMPT_FAILED', { attempt, error: e.message });
        if (attempt < cfg.MAX_PRINT_ATTEMPTS) {
          await new Promise(r => setTimeout(r, cfg.PRINT_RETRY_DELAY_MS * attempt));
        } else {
          logger.error('PRINT_FAILED_ALL_ATTEMPTS', { error: e.message });
          return { success: false, error: e.message };
        }
      }
    }
  });
}

module.exports = { register };
