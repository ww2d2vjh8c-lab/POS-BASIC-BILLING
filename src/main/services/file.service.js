'use strict';

/**
 * file.service.js
 *
 * All file-system helpers that main.js used to own inline:
 *   - Path resolution (dev vs. production userData)
 *   - Atomic JSON read / write with backup-based recovery
 *   - Menu / inventory data normalisation for the renderer
 *   - First-run seed file bootstrapping
 */

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('../logger');
const { logEvent } = require('../logger');

// ── isDev ─────────────────────────────────────────────────────────────────────
// Evaluate lazily so app.isPackaged is available at call time.
let _isDev = null;
function isDev() {
  if (_isDev === null) {
    _isDev = process.env.NODE_ENV === 'development' || !(app?.isPackaged);
  }
  return _isDev;
}

// ── Path helpers ──────────────────────────────────────────────────────────────
let _userDataPath = null;
function getUserDataPath() {
  if (!_userDataPath) _userDataPath = app.getPath('userData');
  return _userDataPath;
}

function getBackupPath() {
  return path.join(getUserDataPath(), 'backups');
}

function getToday() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day   = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMenuFile() {
  if (isDev()) return path.join(__dirname, '..', '..', '..', 'data', 'menu.json');
  return path.join(getUserDataPath(), 'menu.json');
}

function getInventoryFile() {
  if (isDev()) return path.join(__dirname, '..', '..', '..', 'data', 'inventory.json');
  return path.join(getUserDataPath(), 'inventory.json');
}

// ── Backup path finder ────────────────────────────────────────────────────────
function findLatestBackup(originalFilePath) {
  try {
    const fileName  = path.basename(originalFilePath);
    const backupDir = getBackupPath();
    if (!fs.existsSync(backupDir)) return null;

    const backupDates = fs.readdirSync(backupDir)
      .filter(d => {
        const full = path.join(backupDir, d);
        return fs.existsSync(full) && fs.statSync(full).isDirectory();
      })
      .sort()
      .reverse();

    for (const date of backupDates) {
      const candidate = path.join(backupDir, date, fileName);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

// ── JSON I/O ──────────────────────────────────────────────────────────────────
function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    logger.error('DATA_CORRUPTION_DETECTED', { file: filePath, error: error.message });
    logEvent({ type: 'DATA_CORRUPTION_DETECTED', file: filePath, error: error.message });

    // Auto-restore from latest backup
    const backupFile = findLatestBackup(filePath);
    if (backupFile) {
      try {
        const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
        writeJSONAtomic(filePath, backupData);
        logEvent({ type: 'DATA_RESTORED_FROM_BACKUP', file: filePath, restoredFrom: backupFile });
        logger.info('DATA_RESTORED_FROM_BACKUP', { file: filePath, from: backupFile });
        return backupData;
      } catch (backupError) {
        logger.error('DATA_RESTORE_FAILED', { error: backupError.message });
      }
    }
    return null;
  }
}

function writeJSONAtomic(filePath, data) {
  const tempFile = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, filePath);
  } catch (error) {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_e) {}
    throw error;
  }
}

// ── Data normalisation ────────────────────────────────────────────────────────
/**
 * Strips variant suffixes like "(Half)" or "(Full)" from an inventory item name
 * so it can be matched against the raw inventory table.
 */
function normalizeInventoryName(itemName) {
  return String(itemName || '')
    .replace(/\s*\((Half|Full)\)\s*$/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Shapes the raw SQLite menu result into the format the renderer expects.
 * Adds the `unavailable` boolean and ensures arrays are present everywhere.
 */
function normalizeMenuForRenderer(menu = { categories: [], addons: [] }) {
  return {
    categories: Array.isArray(menu.categories)
      ? menu.categories.map(category => ({
          name: category.name,
          products: Array.isArray(category.products)
            ? category.products.map(product => ({
                ...product,
                unavailable: product.available === false,
                addons: Array.isArray(product.addons) ? product.addons : [],
              }))
            : [],
        }))
      : [],
    addons: Array.isArray(menu.addons) ? menu.addons : [],
  };
}

// ── First-run bootstrap ───────────────────────────────────────────────────────
/**
 * On first launch copies seed JSON files from the bundled data/ folder into
 * the user's persistent userData directory. Falls back to empty structures
 * if seed files are missing so startup is always resilient.
 */
function ensureDataFilesExist() {
  const userDataPath       = getUserDataPath();
  const userMenuPath       = path.join(userDataPath, 'menu.json');
  const userInventoryPath  = path.join(userDataPath, 'inventory.json');

  const sourceDataPath     = isDev()
    ? path.join(__dirname, '..', '..', '..', 'data')
    : path.join(process.resourcesPath, 'data');

  try {
    if (fs.existsSync(path.join(sourceDataPath, 'menu.json'))      && !fs.existsSync(userMenuPath))      fs.copyFileSync(path.join(sourceDataPath, 'menu.json'),      userMenuPath);
    if (fs.existsSync(path.join(sourceDataPath, 'inventory.json')) && !fs.existsSync(userInventoryPath)) fs.copyFileSync(path.join(sourceDataPath, 'inventory.json'), userInventoryPath);
  } catch (_e) {}

  // Guaranteed fallbacks even if copy fails
  try {
    if (!fs.existsSync(userMenuPath))      fs.writeFileSync(userMenuPath,      JSON.stringify({ categories: [], addons: [] }, null, 2));
    if (!fs.existsSync(userInventoryPath)) fs.writeFileSync(userInventoryPath, JSON.stringify({ items: [] },                null, 2));
  } catch (_e) {}
}

module.exports = {
  isDev,
  getUserDataPath,
  getBackupPath,
  getToday,
  getMenuFile,
  getInventoryFile,
  findLatestBackup,
  readJSON,
  writeJSONAtomic,
  normalizeInventoryName,
  normalizeMenuForRenderer,
  ensureDataFilesExist,
};
