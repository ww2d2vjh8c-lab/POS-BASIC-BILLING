// ================= TABLE & ORDER MANAGEMENT =================

const SPECIAL_ORDERS = [
  { id: "Delivery", icon: "truck" },
  { id: "Direct Bill", icon: "receipt" },
];

function _buildTableTile(orderId, { special = null } = {}) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "table-item" + (special ? " table-item--special" : "");
  tile.id = `order-${orderId}`;
  tile.dataset.orderId = orderId;

  const kind = special ? "Order" : "Table";
  const label = special ? `${icon(special.icon)}<span>${escapeHTML(orderId)}</span>` : escapeHTML(orderId.replace(/^Table\s+/, ""));
  tile.innerHTML = `
    <span class="table-top">
      <span class="table-kind">${kind}</span>
      <span class="table-status">Free</span>
    </span>
    <span class="table-num">${label}</span>
    <span class="table-foot">
      <span class="table-meta">Tap to start</span>
      <span class="table-total num"></span>
    </span>`;
  tile.setAttribute("aria-label", `${orderId}, free`);
  tile.onclick = () => selectOrder(orderId);
  return tile;
}

function renderTableGrid(numberOfTables = 6) {
  const tableGrid = document.getElementById("tableGrid");
  if (!tableGrid) return;

  const safeTableCount = Number.isInteger(numberOfTables) && numberOfTables > 0 ? numberOfTables : 6;
  const frag = document.createDocumentFragment();
  for (let tableNumber = 1; tableNumber <= safeTableCount; tableNumber++) {
    frag.appendChild(_buildTableTile(`Table ${tableNumber}`));
  }
  SPECIAL_ORDERS.forEach(s => frag.appendChild(_buildTableTile(s.id, { special: s })));
  tableGrid.replaceChildren(frag);
  updateTableStatus();
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
  orderView.style.display = "flex";
  currentOrderTitle.textContent = orderId;

  // Re-show the selected category's products (clears any leftover search).
  if (typeof searchProducts === "function") searchProducts("");
  renderCart();

  // Auto-focus product search so staff can type immediately
  const searchInput = document.getElementById("productSearch");
  if (searchInput) setTimeout(() => searchInput.focus(), 50);
}

// Internal: update table tiles from pre-fetched activeOrders data.
// Called by refreshCartView() in cart.js to avoid a second getActiveOrders round-trip.
function _updateTableStatusFromData(activeOrders) {
  const orders = activeOrders || {};
  let openCount = 0;
  let openTotal = 0;

  document.querySelectorAll("#tableGrid .table-item").forEach(tile => {
    const orderId = tile.dataset.orderId;
    const items = Array.isArray(orders[orderId]) ? orders[orderId] : [];
    const { count, total } = cartTotals(items);
    const busy = count > 0;

    tile.classList.toggle("in-use", busy);
    const status = tile.querySelector(".table-status");
    const meta = tile.querySelector(".table-meta");
    const totalEl = tile.querySelector(".table-total");
    if (status) status.textContent = busy ? "Occupied" : "Free";
    if (meta) meta.textContent = busy ? `${count} item${count !== 1 ? "s" : ""}` : "Tap to start";
    if (totalEl) totalEl.textContent = busy ? formatMoney(total) : "";
    tile.setAttribute("aria-label", busy
      ? `${orderId}, occupied, ${count} items, ${formatMoney(total)}`
      : `${orderId}, free`);

    if (busy) { openCount++; openTotal += total; }
  });

  const summary = document.getElementById("tableSummary");
  if (summary) {
    summary.textContent = openCount === 0
      ? "All tables are free"
      : `${openCount} open order${openCount !== 1 ? "s" : ""} · ${formatMoney(openTotal)} running`;
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
