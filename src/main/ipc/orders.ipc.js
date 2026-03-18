'use strict';

/**
 * orders.ipc.js — IPC handlers for table session / cart management.
 *
 * Channels: get-active-orders, add-to-order, clear-cart,
 *           increase-cart-item-quantity, decrease-cart-item-quantity,
 *           remove-cart-item
 */

const queries = require('../db/queries');
const logger  = require('../logger');
const { activeOrders }          = require('../services/session.service');
const { normalizeInventoryName } = require('../services/file.service');

function register(ipcMain) {

  ipcMain.handle('get-active-orders', () => {
    try {
      const legacy = {};
      for (const orderId in activeOrders) {
        legacy[orderId] = activeOrders[orderId]?.items ?? [];
      }
      return { success: true, data: legacy };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-active-orders', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('add-to-order', (_e, orderId, item) => {
    try {
      if (!orderId || typeof orderId !== 'string') return { success: false, error: 'Order ID is required' };
      if (!item || !item.name || typeof item.price !== 'number') return { success: false, error: 'Invalid item data' };

      const settings = queries.readSettings();
      if (settings.inventoryEnabled) {
        const stock = queries.getInventoryStockByName(normalizeInventoryName(item.name));
        if (stock !== null && stock <= 0) return { success: false, error: 'OUT_OF_STOCK' };
      }

      if (!activeOrders[orderId] || activeOrders[orderId].status === 'CLOSED') {
        activeOrders[orderId] = {
          sessionId: `${orderId.replace(/\s/g, '-')}-${Date.now()}`,
          tableId:   orderId,
          status:    'OPEN',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          items:     [],
          total:     0,
        };
        logger.info('SESSION_CREATED', { orderId });
      }

      const session      = activeOrders[orderId];
      session.updatedAt  = new Date().toISOString();

      const existing = session.items.find(i =>
        i.name === item.name &&
        JSON.stringify(i.addons || []) === JSON.stringify(item.addons || [])
      );
      if (existing) {
        existing.quantity++;
      } else {
        session.items.push({ ...item, quantity: 1 });
      }

      session.total = queries.calculateCartTotal(session.items);
      queries.saveSession(orderId, activeOrders[orderId]);
      return { success: true, data: session };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'add-to-order', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('clear-cart', (_e, orderId) => {
    try {
      const session = activeOrders[orderId];
      if (!session?.items) return { success: false, error: 'Session not found' };
      delete activeOrders[orderId];
      queries.removeSession(orderId);
      return { success: true, data: { message: 'Cart cleared' } };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'clear-cart', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('increase-cart-item-quantity', (_e, orderId, itemIndex) => {
    try {
      const session = activeOrders[orderId];
      if (!session?.items?.[itemIndex]) return { success: false, error: 'Invalid session or item index' };
      session.items[itemIndex].quantity++;
      session.updatedAt = new Date().toISOString();
      session.total     = queries.calculateCartTotal(session.items);
      queries.saveSession(orderId, activeOrders[orderId]);
      return { success: true, data: { message: 'Quantity increased' } };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'increase-cart-item-quantity', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('decrease-cart-item-quantity', (_e, orderId, itemIndex) => {
    try {
      const session = activeOrders[orderId];
      if (!session?.items?.[itemIndex]) return { success: false, error: 'Invalid session or item index' };

      if (session.items[itemIndex].quantity > 1) {
        session.items[itemIndex].quantity--;
      } else {
        session.items.splice(itemIndex, 1);
      }

      if (session.items.length === 0) {
        delete activeOrders[orderId];
        queries.removeSession(orderId);
        return { success: true, data: { message: 'Item removed, cart empty' } };
      }

      session.updatedAt = new Date().toISOString();
      session.total     = queries.calculateCartTotal(session.items);
      queries.saveSession(orderId, activeOrders[orderId]);
      return { success: true, data: { message: 'Quantity decreased' } };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'decrease-cart-item-quantity', error: e.message });
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('remove-cart-item', (_e, orderId, itemIndex) => {
    try {
      const session = activeOrders[orderId];
      if (!session?.items?.[itemIndex]) return { success: false, error: 'Invalid session or item index' };

      session.items.splice(itemIndex, 1);

      if (session.items.length === 0) {
        delete activeOrders[orderId];
        queries.removeSession(orderId);
        return { success: true, data: { message: 'Item removed, cart empty' } };
      }

      session.updatedAt = new Date().toISOString();
      session.total     = queries.calculateCartTotal(session.items);
      queries.saveSession(orderId, activeOrders[orderId]);
      logger.info('CART_ITEM_REMOVED', { orderId, itemIndex });
      return { success: true, data: { message: 'Item removed' } };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'remove-cart-item', error: e.message });
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
