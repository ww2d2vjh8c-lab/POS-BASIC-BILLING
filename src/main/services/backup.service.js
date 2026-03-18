'use strict';

/**
 * backup.service.js
 *
 * Backup creation, verification, rotation, and scheduling helpers.
 * All backup concerns that were buried in main.js are isolated here.
 */

const fs   = require('fs');
const path = require('path');
const logger             = require('../logger');
const { logEvent }       = require('../logger');
const { getUserDataPath, getBackupPath, getToday, getMenuFile, getInventoryFile } = require('./file.service');
const cfg = require('../../../config/app.config');

// ── Directory bootstrap ───────────────────────────────────────────────────────
function ensureBackupDirectory() {
  const dir = getBackupPath();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Create backup ─────────────────────────────────────────────────────────────
/**
 * Copies menu.json, inventory.json, and bloom-cafe.db into a dated sub-folder
 * under userData/backups/. Verifies the SQLite backup with PRAGMA integrity_check.
 * Returns { success: true, filesBackedUp } or { success: false, error }.
 */
function createBackup() {
  try {
    const backupDir = getBackupPath();
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const today       = getToday();
    const backupSubDir = path.join(backupDir, today);
    if (!fs.existsSync(backupSubDir)) fs.mkdirSync(backupSubDir, { recursive: true });

    const filesToBackup = [
      { src: getMenuFile(),                                          dest: path.join(backupSubDir, 'menu.json')      },
      { src: getInventoryFile(),                                     dest: path.join(backupSubDir, 'inventory.json') },
      { src: path.join(getUserDataPath(), 'bloom-cafe.db'),          dest: path.join(backupSubDir, 'bloom-cafe.db')  },
    ];

    let filesBackedUp = 0;
    for (const { src, dest } of filesToBackup) {
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, dest);
      filesBackedUp++;

      // Verify SQLite backup integrity
      if (src.endsWith('.db')) {
        try {
          const Database = require('better-sqlite3');
          const backupDb  = new Database(dest, { readonly: true });
          const check     = backupDb.prepare('PRAGMA integrity_check').get();
          backupDb.close();
          if (check.integrity_check !== 'ok') {
            logger.error('BACKUP_CORRUPTED', { path: dest });
            fs.unlinkSync(dest);
          } else {
            logger.info('BACKUP_VERIFIED', { path: dest, size: fs.statSync(dest).size });
          }
        } catch (e) {
          logger.warn('BACKUP_VERIFY_SKIP', { error: e.message });
        }
      }
    }

    logger.info('BACKUP_CREATED', { date: today, files: filesBackedUp });
    logEvent({ type: 'BACKUP_CREATED', date: today, files: filesBackedUp });
    return { success: true, filesBackedUp };

  } catch (error) {
    logger.error('BACKUP_FAILED', { error: error.message, stack: error.stack });
    logEvent({ type: 'BACKUP_FAILED', error: error.message });
    return { success: false, error: `Backup creation failed: ${error.message}. Check disk space and permissions.` };
  }
}

// ── Clean old backups ─────────────────────────────────────────────────────────
/**
 * Deletes backup sub-folders older than BACKUP_RETENTION_DAYS.
 */
function cleanOldBackups() {
  try {
    const backupDir = getBackupPath();
    if (!fs.existsSync(backupDir)) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cfg.BACKUP_RETENTION_DAYS);

    for (const entry of fs.readdirSync(backupDir)) {
      const entryPath = path.join(backupDir, entry);
      const stat      = fs.statSync(entryPath);
      if (stat.isDirectory() && stat.mtime < cutoff) {
        fs.rmSync(entryPath, { recursive: true, force: true });
        logEvent({ type: 'BACKUP_CLEANUP', deleted: entry });
      }
    }
  } catch (e) {
    logger.error('BACKUP_CLEANUP_FAILED', { error: e.message });
  }
}

module.exports = { ensureBackupDirectory, createBackup, cleanOldBackups };
