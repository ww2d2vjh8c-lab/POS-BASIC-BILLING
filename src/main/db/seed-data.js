const path = require("path");
const fs = require("fs");
const logger = require("../logger");

/**
 * Seed data for fresh installations
 * Automatically populates database with initial cafe data
 */

function getSeedMenu() {
  return {
    categories: [
      {
        name: "Hot Beverages",
        products: [
          { name: "Chai", price: 20, halfPrice: null, hasVariants: false, addons: [{ name: "Extra Sugar", price: 0 }, { name: "Makhan", price: 10 }] },
          { name: "Coffee", price: 30, halfPrice: null, hasVariants: false, addons: [{ name: "Extra Shot", price: 10 }] },
          { name: "Cappuccino", price: 60, halfPrice: null, hasVariants: false, addons: [{ name: "Oat Milk", price: 20 }] },
          { name: "Masala Chai", price: 25, halfPrice: null, hasVariants: false, addons: [{ name: "Extra Ginger", price: 5 }] }
        ]
      },
      {
        name: "Cold Beverages",
        products: [
          { name: "Cold Coffee", price: 80, halfPrice: null, hasVariants: false, addons: [{ name: "Ice Cream", price: 20 }] },
          { name: "Lemonade", price: 40, halfPrice: null, hasVariants: false, addons: [{ name: "Mint", price: 5 }] },
          { name: "Mango Shake", price: 70, halfPrice: null, hasVariants: false, addons: [] }
        ]
      },
      {
        name: "Snacks",
        products: [
          { name: "Samosa", price: 15, halfPrice: null, hasVariants: false, addons: [{ name: "Extra Chutney", price: 5 }] },
          { name: "Bread Pakoda", price: 30, halfPrice: null, hasVariants: false, addons: [] },
          { name: "French Fries", price: 60, halfPrice: 40, hasVariants: true, addons: [{ name: "Cheese Dip", price: 15 }, { name: "Peri Peri", price: 5 }] },
          { name: "Veg Sandwich", price: 50, halfPrice: null, hasVariants: false, addons: [{ name: "Grilled", price: 10 }] },
          { name: "Pakoda", price: 100, halfPrice: 50, hasVariants: true, addons: [] }
        ]
      },
      {
        name: "Main Course",
        products: [
          { name: "Veg Biryani", price: 120, halfPrice: 70, hasVariants: true, addons: [{ name: "Raita", price: 20 }, { name: "Extra Gravy", price: 15 }] },
          { name: "Dal Rice", price: 80, halfPrice: 50, hasVariants: true, addons: [{ name: "Papad", price: 10 }] },
          { name: "Paneer Butter Masala", price: 150, halfPrice: 90, hasVariants: true, addons: [{ name: "Extra Roti", price: 15 }] }
        ]
      },
      {
        name: "Breads",
        products: [
          { name: "Roti", price: 10, halfPrice: null, hasVariants: false, addons: [] },
          { name: "Naan", price: 20, halfPrice: null, hasVariants: false, addons: [{ name: "Butter", price: 5 }] },
          { name: "Paratha", price: 30, halfPrice: null, hasVariants: false, addons: [{ name: "Curd", price: 10 }, { name: "Butter", price: 5 }] }
        ]
      },
      {
        name: "Desserts",
        products: [
          { name: "Gulab Jamun", price: 40, halfPrice: null, hasVariants: false, addons: [{ name: "Ice Cream", price: 20 }] },
          { name: "Ice Cream", price: 50, halfPrice: null, hasVariants: false, addons: [{ name: "Extra Scoop", price: 20 }] },
          { name: "Kheer", price: 45, halfPrice: 30, hasVariants: true, addons: [] }
        ]
      }
    ],
    addons: []
  };
}

function getSeedInventory() {
  return {
    items: [
      { name: "Chai", stock: 100, lowStock: 20 },
      { name: "Coffee", stock: 80, lowStock: 15 },
      { name: "Cappuccino", stock: 60, lowStock: 10 },
      { name: "Masala Chai", stock: 75, lowStock: 15 },
      { name: "Cold Coffee", stock: 50, lowStock: 10 },
      { name: "Lemonade", stock: 40, lowStock: 8 },
      { name: "Mango Shake", stock: 30, lowStock: 6 },
      { name: "Samosa", stock: 60, lowStock: 12 },
      { name: "Bread Pakoda", stock: 45, lowStock: 9 },
      { name: "French Fries", stock: 80, lowStock: 16 },
      { name: "Veg Sandwich", stock: 40, lowStock: 8 },
      { name: "Pakoda", stock: 35, lowStock: 7 },
      { name: "Veg Biryani", stock: 25, lowStock: 5 },
      { name: "Dal Rice", stock: 30, lowStock: 6 },
      { name: "Paneer Butter Masala", stock: 20, lowStock: 4 },
      { name: "Roti", stock: 200, lowStock: 40 },
      { name: "Naan", stock: 100, lowStock: 20 },
      { name: "Paratha", stock: 80, lowStock: 16 },
      { name: "Gulab Jamun", stock: 50, lowStock: 10 },
      { name: "Ice Cream", stock: 40, lowStock: 8 },
      { name: "Kheer", stock: 30, lowStock: 6 }
    ]
  };
}

function getSeedSettings() {
  return {
    numberOfTables: 6,
    inventoryEnabled: true,
    currency: "₹",
    taxRate: 0,
    companyName: "Bloom Cafe",
    address: "",
    phone: "",
    email: ""
  };
}

function seedDatabase(db) {
  try {
    logger.info("SEED_DATABASE_START");
    
    const seed = db.transaction(() => {
      // Seed menu
      const menu = getSeedMenu();
      const insCat = db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)");
      const insProd = db.prepare("INSERT INTO products (category_id, name, price, half_price, has_variants, available) VALUES (?, ?, ?, ?, ?, ?)");
      const insAddon = db.prepare("INSERT OR IGNORE INTO addons (name, price) VALUES (?, ?)");
      const getAddon = db.prepare("SELECT id FROM addons WHERE name = ?");
      const linkAddon = db.prepare("INSERT OR IGNORE INTO product_addons (product_id, addon_id) VALUES (?, ?)");
      
      menu.categories.forEach((cat, catIndex) => {
        insCat.run(cat.name, catIndex);
        const catRow = db.prepare("SELECT id FROM categories WHERE name = ?").get(cat.name);
        
        cat.products.forEach(product => {
          const prodId = insProd.run(
            catRow.id,
            product.name,
            product.price || 0,
            product.halfPrice || null,
            product.hasVariants ? 1 : 0,
            1 // available
          ).lastInsertRowid;
          
          // Add addons
          (product.addons || []).forEach(addon => {
            insAddon.run(addon.name, addon.price || 0);
            const addonRow = getAddon.get(addon.name);
            if (addonRow) {
              linkAddon.run(prodId, addonRow.id);
            }
          });
        });
      });
      
      // Seed inventory
      const inventory = getSeedInventory();
      const insInv = db.prepare("INSERT OR IGNORE INTO inventory (name, stock, low_stock_alert) VALUES (?, ?, ?)");
      inventory.items.forEach(item => {
        insInv.run(item.name, item.stock, item.lowStock);
      });
      
      // Seed settings
      const settings = getSeedSettings();
      const insSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      Object.entries(settings).forEach(([key, value]) => {
        insSetting.run(key, typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value));
      });
      
      // Mark as seeded
      insSetting.run('database_seeded', 'true');
    });
    
    seed();
    
    const menu = getSeedMenu();
    const inventory = getSeedInventory();
    
    logger.info("SEED_DATABASE_COMPLETE", {
      categories: menu.categories.length,
      products: menu.categories.reduce((sum, cat) => sum + cat.products.length, 0),
      inventoryItems: inventory.items.length,
      settings: Object.keys(getSeedSettings()).length
    });
    
    return true;
  } catch (error) {
    logger.error("SEED_DATABASE_FAILED", { error: error.message, stack: error.stack });
    throw new Error(`Database seeding failed: ${error.message}`);
  }
}

function isDatabaseSeeded(db) {
  try {
    const result = db.prepare("SELECT value FROM settings WHERE key = 'database_seeded'").get();
    return result && result.value === 'true';
  } catch (error) {
    return false;
  }
}

module.exports = {
  seedDatabase,
  isDatabaseSeeded,
  getSeedMenu,
  getSeedInventory,
  getSeedSettings
};
