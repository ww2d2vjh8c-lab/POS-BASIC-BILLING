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
const { validateBillPayload }   = require('../validator');

function register(ipcMain) {

  // Deprecated — kept to prevent old frontend code from crashing on channel-not-found.
  ipcMain.on('save-bill', () => { /* intentionally empty */ });

  ipcMain.handle('finalize-bill', async (_e, payload = {}) => {
    try {
      validateBillPayload(payload);
      logger.info('BILL_FINALIZE_START', { orderId: payload?.orderId });
      const { orderId, paymentMode, cashReceived } = payload;

      if (finalizingOrders.has(orderId)) {
        return { success: false, error: 'Bill is already being processed, please wait' };
      }
      finalizingOrders.add(orderId);

      try {
        const session = activeOrders[orderId];
        if (!session)                               return { success: false, error: 'Order not found' };
        if (!session.items || session.items.length === 0) return { success: false, error: 'Cannot finalize empty order' };

        const today    = getToday();
        const settings = queries.readSettings();
        const sessionTotal   = session.total || 0;
        const discountAmount = (typeof payload.discountAmount === 'number' && payload.discountAmount >= 0)
          ? Math.min(payload.discountAmount, sessionTotal)
          : 0;
        const finalBill = {
          orderId,
          items:          session.items,
          total:          Math.max(0, sessionTotal - discountAmount),
          discountAmount,
          paymentMode:    paymentMode || 'Cash',
          billDate:       today,
          time:           new Date().toISOString(),
          cashReceived:   ((paymentMode || 'Cash') === 'Cash' && typeof cashReceived === 'number')
                            ? cashReceived
                            : null,
        };

        const shouldDeduct = settings.inventoryEnabled && Array.isArray(session.items) && session.items.length > 0;
        const savedBillNo  = queries.finalizeOrder(finalBill, session.items, shouldDeduct);
        finalBill.billNo   = savedBillNo;

        queries.writeAuditLog('BILL_CREATED', 'bill', savedBillNo, null, {
          total: finalBill.total, paymentMode: finalBill.paymentMode, items: finalBill.items?.length,
        });
        queries.removeSession(orderId);
        delete activeOrders[orderId];

        logger.info('BILL_FINALIZE_SUCCESS', { billNo: savedBillNo, total: finalBill.total });
        logEvent({ type: 'BILL_FINALIZED', billNo: savedBillNo, total: finalBill.total });
        return { success: true, data: finalBill };
      } finally {
        finalizingOrders.delete(orderId);
      }
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'finalize-bill', error: e.message });
      if (payload?.orderId) finalizingOrders.delete(payload.orderId);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-bill', async (_e, billNo) => {
    try {
      logger.info('BILL_DELETE', { billNo });
      const deletedBill = queries.deleteBill(billNo);
      if (!deletedBill) return { success: false, error: 'Bill not found' };

      queries.writeAuditLog('BILL_DELETED', 'bill', billNo, deletedBill, null);

      const settings = queries.readSettings();
      if (settings.inventoryEnabled && Array.isArray(deletedBill.items)) {
        try { queries.restoreInventory(deletedBill.items); } catch (_e) {}
      }

      logEvent({ type: 'BILL_DELETED', billNo });
      return { success: true };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'delete-bill', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('mark-bill-printed', async (_e, billNo) => {
    try {
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
