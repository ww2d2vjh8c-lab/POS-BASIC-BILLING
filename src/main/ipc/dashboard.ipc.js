'use strict';

/**
 * dashboard.ipc.js — IPC handlers for sales data and analytics.
 *
 * Channels: get-sales-data, get-dashboard-analytics, get-weekly-revenue,
 *           get-inventory-health
 *
 * Note: 'get-sales-by-date' is an alias of 'get-sales-data', kept because the
 * preload still exposes getSalesByDate(); without a handler it would reject.
 */

const queries = require('../db/queries');
const logger  = require('../logger');
const { normalizeMenuForRenderer } = require('../services/file.service');
const { computeAnalytics }         = require('../services/analytics.service');
const { validateDate }             = require('../validator');

const EMPTY_SALES = { totalRevenue: 0, totalDiscount: 0, grossRevenue: 0, totalBills: 0, bills: [] };
const EMPTY_ANALYTICS = {
  topSellingProducts:      [],
  salesByCategory:         [],
  paymentModeDistribution: {},
  orderTypeDistribution:   { 'Dine-In': 0, 'Delivery': 0, 'Direct Bill': 0 },
  salesByHour:             Array(24).fill(0),
  totalDiscount:           0,
  grossRevenue:            0,
};

function isValidDate(date) {
  try { validateDate(date); return true; } catch (_e) { return false; }
}

function register(ipcMain) {

  const getSalesData = async (_e, date) => {
    try {
      if (!isValidDate(date))
        return { success: false, error: 'Invalid date', data: EMPTY_SALES };
      const raw = queries.readSalesData(date);
      return {
        success: true,
        data: {
          totalRevenue:  Number(raw.totalRevenue)  || 0,
          totalDiscount: Number(raw.totalDiscount) || 0,
          grossRevenue:  Number(raw.grossRevenue)  || 0,
          totalBills:    Number(raw.totalBills)    || 0,
          bills:         Array.isArray(raw.bills) ? raw.bills : [],
        },
      };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-sales-data', error: e.message });
      return { success: false, error: e.message, data: EMPTY_SALES };
    }
  };
  ipcMain.handle('get-sales-data', getSalesData);
  ipcMain.handle('get-sales-by-date', getSalesData);

  ipcMain.handle('get-dashboard-analytics', async (_e, date) => {
    try {
      if (!isValidDate(date))
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
