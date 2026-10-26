// ================= APP INITIALIZATION =================

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const version = await window.electronAPI.getAppVersion();
    const versionEl = document.getElementById("app-version");
    if (versionEl) versionEl.textContent = "Version " + (version || "1.1.0");
  } catch (e) {
    console.warn("Could not get app version", e);
  }
});

// ---------- Header clock (updates twice a minute; no per-second work) ----------
function _updateClock() {
  const el = document.getElementById("headerClock");
  if (!el) return;
  const now = new Date();
  const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  const date = now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
  el.innerHTML = `<span class="clock-time">${escapeHTML(time)}</span><span class="clock-date">${escapeHTML(date)}</span>`;
}
_updateClock();
setInterval(_updateClock, 30 * 1000);

// ================= KEYBOARD SHORTCUTS =================
//   Esc            close the top-most dialog (or clear the product search)
//   Enter          confirm the top dialog (finalize bill, add add-ons, print)
//   F1             open the bill for the current order
//   / or Ctrl+F    focus product search; typing any letter also starts a search
//   Enter (search) add the first matching product
//   1-9            on the table screen, open that table
//   C / U / P      in checkout: Cash / UPI / Card
//   1 / 2          in the size picker: Half / Full

function _isVisible(id) {
  const el = document.getElementById(id);
  return !!el && el.style.display !== "none" && el.offsetParent !== null;
}

function _setPaymentMode(value) {
  const radio = document.querySelector(`input[name="paymentMode"][value="${value}"]`);
  if (radio && !radio.checked) {
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function _handleModalKeys(e, top, target, isTextInput) {
  const tag = target?.tagName?.toUpperCase();
  const key = e.key;
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;

  if (top.id === "billModal") {
    // Number inputs can't take letters, so C/U/P still work while typing cash.
    const lettersOk = !isTextInput || target.type === "number";
    if (plain && lettersOk) {
      const k = key.toLowerCase();
      if (k === "c") { e.preventDefault(); _setPaymentMode("Cash"); return; }
      if (k === "u") { e.preventDefault(); _setPaymentMode("UPI"); return; }
      if (k === "p") { e.preventDefault(); _setPaymentMode("Card"); return; }
    }
    if (key === "Enter" && !e.shiftKey) {
      if (target?.id === "discountCustomInput") {
        e.preventDefault();
        const cash = document.getElementById("cashReceivedInput");
        if (cash && cash.offsetParent !== null) cash.focus(); else document.getElementById("finalizeBillBtn")?.focus();
        return;
      }
      // Let other focused buttons (Cancel, Print, discount chips) do their own thing.
      if (tag === "BUTTON" && target.id !== "finalizeBillBtn") return;
      e.preventDefault();
      if (typeof finalizeBill === "function") finalizeBill();
      return;
    }
    if (key === "F1") e.preventDefault();
    return;
  }

  if (top.id === "sizeModal" && plain) {
    if (key === "1" || key.toLowerCase() === "h") { e.preventDefault(); selectSize("half"); return; }
    if (key === "2" || key.toLowerCase() === "f") { e.preventDefault(); selectSize("full"); return; }
  }

  if (top.id === "addonModal" && key === "Enter" && tag !== "BUTTON") {
    e.preventDefault();
    confirmAddons();
    return;
  }

  if (top.id === "printConfirmModal" && key === "Enter" && tag !== "BUTTON") {
    e.preventDefault();
    document.getElementById("printReceiptBtn")?.click();
  }
}

document.addEventListener("keydown", function (e) {
  const target = e.target || document.activeElement;
  const tag = target?.tagName?.toUpperCase();
  const isTextInput = tag === "TEXTAREA" || tag === "SELECT" ||
    (tag === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(target.type));
  const top = getTopModal();
  const search = document.getElementById("productSearch");

  if (e.key === "Escape") {
    if (top) {
      e.preventDefault();
      closeTopModal();
      return;
    }
    if (target === search && search.value) {
      e.preventDefault();
      clearSearch();
    }
    return;
  }

  if (top) {
    _handleModalKeys(e, top, target, isTextInput);
    return;
  }

  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;

  // ---- Order screen ----
  if (_isVisible("orderView")) {
    if (e.key === "F1") {
      e.preventDefault();
      if (typeof openBillPreview === "function" && currentOrderId) openBillPreview();
      return;
    }
    if (target === search) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (search.value.trim()) {
          clearTimeout(_searchDebounceTimer);
          searchProducts(search.value);   // make sure results reflect the latest keystroke
          if (!addFirstSearchResult()) showToast("No available item matches that search", "warning");
        }
      } else if (e.key === "ArrowDown") {
        const first = document.querySelector("#products .product-card");
        if (first) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (!isTextInput && ((e.key === "/" && plain) || (e.ctrlKey && e.key.toLowerCase() === "f"))) {
      e.preventDefault();
      if (search) { search.focus(); search.select(); }
      return;
    }
    // Start typing anywhere to search the menu.
    if (!isTextInput && plain && e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key) && search) {
      search.focus();   // the keystroke lands in the search box
    }
    return;
  }

  // ---- Table screen: digit opens that table ----
  if (_isVisible("tableView") && !isTextInput && plain && /^[1-9]$/.test(e.key)) {
    const tile = document.getElementById(`order-Table ${e.key}`);
    if (tile) { e.preventDefault(); tile.click(); }
  }
});

document.getElementById("enter-btn").onclick = async () => {
  try {
    document.getElementById("welcome-screen").style.display = "none";
    document.getElementById("pos-app").style.display = "flex";
    await loadCategories();
    await loadSettings();
    showTableView(); // Show the table view first
  } catch (error) {
    console.error("enter POS error:", error);
    showToast("Failed to start POS", "error");
  }
};

// Debounced product search — fires immediately on clear, 120ms delay on typing
let _searchDebounceTimer = null;
function searchProductsDebounced(query) {
  clearTimeout(_searchDebounceTimer);
  const clearBtn = document.getElementById("clearSearchBtn");
  if (clearBtn) clearBtn.style.display = query && query.trim() ? "inline-flex" : "none";
  if (!query || query.trim() === "") {
    searchProducts(query);
    return;
  }
  _searchDebounceTimer = setTimeout(() => searchProducts(query), 120);
}

function clearSearch() {
  const searchInput = document.getElementById("productSearch");
  if (searchInput) {
    searchInput.value = "";
    searchProducts("");
    searchInput.focus();
  }
}

// ================= SETTINGS =================

function _displayCafeName(name) {
  const n = String(name || "Bloom Cafe").trim();
  // "BLOOM CAFE" → "Bloom Cafe" for the header; the receipt keeps the stored text.
  return n === n.toUpperCase() ? n.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()) : n;
}

function _renderInventoryStatus(enabled) {
  const checkbox = document.getElementById("inventoryToggle");
  const statusText = document.getElementById("inventoryStatus");
  if (checkbox) checkbox.checked = !!enabled;
  if (statusText) {
    statusText.textContent = enabled ? "Enabled" : "Disabled";
    statusText.className = `badge inventory-status-badge ${enabled ? "badge-success" : ""}`;
  }
}

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
    const brand = document.getElementById("brandName");
    if (brand) brand.textContent = _displayCafeName(appSettings.cafeName);
    _renderInventoryStatus(appSettings.inventoryEnabled);
    if (typeof _syncTableCountUI === "function") _syncTableCountUI();
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
      _renderInventoryStatus(appSettings.inventoryEnabled);
      return;
    }

    const settings = response.data;
    appSettings.inventoryEnabled = settings.inventoryEnabled;
    _renderInventoryStatus(settings.inventoryEnabled);
    showToast(settings.inventoryEnabled ? "Inventory tracking enabled" : "Inventory tracking disabled", "info");
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
  window.electronAPI.logEvent({
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
  window.electronAPI.logEvent({
    type: "UI_UNHANDLED_REJECTION",
    reason: event.reason?.toString()
  }).catch(err => console.error("Failed to log unhandled rejection:", err));

  // Prevent default handling
  event.preventDefault();
});
