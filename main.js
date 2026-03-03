const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ==============================
// PATH HELPERS
// ==============================
function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getSalesFile(date) {
  return path.join(__dirname, `sales-${date}.json`);
}

function getInventoryFile() {
  return path.join(__dirname, `inventory.json`);
}

function getMenuFile() {
  return path.join(__dirname, `menu.json`);
}

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

// ==============================
// MENU FUNCTIONS
// ==============================
function readMenu() {
  return readJSON(getMenuFile()) || { categories: [] };
}

function writeMenu(data) {
  fs.writeFileSync(getMenuFile(), JSON.stringify(data, null, 2));
}

// Get full menu
ipcMain.handle("get-menu", async () => {
  return readMenu();
});

// Add category
ipcMain.handle("add-category", async (event, categoryName) => {
  let menu = readMenu();
  menu.categories.push({ name: categoryName, products: [] });
  writeMenu(menu);
  return menu;
});

// Delete category
ipcMain.handle("delete-category", async (event, categoryName) => {
  let menu = readMenu();
  menu.categories = menu.categories.filter(c => c.name !== categoryName);
  writeMenu(menu);
  return menu;
});

// Edit product price
ipcMain.handle("edit-product-price", async (event, categoryName, productName, newPrice) => {
  let menu = readMenu();
  const category = menu.categories.find(c => c.name === categoryName);
  if (category) {
    const product = category.products.find(p => p.name === productName);
    if (product) {
      product.price = parseFloat(newPrice);
    }
  }
  writeMenu(menu);
  return menu;
});

// Remove add-on from product
ipcMain.handle("add-addon", async (event, categoryName, productName, addon) => {
  let menu = readMenu();
  const category = menu.categories.find(c => c.name === categoryName);
  if (category) {
    const product = category.products.find(p => p.name === productName);
    if (product) {
      if (!product.addons) {
        product.addons = [];
      }
      product.addons.push(addon);
    }
  }
  writeMenu(menu);
  return menu;
});

ipcMain.handle("remove-addon", async (event, categoryName, productName, addonName) => {
  let menu = readMenu();
  const category = menu.categories.find(c => c.name === categoryName);
  if (category) {
    const product = category.products.find(p => p.name === productName);
    if (product && product.addons) {
      product.addons = product.addons.filter(a => a.name !== addonName);
    }
  }
  writeMenu(menu);
  return menu;
});

// Add product
ipcMain.handle("add-product", async (event, categoryName, product) => {
  let menu = readMenu();
  const category = menu.categories.find(c => c.name === categoryName);
  if (category) {
    category.products.push(product);
  }
  writeMenu(menu);
  
  // Auto-create inventory entry
  let inventory = readInventory();
  const existingItem = inventory.items.find(i => i.name === product.name);
  if (!existingItem) {
    inventory.items.push({
      name: product.name,
      stock: 50,
      lowStock: 5
    });
    writeInventory(inventory);
  }
  
  return menu;
});

// Delete product
ipcMain.handle("delete-product", async (event, categoryName, productName) => {
  let menu = readMenu();
  const category = menu.categories.find(c => c.name === categoryName);
  if (category) {
    category.products = category.products.filter(p => p.name !== productName);
  }
  writeMenu(menu);
  return menu;
});

// ==============================
// INVENTORY FUNCTIONS
// ==============================
function readInventory() {
  const filePath = getInventoryFile();
  return readJSON(filePath) || { items: [] };
}

function writeInventory(data) {
  fs.writeFileSync(getInventoryFile(), JSON.stringify(data, null, 2));
}

// ==============================
// SAVE BILL + DEDUCT STOCK
// ==============================
ipcMain.on("save-bill", (event, bill) => {
  const today = getToday();
  const filePath = getSalesFile(today);

  let data = {
    date: today,
    totalRevenue: 0,
    totalBills: 0,
    bills: []
  };

  const existing = readJSON(filePath);
  if (existing) data = existing;

  let inventory = readInventory();

  bill.items.forEach(soldItem => {
    // Deduct stock for base product
    const item = inventory.items.find(i => i.name === soldItem.name);
    if (item) {
      item.stock -= soldItem.quantity;
      if (item.stock < 0) item.stock = 0;
    }
    // Note: Add-ons are not deducted from inventory as they are enhancements
  });

  writeInventory(inventory);

  // Generate bill number
  let billNumber = 1;
  if (data.bills && data.bills.length > 0) {
    const lastBill = data.bills[data.bills.length - 1];
    const parts = lastBill.billNo.split("-");
    const lastNum = parseInt(parts[parts.length - 1]);
    if (!isNaN(lastNum)) {
      billNumber = lastNum + 1;
    }
  }
  
  const billNo = `BC-${today.replace(/-/g, "")}-${billNumber}`;
  
  const billData = {
    billNo: billNo,
    time: new Date().toLocaleString(),
    items: bill.items,
    paymentMode: bill.paymentMode || "Cash",
    total: bill.total
  };

  data.bills.push(billData);
  data.totalRevenue += bill.total;
  data.totalBills += 1;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
});

// ==============================
// SALES & BILL HELPERS
// ==============================
ipcMain.handle("get-sales-by-date", async (event, date) => {
  const filePath = getSalesFile(date);
  const data = readJSON(filePath);

  if (!data) {
    return {
      date,
      totalRevenue: 0,
      totalBills: 0,
      bills: []
    };
  }

  return data;
});

ipcMain.handle("get-next-bill-number", async () => {
  const today = getToday();
  const filePath = getSalesFile(today);
  const data = readJSON(filePath);

  if (!data || data.bills.length === 0) return 1;

  const last = data.bills[data.bills.length - 1];
  const parts = last.billNo.split("-");
  const number = parseInt(parts[2]);

  return isNaN(number) ? 1 : number + 1;
});

ipcMain.handle("delete-bill", async (event, billNo) => {
  const today = getToday();
  const filePath = getSalesFile(today);
  const data = readJSON(filePath);

  if (!data) return null;

  const index = data.bills.findIndex(b => b.billNo === billNo);
  if (index === -1) return data;

  const removed = data.bills[index];

  let inventory = readInventory();
  removed.items.forEach(item => {
    const invItem = inventory.items.find(i => i.name === item.name);
    if (invItem) {
      invItem.stock += item.quantity;
    }
  });

  writeInventory(inventory);

  data.bills.splice(index, 1);
  data.totalRevenue -= removed.total;
  data.totalBills -= 1;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return data;
});

// ==============================
// INVENTORY IPC
// ==============================
ipcMain.handle("get-inventory", async () => {
  return readInventory();
});

ipcMain.handle("update-stock", async (event, name, newStock) => {
  let inventory = readInventory();
  const item = inventory.items.find(i => i.name === name);
  if (item) {
    item.stock = parseInt(newStock);
    if (item.stock < 0) item.stock = 0;
  }
  writeInventory(inventory);
  return inventory;
});

// Update low stock threshold
ipcMain.handle("update-lowstock", async (event, name, newLowStock) => {
  let inventory = readInventory();
  const item = inventory.items.find(i => i.name === name);
  if (item) {
    item.lowStock = parseInt(newLowStock);
  }
  writeInventory(inventory);
  return inventory;
});

// Add manual inventory item
ipcMain.handle("add-inventory-item", async (event, itemData) => {
  let inventory = readInventory();
  const existingItem = inventory.items.find(i => i.name === itemData.name);
  if (!existingItem) {
    inventory.items.push({
      name: itemData.name,
      stock: itemData.stock || 50,
      lowStock: itemData.lowStock || 5
    });
    writeInventory(inventory);
  }
  return inventory;
});

// Get all sales files (for date selector)
ipcMain.handle("get-sales-dates", async () => {
  const files = fs.readdirSync(__dirname);
  const salesFiles = files.filter(f => f.startsWith("sales-") && f.endsWith(".json"));
  return salesFiles.map(f => f.replace("sales-", "").replace(".json", ""));
});

// ==============================
// DASHBOARD ANALYTICS
// ==============================
ipcMain.handle("get-dashboard-analytics", async (event, date) => {
  const salesData = readJSON(getSalesFile(date));
  const menu = readMenu();
  
  if (!salesData || !salesData.bills || salesData.bills.length === 0) {
    return {
      topSellingProducts: [],
      salesByCategory: [],
      paymentModeDistribution: {}
    };
  }

  // 1. Top Selling Products
  const productSales = {};
  salesData.bills.forEach(bill => {
    bill.items.forEach(item => {
      productSales[item.name] = (productSales[item.name] || 0) + item.quantity;
    });
  });
  const topSellingProducts = Object.entries(productSales)
    .sort(([, qtyA], [, qtyB]) => qtyB - qtyA)
    .slice(0, 5) // Top 5
    .map(([name, quantity]) => ({ name, quantity }));

  // 2. Sales by Category
  const categorySales = {};
  salesData.bills.forEach(bill => {
    bill.items.forEach(item => {
      const productCategory = menu.categories.find(c => c.products.some(p => p.name === item.name));
      if (productCategory) {
        const categoryName = productCategory.name;
        categorySales[categoryName] = (categorySales[categoryName] || 0) + (item.price * item.quantity);
      }
    });
  });
   const salesByCategory = Object.entries(categorySales)
    .map(([name, revenue]) => ({ name, revenue: revenue.toFixed(2) }));


  // 3. Payment Mode Distribution
  const paymentModes = {};
  salesData.bills.forEach(bill => {
    const mode = bill.paymentMode || "Cash";
    paymentModes[mode] = (paymentModes[mode] || 0) + 1;
  });

  return {
    topSellingProducts,
    salesByCategory,
    paymentModeDistribution: paymentModes
  };
});

ipcMain.handle("get-low-stock-items", async () => {
  const inventory = readInventory();
  if (!inventory || !inventory.items) return [];
  return inventory.items.filter(item => item.stock <= item.lowStock);
});