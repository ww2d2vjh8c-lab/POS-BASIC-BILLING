'use strict';

/**
 * inventory.ipc.js — IPC handlers for inventory management.
 *
 * Channels: get-inventory, update-stock, update-lowstock,
 *           add-inventory-item, delete-inventory-item,
 *           get-sales-dates, get-low-stock-items,
 *           get-inventory-sync-status, sync-inventory-to-menu,
 *           bulk-update-stock, get-inventory-audit-log
 */

const queries = require('../db/queries');
const logger  = require('../logger');

function register(ipcMain) {

  // ── Read ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('get-inventory', async () => {
    try {
      return { success: true, data: queries.readInventory() };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-inventory', error: e.message });
      return { success: false, error: e.message, data: { items: [] } };
    }
  });

  ipcMain.handle('get-low-stock-items', async () => {
    try {
      const inventory = queries.readInventory();
      if (!inventory?.items) return { success: true, data: [] };
      return { success: true, data: inventory.items.filter(i => i.stock <= i.lowStock) };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-low-stock-items', error: e.message });
      return { success: false, error: e.message, data: [] };
    }
  });

  ipcMain.handle('get-sales-dates', async () => {
    try {
      return { success: true, data: queries.getSalesDates() };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-sales-dates', error: e.message });
      return { success: false, error: e.message, data: [] };
    }
  });

  // ── Write ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('update-stock', async (_e, name, newStock, source) => {
    try {
      if (!name || typeof name !== 'string') return { success: false, error: 'Invalid item name' };
      if (typeof newStock !== 'number' || newStock < 0) return { success: false, error: 'Invalid stock value' };
      queries.updateStock(name, parseInt(newStock), source || 'manual');
      return { success: true, data: queries.readInventory() };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'update-stock', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('update-lowstock', async (_e, name, newLowStock) => {
    try {
      if (!name || typeof name !== 'string') return { success: false, error: 'Invalid item name' };
      if (typeof newLowStock !== 'number' || newLowStock < 0) return { success: false, error: 'Invalid low stock value' };
      queries.updateLowstock(name, parseInt(newLowStock));
      return { success: true, data: queries.readInventory() };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'update-lowstock', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('add-inventory-item', async (_e, itemData) => {
    try {
      if (!itemData?.name || typeof itemData.name !== 'string') return { success: false, error: 'Invalid item data' };
      if (typeof itemData.stock    !== 'number' || itemData.stock    < 0) return { success: false, error: 'Invalid stock value' };
      if (typeof itemData.lowStock !== 'number' || itemData.lowStock < 0) return { success: false, error: 'Invalid low stock value' };
      queries.addInventoryItem({
        name:       itemData.name,
        stock:      itemData.stock || 0,
        alertAt:    itemData.lowStock || 5,
        product_id: itemData.productId || null,
        source:     'manual',
      });
      return { success: true, data: queries.readInventory() };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'add-inventory-item', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-inventory-item', async (_e, itemName) => {
    try {
      if (!itemName || typeof itemName !== 'string') return { success: false, error: 'Invalid item name' };
      const inventory = queries.readInventory();
      const exists    = inventory.items.some(i => i.name.trim().toLowerCase() === itemName.trim().toLowerCase());
      if (!exists) return { success: false, error: 'Item not found' };
      queries.deleteInventoryItem(itemName); // now soft-archives
      return { success: true };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'delete-inventory-item', error: e.message });
      return { success: false, error: e.message };
    }
  });

  // ── Sync & Bulk ──────────────────────────────────────────────────────────────

  ipcMain.handle('get-inventory-sync-status', async () => {
    try {
      return { success: true, data: queries.getInventorySyncStatus() };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-inventory-sync-status', error: e.message });
      return { success: false, error: e.message, data: { linked: [], unlinked: [], missing: [] } };
    }
  });

  ipcMain.handle('sync-inventory-to-menu', async () => {
    try {
      const result = queries.syncInventoryToMenu();
      return { success: true, data: result };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'sync-inventory-to-menu', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('bulk-update-stock', async (_e, updates) => {
    try {
      if (!Array.isArray(updates)) return { success: false, error: 'Invalid updates array' };
      const result = queries.bulkUpdateStock(updates);
      return { success: true, data: result };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'bulk-update-stock', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-inventory-audit-log', async () => {
    try {
      return { success: true, data: queries.getInventoryAuditLog(200) };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-inventory-audit-log', error: e.message });
      return { success: false, error: e.message, data: [] };
    }
  });
}

module.exports = { register };
