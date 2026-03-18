'use strict';

/**
 * dashboard.ipc.js — IPC handlers for sales data and analytics.
 *
 * Channels: get-sales-data, get-dashboard-analytics, get-weekly-revenue,
 *           get-inventory-health
 *
 * Note: The old 'get-sales-by-date' channel was a duplicate of 'get-sales-data'.
 * It has been removed. All callers should use 'get-sales-data'.
 */

const queries = require('../db/queries');
const logger  = require('../logger');
const { normalizeMenuForRenderer } = require('../services/file.service');
const { computeAnalytics }         = require('../services/analytics.service');

const EMPTY_SALES = { totalRevenue: 0, totalBills: 0, bills: [] };
const EMPTY_ANALYTICS = {
  topSellingProducts:      [],
  salesByCategory:         [],
  paymentModeDistribution: {},
  orderTypeDistribution:   { 'Dine-In': 0, 'Delivery': 0, 'Direct Bill': 0 },
  salesByHour:             Array(24).fill(0),
};

function register(ipcMain) {

  ipcMain.handle('get-sales-data', async (_e, date) => {
    try {
      if (!date || typeof date !== 'string')
        return { success: false, error: 'Invalid date', data: EMPTY_SALES };
      const raw = queries.readSalesData(date);
      return {
        success: true,
        data: {
          totalRevenue: Number(raw.totalRevenue) || 0,
          totalBills:   Number(raw.totalBills)   || 0,
          bills:        Array.isArray(raw.bills) ? raw.bills : [],
        },
      };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-sales-data', error: e.message });
      return { success: false, error: e.message, data: EMPTY_SALES };
    }
  });

  ipcMain.handle('get-dashboard-analytics', async (_e, date) => {
    try {
      if (!date || typeof date !== 'string')
        return { success: false, error: 'Invalid date', data: EMPTY_ANALYTICS };

      const salesData = queries.readSalesData(date);
      const menu      = normalizeMenuForRenderer(queries.readMenu());
      const analytics = computeAnalytics(salesData?.bills ?? [], menu);
      return { success: true, data: analytics };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-dashboard-analytics', error: e.message });
      return { success: false, error: e.message, data: EMPTY_ANALYTICS };
    }
  });

  ipcMain.handle('get-weekly-revenue', async () => {
    try {
      return { success: true, data: queries.getWeeklyRevenue() };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-weekly-revenue', error: e.message });
      return { success: false, error: e.message, data: [] };
    }
  });

  ipcMain.handle('get-inventory-health', async () => {
    try {
      const inventory = queries.readInventory();
      const items = inventory?.items || [];

      const lowStock   = items.filter(i => i.stock > 0 && i.stock <= i.lowStock);
      const outOfStock = items.filter(i => i.stock <= 0);

      return {
        success: true,
        data: {
          lowStock,
          outOfStock,
          totalTracked: items.length,
        },
      };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-inventory-health', error: e.message });
      return { success: false, error: e.message, data: { lowStock: [], outOfStock: [], totalTracked: 0 } };
    }
  });
}

module.exports = { register };
