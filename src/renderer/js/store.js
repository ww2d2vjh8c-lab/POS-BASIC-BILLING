// ================= GLOBAL STATE =================
let currentMenu = [];
let appSettings = {
  inventoryEnabled: true,
  numberOfTables: 6
};

let currentOrderId = null; // e.g., 'Table 1', 'Delivery'

let pendingProduct = null;
let selectedAddons = [];
let pendingProductForSize = null;
let inventorySnapshot = [];
const inventoryUpdateQueues = new Map();

function queueInventoryOperation(key, operation) {
  const previous = inventoryUpdateQueues.get(key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(operation)
    .finally(() => {
      if (inventoryUpdateQueues.get(key) === next) {
        inventoryUpdateQueues.delete(key);
      }
    });

  inventoryUpdateQueues.set(key, next);
  return next;
}
