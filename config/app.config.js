'use strict';

/**
 * Application-level configuration constants.
 *
 * Centralising magic numbers here means changing the backup interval,
 * log level, or print retry count never requires hunting through main.js.
 */
module.exports = {
  // ── Backup ─────────────────────────────────────────────────────────────────
  /** How often to auto-backup (ms). Default: every 30 minutes. */
  BACKUP_INTERVAL_MS:      30 * 60 * 1000,

  /** How often to clean up old orders (ms). Default: every 24 hours. */
  CLEANUP_INTERVAL_MS:     24 * 60 * 60 * 1000,

  /** How many days to keep backup folders. Default: 7 days. */
  BACKUP_RETENTION_DAYS:   7,

  // ── IPC monitoring ─────────────────────────────────────────────────────────
  /** IPC calls slower than this (ms) are logged as SLOW_IPC. */
  SLOW_IPC_THRESHOLD_MS:   500,

  /** How often to emit IPC call-rate summary (ms). Default: 1 minute. */
  MONITOR_INTERVAL_MS:     60 * 1000,

  /** How often to emit memory usage log (ms). Default: 5 minutes. */
  MEMORY_LOG_INTERVAL_MS:  5 * 60 * 1000,

  // ── Printing ───────────────────────────────────────────────────────────────
  /** Maximum number of print attempts before giving up. */
  MAX_PRINT_ATTEMPTS:      3,

  /** 58mm paper width in microns for webContents.print(). */
  PAGE_WIDTH_MICRONS:      58000,

  /**
   * Virtual page height in microns. Thermal printers cut at content end
   * regardless of virtual page height, so over-allocating is harmless.
   * 600mm handles ~200 line items comfortably.
   */
  PAGE_HEIGHT_MICRONS:     600000,

  // ── Logging ────────────────────────────────────────────────────────────────
  /** Minimum disk free space (MB) before a low-disk warning is logged. */
  MIN_FREE_DISK_MB:        200,
};
