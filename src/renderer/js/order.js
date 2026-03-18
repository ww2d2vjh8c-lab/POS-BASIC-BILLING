// ================= TABLE & ORDER MANAGEMENT =================

async function loadInitialData() {
  try {
    document.getElementById("welcome-screen").style.display = "none";
    document.getElementById("pos-app").style.display = "block";
    await loadCategories();
    await loadSettings();
    showTableView(); // Show the new table view first
  } catch (error) {
    console.error("enter POS error:", error);
    showToast("Failed to start POS", "error");
  }
}

function renderTableGrid(numberOfTables = 6) {
  const tableGrid = document.getElementById("tableGrid");
  if (!tableGrid) return;

  const safeTableCount = Number.isInteger(numberOfTables) && numberOfTables > 0 ? numberOfTables : 6;
  tableGrid.innerHTML = "";

  for (let tableNumber = 1; tableNumber <= safeTableCount; tableNumber++) {
    const orderId = `Table ${tableNumber}`;
    const tableEl = document.createElement("div");
    tableEl.className = "table-item";
    tableEl.id = `order-${orderId}`;
    tableEl.innerText = orderId;
    tableEl.onclick = () => selectOrder(orderId);
    tableGrid.appendChild(tableEl);
  }

  const deliveryEl = document.createElement("div");
  deliveryEl.className = "table-item delivery";
  deliveryEl.id = "order-Delivery";
  deliveryEl.innerText = "Delivery";
  deliveryEl.onclick = () => selectOrder("Delivery");
  tableGrid.appendChild(deliveryEl);

  const directBillEl = document.createElement("div");
  directBillEl.className = "table-item delivery";
  directBillEl.id = "order-Direct Bill";
  directBillEl.innerText = "Direct Bill";
  directBillEl.onclick = () => selectOrder("Direct Bill");
  tableGrid.appendChild(directBillEl);
}

function showTableView() {
  const tableView = document.getElementById("tableView");
  const orderView = document.getElementById("orderView");
  
  if (!tableView || !orderView) return; // DOM safety
  
  tableView.style.display = "block";
  orderView.style.display = "none";
  currentOrderId = null;
  updateTableStatus();

  const searchInput = document.getElementById("productSearch");
  if (searchInput) searchInput.value = "";
  const clearBtn = document.getElementById("clearSearchBtn");
  if (clearBtn) clearBtn.style.display = "none";
}

function selectOrder(orderId) {
  currentOrderId = orderId;
  
  const tableView = document.getElementById("tableView");
  const orderView = document.getElementById("orderView");
  const currentOrderTitle = document.getElementById("currentOrderTitle");
  
  if (!tableView || !orderView || !currentOrderTitle) return; // DOM safety
  
  tableView.style.display = "none";
  orderView.style.display = "block";
  currentOrderTitle.innerText = `Now Serving: ${orderId}`;

  renderCart();

  // Auto-focus product search so staff can type immediately
  const searchInput = document.getElementById("productSearch");
  if (searchInput) setTimeout(() => searchInput.focus(), 50);
}

// Internal: update table status DOM from pre-fetched activeOrders data.
// Called by refreshCartView() in cart.js to avoid a second getActiveOrders round-trip.
function _updateTableStatusFromData(activeOrders) {
  const tableItems = document.querySelectorAll(".table-item");
  if (!tableItems) return;

  tableItems.forEach(table => {
    table.classList.remove("in-use");
    const existing = table.querySelector(".table-badge");
    if (existing) existing.remove();
  });

  for (const orderId in activeOrders) {
    const tableElement = document.getElementById(`order-${orderId}`);

    if (tableElement && activeOrders[orderId]) {
      tableElement.classList.add("in-use");

      // Show item count badge
      const items = Array.isArray(activeOrders[orderId]) ? activeOrders[orderId] : [];
      const itemCount = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
      if (itemCount > 0) {
        const badge = document.createElement("span");
        badge.className = "table-badge";
        badge.textContent = itemCount;
        tableElement.appendChild(badge);
      }
    }
  }
}

async function updateTableStatus() {
  try {
    const response = await window.electronAPI.getActiveOrders();
    if (!response.success) {
      console.error("Failed to get active orders:", response.error);
      return;
    }
    _updateTableStatusFromData(response.data);
  } catch (error) {
    console.error("updateTableStatus error:", error);
  }
}
