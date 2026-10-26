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
const { activeOrders }           = require('../services/session.service');
const { normalizeInventoryName } = require('../services/file.service');
const { validateOrderId, validateCartItem } = require('../validator');

const INVALID_ITEM = { success: false, error: 'Invalid session or item index' };

function getSession(orderId) {
  return typeof orderId === 'string' && Object.hasOwn(activeOrders, orderId) ? activeOrders[orderId] : null;
}

function isValidIndex(session, index) {
  return Number.isInteger(index) && index >= 0 && index < session.items.length;
}

/**
 * Saves the new cart to the database first and only then updates memory, so
 * a failed write never leaves the screen showing items that a restart would
 * lose. An empty cart closes the session. Returns the session, or null.
 */
function commitCart(orderId, session, items) {
  if (items.length === 0) {
    queries.removeSession(orderId);
    delete activeOrders[orderId];
    return null;
  }
  queries.saveSession(orderId, items);
  session.items     = items;
  session.total     = queries.calculateCartTotal(items);
  session.updatedAt = new Date().toISOString();
  activeOrders[orderId] = session;
  return session;
}

/** Copies the cart so edits can be thrown away if saving fails. */
function copyItems(session) {
  return session.items.map(i => ({ ...i }));
}

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

  ipcMain.handle('add-to-order', (_e, orderId, rawItem) => {
    try {
      try { validateOrderId(orderId); } catch (err) { return { success: false, error: err.message }; }
      let item;
      try { item = validateCartItem(rawItem); } catch (err) { return { success: false, error: err.message }; }

      const settings = queries.readSettings();
      if (settings.inventoryEnabled) {
        const stock = queries.getInventoryStockByName(normalizeInventoryName(item.name));
        if (stock !== null && stock <= 0) return { success: false, error: 'OUT_OF_STOCK' };
      }

      let session = getSession(orderId);
      const isNew = !session || session.status === 'CLOSED';
      if (isNew) {
        const now = new Date().toISOString();
        session = {
          sessionId: `${orderId.replace(/\s/g, '-')}-${Date.now()}`,
          tableId:   orderId,
          status:    'OPEN',
          createdAt: now,
          updatedAt: now,
          items:     [],
          total:     0,
        };
      }

      const items    = copyItems(session);
      const addonKey = JSON.stringify(item.addons);
      const existing = items.find(i => i.name === item.name && JSON.stringify(i.addons || []) === addonKey);
      if (existing) {
        existing.quantity++;
      } else {
        items.push({ ...item, quantity: 1 });
      }

      commitCart(orderId, session, items);
      if (isNew) logger.info('SESSION_CREATED', { orderId });
      return { success: true, data: session };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'add-to-order', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('clear-cart', (_e, orderId) => {
    try {
      const session = getSession(orderId);
      if (!session?.items) return { success: false, error: 'Session not found' };
      queries.removeSession(orderId);
      delete activeOrders[orderId];
      return { success: true, data: { message: 'Cart cleared' } };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'clear-cart', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('increase-cart-item-quantity', (_e, orderId, itemIndex) => {
    try {
      const session = getSession(orderId);
      if (!session || !isValidIndex(session, itemIndex)) return INVALID_ITEM;
      const items = copyItems(session);
      items[itemIndex].quantity++;
      commitCart(orderId, session, items);
      return { success: true, data: { message: 'Quantity increased' } };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'increase-cart-item-quantity', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('decrease-cart-item-quantity', (_e, orderId, itemIndex) => {
    try {
      const session = getSession(orderId);
      if (!session || !isValidIndex(session, itemIndex)) return INVALID_ITEM;

      const items = copyItems(session);
      if (items[itemIndex].quantity > 1) {
        items[itemIndex].quantity--;
      } else {
        items.splice(itemIndex, 1);
      }

      if (!commitCart(orderId, session, items)) {
        return { success: true, data: { message: 'Item removed, cart empty' } };
      }
      return { success: true, data: { message: 'Quantity decreased' } };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'decrease-cart-item-quantity', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('remove-cart-item', (_e, orderId, itemIndex) => {
    try {
      const session = getSession(orderId);
      if (!session || !isValidIndex(session, itemIndex)) return INVALID_ITEM;

      const items = copyItems(session);
      items.splice(itemIndex, 1);

      if (!commitCart(orderId, session, items)) {
        return { success: true, data: { message: 'Item removed, cart empty' } };
      }
      logger.info('CART_ITEM_REMOVED', { orderId, itemIndex });
      return { success: true, data: { message: 'Item removed' } };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'remove-cart-item', error: e.message });
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
