'use strict';

/**
 * menu.ipc.js — IPC handlers for all menu management operations.
 *
 * Channels: get-menu, add-category, delete-category, rename-category,
 *           add-addon, remove-addon, add-product, toggle-product-availability,
 *           delete-product, edit-product-price
 */

const queries = require('../db/queries');
const logger  = require('../logger');
const { validateString, validatePrice } = require('../validator');
const { normalizeMenuForRenderer }      = require('../services/file.service');

// Menu is cached after the first read and invalidated on every mutation.
// The cache lives here so menu handlers are the single owner of it.
let menuCache = null;

const MAX_PRODUCT_ADDONS = 50;

/** Re-reads the menu after a change; the fresh copy becomes the cache. */
function refreshMenu() {
  menuCache = normalizeMenuForRenderer(queries.readMenu());
  return menuCache;
}

function validateAddonList(addons) {
  if (addons === undefined || addons === null) return [];
  if (!Array.isArray(addons)) throw new Error('Add-ons must be a list');
  if (addons.length > MAX_PRODUCT_ADDONS) throw new Error(`A product can have at most ${MAX_PRODUCT_ADDONS} add-ons`);
  return addons.map(a => ({
    name:  validateString(a?.name, 'Add-on name'),
    price: validatePrice(a?.price, 'Add-on price') ?? 0,
  }));
}

function register(ipcMain) {

  ipcMain.handle('get-menu', async () => {
    try {
      if (!menuCache) refreshMenu();
      return { success: true, data: menuCache };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'get-menu', error: e.message });
      return { success: false, error: e.message, data: { categories: [], addons: [] } };
    }
  });

  ipcMain.handle('add-category', async (_e, categoryName) => {
    try {
      const name = validateString(categoryName, 'Category name');
      queries.addCategory(name);
      return { success: true, data: refreshMenu() };
    } catch (e) {
      menuCache = null;
      logger.error('IPC_ERROR', { channel: 'add-category', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-category', async (_e, categoryName) => {
    try {
      if (!categoryName || typeof categoryName !== 'string')
        return { success: false, error: 'Invalid category name' };
      queries.deleteCategory(categoryName);
      return { success: true, data: refreshMenu() };
    } catch (e) {
      menuCache = null;
      logger.error('IPC_ERROR', { channel: 'delete-category', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('rename-category', async (_e, oldName, newName) => {
    try {
      if (typeof oldName !== 'string' || typeof newName !== 'string' || !oldName.trim() || !newName.trim())
        return { success: false, error: 'Invalid names' };
      const from = validateString(oldName, 'Category name');
      const to   = validateString(newName, 'New category name');
      queries.renameCategory(from, to);
      menuCache = null;
      return { success: true };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'rename-category', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('add-addon', async (_e, categoryName, productName, addon) => {
    try {
      if (!categoryName || typeof categoryName !== 'string') return { success: false, error: 'Invalid category name' };
      if (!productName  || typeof productName  !== 'string') return { success: false, error: 'Invalid product name' };
      if (!addon        || typeof addon        !== 'object') return { success: false, error: 'Invalid addon data' };

      const addonName = String(addon.name || '').trim();
      if (!addonName) return { success: false, error: 'Addon name is required' };
      validateString(addonName, 'Addon name');

      const price = parseFloat(addon.price);
      if (Number.isNaN(price) || price < 0) return { success: false, error: 'Price cannot be negative' };
      validatePrice(price, 'Addon price');

      const existing = normalizeMenuForRenderer(queries.readMenu());
      const category = existing.categories.find(c => c.name === categoryName);
      const product  = category?.products?.find(p => p.name === productName);
      if (!product) return { success: false, error: 'Product not found' };

      if ((product.addons || []).some(a => a.name.toLowerCase() === addonName.toLowerCase()))
        return { success: false, error: 'Addon already exists' };

      queries.addAddon(categoryName, productName, { name: addonName, price });
      return { success: true, data: refreshMenu() };
    } catch (e) {
      menuCache = null;
      logger.error('IPC_ERROR', { channel: 'add-addon', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('remove-addon', async (_e, categoryName, productName, addonName) => {
    try {
      if (!categoryName || typeof categoryName !== 'string') return { success: false, error: 'Invalid category name' };
      if (!productName  || typeof productName  !== 'string') return { success: false, error: 'Invalid product name' };
      if (!addonName    || typeof addonName    !== 'string') return { success: false, error: 'Invalid addon name' };
      queries.removeAddon(categoryName, productName, addonName);
      return { success: true, data: refreshMenu() };
    } catch (e) {
      menuCache = null;
      logger.error('IPC_ERROR', { channel: 'remove-addon', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('add-product', async (_e, categoryName, newProduct) => {
    try {
      validateString(categoryName, 'Category name');
      const name  = validateString(newProduct?.name,  'Product name');
      const price = validatePrice(newProduct?.price,  'price');
      const product = { ...newProduct, name, price, addons: validateAddonList(newProduct?.addons) };
      if (product.hasVariants) product.halfPrice = validatePrice(newProduct.halfPrice, 'halfPrice');
      const productId = queries.addProduct(categoryName, product);
      menuCache = null;

      // Make sure the product is tracked in inventory. An existing row with
      // the same name keeps its stock (it is only linked and un-archived).
      try {
        queries.ensureInventoryItem(name, productId, 'auto');
      } catch (invErr) {
        logger.warn('INVENTORY_AUTO_CREATE_FAILED', { product: name, error: invErr.message });
        // Don't fail the product add
      }

      return { success: true, data: refreshMenu() };
    } catch (e) {
      menuCache = null;
      logger.error('IPC_ERROR', { channel: 'add-product', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('toggle-product-availability', async (_e, categoryName, productName) => {
    try {
      validateString(categoryName, 'Category name');
      validateString(productName,  'Product name');
      queries.toggleProductAvailability(categoryName, productName);
      const menu     = refreshMenu();
      const category = menu.categories.find(c => c.name === categoryName);
      const product  = category?.products?.find(p => p.name === productName);
      return { success: true, data: { unavailable: !!product?.unavailable } };
    } catch (e) {
      menuCache = null;
      logger.error('IPC_ERROR', { channel: 'toggle-product-availability', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-product', async (_e, categoryName, productName) => {
    try {
      if (!categoryName || typeof categoryName !== 'string') return { success: false, error: 'Invalid category name' };
      if (!productName  || typeof productName  !== 'string') return { success: false, error: 'Invalid product name' };
      queries.deleteProduct(categoryName, productName);
      menuCache = null;
      queries.writeAuditLog('PRODUCT_DELETED', 'product', productName, null, null);

      // Soft-archive the matching inventory row to preserve audit history.
      try {
        queries.archiveInventoryItem(productName);
      } catch (invErr) {
        logger.warn('INVENTORY_AUTO_ARCHIVE_FAILED', { product: productName, error: invErr.message });
        // Don't fail the product delete
      }

      return { success: true, data: refreshMenu() };
    } catch (e) {
      menuCache = null;
      logger.error('IPC_ERROR', { channel: 'delete-product', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('edit-product-price', async (_e, categoryName, productName, newPrice, halfPrice = null) => {
    try {
      validateString(categoryName, 'Category name');
      validateString(productName,  'Product name');
      const price = validatePrice(newPrice,   'price');
      const half  = validatePrice(halfPrice,  'halfPrice');

      const menu     = queries.readMenu();
      const category = menu.categories.find(c => c.name === categoryName);
      const product  = category?.products?.find(p => p.name === productName);

      queries.editProductPrice(categoryName, productName, price, half);
      menuCache = null;
      queries.writeAuditLog('PRICE_CHANGED', 'product', productName, { price: product?.price }, { price, halfPrice: half });
      return { success: true, data: refreshMenu() };
    } catch (e) {
      menuCache = null;
      logger.error('IPC_ERROR', { channel: 'edit-product-price', error: e.message });
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
