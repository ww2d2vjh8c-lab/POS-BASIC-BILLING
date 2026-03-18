const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Menu ──
  getMenu: () => ipcRenderer.invoke("get-menu"),
  addCategory: (name) => ipcRenderer.invoke("add-category", name),
  deleteCategory: (name) => ipcRenderer.invoke("delete-category", name),
  renameCategory: (oldName, newName) => ipcRenderer.invoke("rename-category", oldName, newName),
  addAddon: (category, productName, addon) => ipcRenderer.invoke("add-addon", category, productName, addon),
  removeAddon: (category, productName, addonName) => ipcRenderer.invoke("remove-addon", category, productName, addonName),
  addProduct: (category, product) => ipcRenderer.invoke("add-product", category, product),
  toggleProductAvailability: (category, productName) => ipcRenderer.invoke("toggle-product-availability", category, productName),
  deleteProduct: (category, productName) => ipcRenderer.invoke("delete-product", category, productName),
  editProductPrice: (category, productName, newPrice, halfPrice) => ipcRenderer.invoke("edit-product-price", category, productName, newPrice, halfPrice),

  // ── Orders / Cart ──
  getActiveOrders: () => ipcRenderer.invoke("get-active-orders"),
  addToOrder: (orderId, item) => ipcRenderer.invoke("add-to-order", orderId, item),
  clearCart: (orderId) => ipcRenderer.invoke("clear-cart", orderId),
  increaseCartItemQuantity: (orderId, itemIndex) => ipcRenderer.invoke("increase-cart-item-quantity", orderId, itemIndex),
  decreaseCartItemQuantity: (orderId, itemIndex) => ipcRenderer.invoke("decrease-cart-item-quantity", orderId, itemIndex),
  removeCartItem: (orderId, itemIndex) => ipcRenderer.invoke("remove-cart-item", orderId, itemIndex),

  // ── Billing ──
  finalizeBill: (payload) => ipcRenderer.invoke("finalize-bill", payload),
  getNextBillNumber: () => ipcRenderer.invoke("get-next-bill-number"),
  printReceipt: () => ipcRenderer.invoke("print-receipt"),
  markBillPrinted: (billNo) => ipcRenderer.invoke("mark-bill-printed", billNo),
  deleteBill: (billNo) => ipcRenderer.invoke("delete-bill", billNo),

  // ── Sales & Analytics ──
  getSalesByDate: (date) => ipcRenderer.invoke("get-sales-by-date", date),
  getSalesData: (date) => ipcRenderer.invoke("get-sales-data", date),
  getSalesDates: () => ipcRenderer.invoke("get-sales-dates"),
  getWeeklyRevenue: () => ipcRenderer.invoke("get-weekly-revenue"),
  getDashboardAnalytics: (date) => ipcRenderer.invoke("get-dashboard-analytics", date),
  getLowStockItems: () => ipcRenderer.invoke("get-low-stock-items"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  // ── Inventory ──
  getInventory: () => ipcRenderer.invoke("get-inventory"),
  updateStock: (name, newStock, source) => ipcRenderer.invoke("update-stock", name, newStock, source),
  updateLowStock: (name, newLowStock) => ipcRenderer.invoke("update-lowstock", name, newLowStock),
  addInventoryItem: (itemData) => ipcRenderer.invoke("add-inventory-item", itemData),
  deleteInventoryItem: (name) => ipcRenderer.invoke("delete-inventory-item", name),
  getInventorySyncStatus: () => ipcRenderer.invoke("get-inventory-sync-status"),
  syncInventoryToMenu: () => ipcRenderer.invoke("sync-inventory-to-menu"),
  bulkUpdateStock: (updates) => ipcRenderer.invoke("bulk-update-stock", updates),
  getInventoryAuditLog: () => ipcRenderer.invoke("get-inventory-audit-log"),
  getInventoryHealth: () => ipcRenderer.invoke("get-inventory-health"),

  // ── Database & Settings ──
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  getHealthStatus: () => ipcRenderer.invoke("get-health-status"),
  getAuditLog: () => ipcRenderer.invoke("get-audit-log"),
  toggleInventory: () => ipcRenderer.invoke("toggle-inventory"),

  // ── Printer ──
  getPrinterConfig: () => ipcRenderer.invoke("get-printer-config"),
  savePrinterConfig: (config) => ipcRenderer.invoke("save-printer-config", config),

  // ── Backup ──
  createBackup: () => ipcRenderer.invoke("create-backup"),

  // ── Logging ──
  logEvent: (data) => ipcRenderer.invoke("log-event", data),
});
