'use strict';

/**
 * billing.ipc.js — IPC handlers for bill finalization and management.
 *
 * Channels: finalize-bill, delete-bill, mark-bill-printed, save-bill (deprecated)
 */

const queries = require('../db/queries');
const logger  = require('../logger');
const { logEvent }              = require('../logger');
const { activeOrders, finalizingOrders } = require('../services/session.service');
const { getToday }              = require('../services/file.service');
const {
  MAX_CASH, roundMoney, validateBillPayload, validateMoney, validateString,
} = require('../validator');

const toPaise = (rupees) => Math.round(rupees * 100);

/** Discount in rupees, clamped to [0, subtotal]. Anything unusable means no discount. */
function sanitizeDiscount(value, subtotal) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(roundMoney(value), subtotal);
}

function register(ipcMain) {

  // Deprecated — kept to prevent old frontend code from crashing on channel-not-found.
  ipcMain.on('save-bill', () => { /* intentionally empty */ });

  ipcMain.handle('finalize-bill', async (_e, payload = {}) => {
    try {
      validateBillPayload(payload);
      logger.info('BILL_FINALIZE_START', { orderId: payload?.orderId });
      const { orderId, paymentMode } = payload;

      if (finalizingOrders.has(orderId)) {
        return { success: false, error: 'Bill is already being processed, please wait' };
      }
      finalizingOrders.add(orderId);

      try {
        const session = Object.hasOwn(activeOrders, orderId) ? activeOrders[orderId] : null;
        if (!session)                               return { success: false, error: 'Order not found' };
        if (!session.items || session.items.length === 0) return { success: false, error: 'Cannot finalize empty order' };

        // Recompute from the items instead of trusting a cached total.
        const subtotal       = queries.calculateCartTotal(session.items);
        const discountAmount = sanitizeDiscount(payload.discountAmount, subtotal);
        const total          = roundMoney(Math.max(0, subtotal - discountAmount));

        let cashReceived = null;
        if (paymentMode === 'Cash' && payload.cashReceived !== null && payload.cashReceived !== undefined) {
          cashReceived = validateMoney(payload.cashReceived, 'Cash received', MAX_CASH);
          if (toPaise(cashReceived) < toPaise(total)) {
            return {
              success: false,
              error: `Cash received ₹${cashReceived.toFixed(2)} is less than the total ₹${total.toFixed(2)}`,
            };
          }
        }

        const settings  = queries.readSettings();
        const finalBill = {
          orderId,
          items:          session.items,
          subtotal,
          total,
          discountAmount,
          paymentMode,
          billDate:       getToday(),
          time:           new Date().toISOString(),
          cashReceived,
        };

        // Saves the bill, deducts stock and closes the saved cart atomically.
        const savedBillNo  = queries.finalizeOrder(finalBill, session.items, !!settings.inventoryEnabled);
        finalBill.billNo   = savedBillNo;
        delete activeOrders[orderId];

        queries.writeAuditLog('BILL_CREATED', 'bill', savedBillNo, null, {
          total: finalBill.total, discountAmount, paymentMode: finalBill.paymentMode, items: finalBill.items?.length,
        });

        if (finalBill.stockWarnings) logger.warn('STOCK_OVERSOLD', { billNo: savedBillNo, items: finalBill.stockWarnings });
        logger.info('BILL_FINALIZE_SUCCESS', { billNo: savedBillNo, total: finalBill.total });
        logEvent({ type: 'BILL_FINALIZED', billNo: savedBillNo, total: finalBill.total });
        return { success: true, data: finalBill };
      } finally {
        finalizingOrders.delete(orderId);
      }
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'finalize-bill', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-bill', async (_e, billNo) => {
    try {
      validateString(billNo, 'Bill number');
      logger.info('BILL_DELETE', { billNo });
      const settings    = queries.readSettings();
      const deletedBill = queries.deleteBill(billNo, !!settings.inventoryEnabled);
      if (!deletedBill) return { success: false, error: 'Bill not found' };

      queries.writeAuditLog('BILL_DELETED', 'bill', billNo, deletedBill, null);

      logEvent({ type: 'BILL_DELETED', billNo });
      return { success: true };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'delete-bill', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('mark-bill-printed', async (_e, billNo) => {
    try {
      validateString(billNo, 'Bill number');
      queries.markBillPrinted(billNo);
      logger.info('BILL_MARKED_PRINTED', { billNo });
      return { success: true };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'mark-bill-printed', error: e.message });
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
