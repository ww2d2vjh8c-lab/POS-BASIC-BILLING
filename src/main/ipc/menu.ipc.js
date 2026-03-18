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

function register(ipcMain) {

  ipcMain.handle('get-menu', async () => {
    try {
      if (!menuCache) menuCache = normalizeMenuForRenderer(queries.readMenu());
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
      menuCache = null;
      return { success: true, data: normalizeMenuForRenderer(queries.readMenu()) };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'add-category', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-category', async (_e, categoryName) => {
    try {
      if (!categoryName || typeof categoryName !== 'string')
        return { success: false, error: 'Invalid category name' };
      queries.deleteCategory(categoryName);
      menuCache = null;
      return { success: true, data: normalizeMenuForRenderer(queries.readMenu()) };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'delete-category', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('rename-category', async (_e, oldName, newName) => {
    try {
      if (!oldName || !newName || !newName.trim())
        return { success: false, error: 'Invalid names' };
      queries.renameCategory(oldName.trim(), newName.trim());
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

      const price = parseFloat(addon.price);
      if (Number.isNaN(price) || price < 0) return { success: false, error: 'Price cannot be negative' };

      const existing = normalizeMenuForRenderer(queries.readMenu());
      const category = existing.categories.find(c => c.name === categoryName);
      const product  = category?.products?.find(p => p.name === productName);
      if (!product) return { success: false, error: 'Product not found' };

      if ((product.addons || []).some(a => a.name.toLowerCase() === addonName.toLowerCase()))
        return { success: false, error: 'Addon already exists' };

      queries.addAddon(categoryName, productName, { name: addonName, price });
      menuCache = null;
      return { success: true, data: normalizeMenuForRenderer(queries.readMenu()) };
    } catch (e) {
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
      menuCache = null;
      return { success: true, data: normalizeMenuForRenderer(queries.readMenu()) };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'remove-addon', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('add-product', async (_e, categoryName, newProduct) => {
    try {
      validateString(categoryName, 'Category name');
      const name  = validateString(newProduct?.name,  'Product name');
      const price = validatePrice(newProduct?.price,  'price');
      const product = { ...newProduct, name, price };
      if (product.hasVariants) product.halfPrice = validatePrice(newProduct.halfPrice, 'halfPrice');
      queries.addProduct(categoryName, product);
      menuCache = null;

      // Auto-create inventory row for the new product (stock=0, alert=5).
      // Resolve product_id from the DB so the row is properly linked.
      try {
        const menu = queries.readMenu();
        const cat  = menu.categories.find(c => c.name === categoryName);
        const prod = cat?.products?.find(p => p.name === name);
        // Use getProductId to resolve the numeric id
        const productId = (() => {
          try { return queries.getProductId(categoryName, name); } catch (_e) { return null; }
        })();
        queries.addInventoryItem({ name, stock: 0, alertAt: 5, product_id: productId, source: 'auto' });
      } catch (invErr) {
        logger.warn('INVENTORY_AUTO_CREATE_FAILED', { product: name, error: invErr.message });
        // Don't fail the product add
      }

      return { success: true, data: normalizeMenuForRenderer(queries.readMenu()) };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'add-product', error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('toggle-product-availability', async (_e, categoryName, productName) => {
    try {
      queries.toggleProductAvailability(categoryName, productName);
      menuCache = null;
      const menu     = normalizeMenuForRenderer(queries.readMenu());
      const category = menu.categories.find(c => c.name === categoryName);
      const product  = category?.products?.find(p => p.name === productName);
      return { success: true, data: { unavailable: !!product?.unavailable } };
    } catch (e) {
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

      return { success: true, data: normalizeMenuForRenderer(queries.readMenu()) };
    } catch (e) {
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
      return { success: true, data: normalizeMenuForRenderer(queries.readMenu()) };
    } catch (e) {
      logger.error('IPC_ERROR', { channel: 'edit-product-price', error: e.message });
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
