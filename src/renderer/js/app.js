// ================= APP INITIALIZATION =================

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const version = await window.electronAPI.getAppVersion();
    const versionEl = document.getElementById("app-version");
    if (versionEl) versionEl.textContent = "v" + (version || "1.1.0");
  } catch (e) {
    console.warn("Could not get app version", e);
  }
});

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    const modals = ["sizeModal", "addonModal", "billModal", "dashboardModal", "menuModal", "inventoryModal", "printerModal"];
    modals.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display !== "none") {
        el.style.display = "none";
      }
    });
    pendingProduct = null;
    pendingProductForSize = null;
  }

  // Keyboard shortcuts — only fire when not typing in an input/textarea/select
  const tag = (e.target || document.activeElement)?.tagName?.toUpperCase();
  const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

  // F1 → open bill preview
  if (e.key === "F1" && !inInput) {
    e.preventDefault();
    if (typeof openBillPreview === "function" && currentOrderId) openBillPreview();
    return;
  }

  // Payment mode shortcuts — only active when billModal is open
  const billModal = document.getElementById("billModal");
  const billModalOpen = billModal && billModal.style.display !== "none";

  if (billModalOpen && !inInput) {
    if (e.key === "c" || e.key === "C") {
      const cashRadio = document.querySelector('input[name="paymentMode"][value="Cash"]');
      if (cashRadio) { cashRadio.checked = true; cashRadio.dispatchEvent(new Event("change")); }
      return;
    }
    if (e.key === "u" || e.key === "U") {
      const upiRadio = document.querySelector('input[name="paymentMode"][value="UPI"]');
      if (upiRadio) { upiRadio.checked = true; upiRadio.dispatchEvent(new Event("change")); }
      return;
    }
    if (e.key === "p" || e.key === "P") {
      const cardRadio = document.querySelector('input[name="paymentMode"][value="Card"]');
      if (cardRadio) { cardRadio.checked = true; cardRadio.dispatchEvent(new Event("change")); }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (typeof finalizeBill === "function") finalizeBill();
      return;
    }
  }
});

document.getElementById("enter-btn").onclick = async () => {
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
};

// Debounced product search — fires immediately on clear, 150ms delay on typing
let _searchDebounceTimer = null;
function searchProductsDebounced(query) {
  clearTimeout(_searchDebounceTimer);
  if (!query || query.trim() === "") {
    searchProducts(query);
    return;
  }
  _searchDebounceTimer = setTimeout(() => searchProducts(query), 150);
}

function clearSearch() {
  const searchInput = document.getElementById("productSearch");
  if (searchInput) {
    searchInput.value = "";
    searchProducts("");
  }
}

// ================= SETTINGS =================

async function loadSettings() {
  try {
    const response = await window.electronAPI.getSettings();
    if (!response.success) {
      console.error("Failed to load settings:", response.error);
      showToast(`Failed to load settings: ${response.error}`, "error");
      return;
    }
    
    const settings = response.data || {};
    const parsedTableCount = parseInt(settings.numberOfTables, 10);
    appSettings = {
      inventoryEnabled: settings.inventoryEnabled !== false,
      numberOfTables: Number.isInteger(parsedTableCount) && parsedTableCount > 0 ? parsedTableCount : 6,
      cafeName: settings.cafeName || "BLOOM CAFE",
      cafePhone: settings.cafePhone || "Ph: 9343761114"
    };

    renderTableGrid(appSettings.numberOfTables);

    const checkbox = document.getElementById("inventoryToggle");
    const statusText = document.getElementById("inventoryStatus");
    
    if (checkbox) {
      checkbox.checked = appSettings.inventoryEnabled;
    }

    if (statusText) {
      statusText.textContent = appSettings.inventoryEnabled ? "🟢 Enabled" : "🔴 Disabled";
    }
  } catch (error) {
    showToast("Failed to load settings. Using defaults.", "error");
  }
}

async function toggleInventory() {
  try {
    const response = await window.electronAPI.toggleInventory();
    if (!response.success) {
      console.error("Failed to toggle inventory:", response.error);
      showToast(`Failed to toggle inventory: ${response.error}`, "error");
      return;
    }
    
    const settings = response.data;
    appSettings.inventoryEnabled = settings.inventoryEnabled;
    
    const checkbox = document.getElementById("inventoryToggle");
    const statusText = document.getElementById("inventoryStatus");
    
    if (checkbox) {
      checkbox.checked = settings.inventoryEnabled;
    }
    
    if (statusText) {
      statusText.textContent = settings.inventoryEnabled ? "🟢 Enabled" : "🔴 Disabled";
    }
  } catch (error) {
    showToast("Failed to toggle inventory setting", "error");
  }
}

// ================= UI WATCHDOG =================

window.onerror = function (message, source, lineno, colno, error) {
  console.error("[UI CRASH] Global error:", {
    message: message,
    source: source,
    line: lineno,
    column: colno,
    error: error?.toString()
  });
  
  // Log to backend for production debugging
  window.electronAPI.logEvent( {
    type: "UI_ERROR",
    message: message,
    source: source,
    line: lineno,
    error: error?.toString()
  }).catch(err => console.error("Failed to log UI error:", err));
  
  // Prevent default error handling to avoid renderer crash
  return true;
};

window.addEventListener("unhandledrejection", function (event) {
  console.error("[UI CRASH] Unhandled promise rejection:", {
    reason: event.reason,
    promise: event.promise
  });
  
  // Log to backend for production debugging
  window.electronAPI.logEvent( {
    type: "UI_UNHANDLED_REJECTION",
    reason: event.reason?.toString()
  }).catch(err => console.error("Failed to log unhandled rejection:", err));
  
  // Prevent default handling
  event.preventDefault();
});
