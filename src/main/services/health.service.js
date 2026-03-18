'use strict';

/**
 * health.service.js
 *
 * Application health checks: database integrity and disk space.
 * Extracted from main.js so it can be called both at startup and
 * via the get-health-status IPC handler without circular dependencies.
 */

const fs     = require('fs');
const logger = require('../logger');
const { getUserDataPath } = require('./file.service');
const cfg = require('../../../config/app.config');

async function runHealthChecks() {
  const results = { database: false, diskSpace: true, status: 'ok' };

  // ── Database integrity ────────────────────────────────────────────────────
  try {
    const { getDB } = require('../db/database');
    const db    = getDB();
    const check = db.prepare('PRAGMA integrity_check').get();
    results.database = check.integrity_check === 'ok';
    if (!results.database) {
      logger.error('HEALTH_CHECK_DB_INTEGRITY_FAIL', { result: check.integrity_check });
    }
  } catch (e) {
    results.database = false;
    logger.error('HEALTH_CHECK_DB_FAILED', { error: e.message });
  }

  // ── Disk space ───────────────────────────────────────────────────────────
  try {
    const stats  = fs.statfsSync(getUserDataPath());
    const freeMB = (stats.bfree * stats.bsize) / (1024 * 1024);
    results.diskSpace = freeMB > cfg.MIN_FREE_DISK_MB;
    results.freeMB    = Math.round(freeMB);
    if (!results.diskSpace) {
      logger.warn('HEALTH_CHECK_LOW_DISK', { freeMB: Math.round(freeMB) });
    }
  } catch (e) {
    logger.warn('HEALTH_CHECK_DISK_SKIP', { error: e.message });
  }

  results.status = results.database ? 'ok' : 'degraded';
  logger.info('HEALTH_CHECK_COMPLETE', results);
  return results;
}

module.exports = { runHealthChecks };
