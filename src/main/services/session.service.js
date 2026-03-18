'use strict';

/**
 * session.service.js
 *
 * In-memory active-order state for all open table sessions.
 * Extracted from main.js so orders.ipc.js and billing.ipc.js can
 * share the same state object without coupling to the main entry point.
 */

const logger = require('../logger');
const queries = require('../db/queries');

/**
 * Live in-memory map: orderId → session object.
 * Shape: { sessionId, tableId, status, createdAt, updatedAt, items[], total }
 */
const activeOrders = {};

/**
 * Set of orderIds whose finalize-bill call is currently in-flight.
 * Prevents double-click / double-tap from creating duplicate bills.
 */
const finalizingOrders = new Set();

/**
 * Restore previously open sessions from the SQLite sessions table on startup.
 * Called once in app.whenReady().
 */
function loadSessions() {
  try {
    const sessionsData = queries.readSessions();
    for (const sessionId in sessionsData.sessions) {
      const items = Array.isArray(sessionsData.sessions[sessionId])
        ? sessionsData.sessions[sessionId]
        : [];
      const total = queries.calculateCartTotal(items);
      activeOrders[sessionId] = {
        sessionId:  `${sessionId.replace(/\s/g, '-')}-restored`,
        tableId:    sessionId,
        status:     'OPEN',
        createdAt:  new Date().toISOString(),
        updatedAt:  new Date().toISOString(),
        items,
        total,
      };
    }
    logger.info('SESSIONS_LOADED', { count: Object.keys(activeOrders).length });
  } catch (e) {
    logger.error('SESSIONS_LOAD_FAILED', { error: e.message });
  }
}

module.exports = { activeOrders, finalizingOrders, loadSessions };
