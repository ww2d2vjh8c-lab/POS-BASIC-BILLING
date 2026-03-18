// ================= BILL PREVIEW =================

// Optimized for Everycom EC-58 58mm thermal printer (32 chars max)
function formatReceiptLine(index, name, qty, price) {
  // Format: "1. ItemName     x1  ₹50.00"
  // Index: 3 chars ("1. ")
  // Name: 14 chars max (truncated with ... if needed)
  // Qty: 2 chars ("x1")
  // Price: 10 chars (" ₹99999.99") — handles up to ₹99,999.99
  // Spacing: 3 chars
  // Total: 32 chars
  
  const idxStr = index ? String(index).padStart(2) + "." : "   ";
  
  // Smart name truncation - if >14 chars, truncate with ".."
  let nameStr = name;
  if (name.length > 14) {
    nameStr = name.substring(0, 12) + "..";
  }
  nameStr = nameStr.padEnd(14);
  
  const qtyStr = qty ? "x" + String(qty).padStart(1) : "  ";
  const priceStr = price ? String(price).padStart(10) : "          ";
  
  return idxStr + " " + nameStr + " " + qtyStr + " " + priceStr;
}

// Helper to center text in 32 char width
function centerText(text, width = 32) {
  if (text.length >= width) return text.substring(0, width);
  const padding = Math.max(0, width - text.length);
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;
  return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
}

// Helper to create a divider line
function divider(char = '-') {
  return char.repeat(32);
}

// Format currency with proper spacing
function formatPrice(amount) {
  return "₹" + amount.toFixed(2);
}

function renderBillContent(billData, { isPreview = false } = {}) {
  const items = Array.isArray(billData?.items) ? billData.items : [];
  const paymentMode = billData?.paymentMode || "Cash";
  const orderLabel = billData?.orderId || currentOrderId || "Walk-in";
  const billNumberLabel = isPreview ? "Prev" + (billData.billNo || "1") : (billData.billNo || "1");
  let createdAt;
  try {
    const t = billData?.time;
    if (!t) {
      createdAt = new Date();
    } else {
      createdAt = new Date(t);
      if (isNaN(createdAt.getTime())) createdAt = new Date();
    }
  } catch (e) {
    createdAt = new Date();
  }
  const dateStr = createdAt.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const timeStr = createdAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  let total = 0;
  let totalItems = 0;
  let itemsText = "";

  // Build items list with optimized formatting
  items.forEach((item, index) => {
    const addonTotalPerUnit = Array.isArray(item.addons)
      ? item.addons.reduce((sum, addon) => sum + (addon.price || 0), 0)
      : 0;
    const rate = (item.price || 0) + addonTotalPerUnit;
    const quantity = item.quantity || 0;
    const itemTotal = rate * quantity;
    total += itemTotal;
    totalItems += quantity;

    // Main item line - optimized format
    const itemPrice = formatPrice(itemTotal);
    itemsText += formatReceiptLine(index + 1, item.name, quantity, itemPrice) + "\n";

    // Add addon lines if any - compact format
    if (Array.isArray(item.addons) && item.addons.length > 0) {
      item.addons.forEach(addon => {
        const addonPrice = formatPrice(addon.price || 0);
        itemsText += formatReceiptLine("", "+" + addon.name.substring(0, 12), "", addonPrice) + "\n";
      });
    }
  });

  const rawTotal    = total;
  const discountAmt = typeof billData?.discountAmount === "number" ? billData.discountAmount : 0;
  const finalTotal  = typeof billData?.total === "number" ? billData.total : Math.max(0, rawTotal - discountAmt);
  const billContent = document.getElementById("billContent");
  if (!billContent) return;

  // Pull cafe details from appSettings (set by loadSettings on startup).
  // Falls back to hardcoded defaults only if settings haven't loaded yet.
  const cafeName  = (typeof appSettings !== "undefined" && appSettings.cafeName)  || "BLOOM CAFE";
  const cafePhone = (typeof appSettings !== "undefined" && appSettings.cafePhone) || "Ph: 9343761114";

  // Build compact receipt optimized for EC-58
  const receiptText = [
    centerText(cafeName),
    centerText(cafePhone),
    divider(),
    isPreview ? centerText("Preview Receipt") : centerText("Receipt"),
    divider(),
    "Date: " + dateStr + "  No: " + billNumberLabel,
    "Time: " + timeStr + "  Tbl: " + orderLabel.substring(0, 8),
    divider(),
    " #. " + "ITEM".padEnd(14) + " " + "QT" + " " + "AMT".padStart(10),
    divider(),
    itemsText.trimEnd(),
    divider(),
    ...(discountAmt > 0 ? [
      "Items: " + String(totalItems).padStart(2) + "   Sub: " + formatPrice(rawTotal).padStart(13),
      "Discount: -" + formatPrice(discountAmt).padStart(21),
      "TOTAL: " + formatPrice(finalTotal).padStart(24),
    ] : [
      "Items: " + String(totalItems).padStart(2) + "   Total: " + formatPrice(finalTotal).padStart(11),
    ]),
    divider(),
    "Payment: " + paymentMode.substring(0, 10).padStart(22),
    "Received: " + formatPrice(billData?.cashReceived ?? finalTotal).padStart(21),
    "Change: " + formatPrice(Math.max(0, (billData?.cashReceived ?? finalTotal) - finalTotal)).padStart(23),
    divider(),
    centerText("Thank You!"),
    centerText("Visit Again"),
    divider(),
    ""
  ].join("\n");

  // Use pre tag with 9px font for EC-58 printer
  billContent.innerHTML = `<pre style="font-family: 'Courier New', 'Consolas', monospace; font-size: 9px; line-height: 1.1; margin: 0; padding: 0; white-space: pre; overflow: hidden; width: 56mm; max-width: 56mm;">${receiptText}</pre>`;
}

let isFinalizingBill = false;
let _activeBillTotal = 0;   // set by openBillPreview, used by discount helpers
let _discountAmount  = 0;   // current discount in rupees

async function openBillPreview() {
  try {
    if (!currentOrderId) return;
    const ordersResponse = await window.electronAPI.getActiveOrders();
    if (!ordersResponse.success) {
      console.error("Failed to get active orders:", ordersResponse.error);
      return;
    }
    const activeOrders = ordersResponse.data;
    const cart = activeOrders[currentOrderId] || [];

    if (cart.length === 0) {
      showToast("Cart is empty!", "warning");
      return;
    }

    const billResponse = await window.electronAPI.getNextBillNumber();
    if (!billResponse.success) {
      console.error("Failed to get next bill number:", billResponse.error);
      return;
    }

    if (!Array.isArray(cart)) {
      console.error("Invalid cart data: cart is not an array");
      return;
    }

    // Restore last-used payment mode from localStorage
    const savedMode = localStorage.getItem("lastPaymentMode") || "Cash";
    const modeRadio = document.querySelector(`input[name="paymentMode"][value="${savedMode}"]`);
    if (modeRadio) modeRadio.checked = true;

    renderBillContent({
      billNo: billResponse.data,
      orderId: currentOrderId,
      time: new Date().toISOString(),
      items: cart,
      paymentMode: savedMode
    }, { isPreview: true });

    document.getElementById("billModal").style.display = "block";

    // Capture current cart total for discount calculations
    const totalEl = document.getElementById("total");
    _activeBillTotal = totalEl ? (parseFloat(totalEl.innerText) || 0) : 0;
    _resetDiscount();

    // Sync cash received row visibility and attach change listeners
    _syncCashReceivedRow();
    document.querySelectorAll('input[name="paymentMode"]').forEach(radio => {
      radio.onchange = _syncCashReceivedRow;
    });
  } catch (error) {
    console.error("openBillPreview error:", error);
    showToast("Failed to open bill preview", "error");
  }
}

function closeBillPreview() {
  const billModal = document.getElementById("billModal");
  if (!billModal) return; // DOM safety
  billModal.style.display = "none";
  // Reset discount state on close
  _resetDiscount();
  // Reset cash received field on close
  const cashInput = document.getElementById("cashReceivedInput");
  if (cashInput) cashInput.value = "";
  const changeDisplay = document.getElementById("changeDisplay");
  if (changeDisplay) { changeDisplay.textContent = ""; changeDisplay.className = "change-display"; }
}

// Show/hide cash received row depending on selected payment mode
function _syncCashReceivedRow() {
  const selectedMode = document.querySelector('input[name="paymentMode"]:checked')?.value || "Cash";
  const cashRow = document.getElementById("cashReceivedRow");
  if (cashRow) cashRow.style.display = selectedMode === "Cash" ? "flex" : "none";
  if (selectedMode !== "Cash") {
    const cashInput = document.getElementById("cashReceivedInput");
    if (cashInput) cashInput.value = "";
    const changeDisplay = document.getElementById("changeDisplay");
    if (changeDisplay) { changeDisplay.textContent = ""; changeDisplay.className = "change-display"; }
  }
}

// Called by oninput on cashReceivedInput
function updateChangeDisplay() {
  const totalEl = document.getElementById("total");
  const cashInput = document.getElementById("cashReceivedInput");
  const changeDisplay = document.getElementById("changeDisplay");
  if (!cashInput || !changeDisplay || !totalEl) return;

  const received = parseFloat(cashInput.value);
  const total = parseFloat(totalEl.innerText) || 0;

  if (isNaN(received) || cashInput.value === "") {
    changeDisplay.textContent = "";
    changeDisplay.className = "change-display";
    return;
  }

  const change = received - total;
  if (change >= 0) {
    changeDisplay.textContent = "Change: ₹" + change.toFixed(2);
    changeDisplay.className = "change-display";
  } else {
    changeDisplay.textContent = "Short by ₹" + Math.abs(change).toFixed(2);
    changeDisplay.className = "change-display insufficient";
  }
}

// ---- Discount helpers ----

function _resetDiscount() {
  _discountAmount = 0;
  document.querySelectorAll(".discount-btn").forEach(b => b.classList.remove("active"));
  const customRow = document.getElementById("discountCustomRow");
  if (customRow) customRow.style.display = "none";
  const discountDisplay = document.getElementById("discountDisplay");
  if (discountDisplay) discountDisplay.textContent = "";
}

function applyDiscount(type) {
  if (type === "0") {
    _resetDiscount();
    // Mark "None" as active
    document.querySelectorAll(".discount-btn").forEach(b => {
      b.classList.toggle("active", b.textContent.trim() === "None");
    });
    return;
  }

  if (type === "custom") {
    _discountAmount = 0;
    document.querySelectorAll(".discount-btn").forEach(b => b.classList.remove("active"));
    const btn = Array.from(document.querySelectorAll(".discount-btn")).find(b => b.textContent.trim() === "Custom");
    if (btn) btn.classList.add("active");
    const customRow = document.getElementById("discountCustomRow");
    if (customRow) { customRow.style.display = "block"; }
    const customInput = document.getElementById("discountCustomInput");
    if (customInput) { customInput.value = ""; customInput.focus(); }
    return;
  }

  const pct = parseInt(type, 10);
  if (isNaN(pct)) return;

  _discountAmount = Math.round(_activeBillTotal * pct / 100);

  document.querySelectorAll(".discount-btn").forEach(b => {
    b.classList.toggle("active", b.textContent.trim() === pct + "%");
  });
  const customRow = document.getElementById("discountCustomRow");
  if (customRow) customRow.style.display = "none";

  const discountDisplay = document.getElementById("discountDisplay");
  if (discountDisplay) {
    discountDisplay.textContent = _discountAmount > 0
      ? `Discount: -₹${_discountAmount.toFixed(2)} | Final: ₹${Math.max(0, _activeBillTotal - _discountAmount).toFixed(2)}`
      : "";
  }
}

function applyCustomDiscount() {
  const customInput = document.getElementById("discountCustomInput");
  if (!customInput) return;
  const val = parseFloat(customInput.value);
  _discountAmount = (!isNaN(val) && val >= 0) ? Math.min(val, _activeBillTotal) : 0;
  const discountDisplay = document.getElementById("discountDisplay");
  if (discountDisplay) {
    discountDisplay.textContent = _discountAmount > 0
      ? `Discount: -₹${_discountAmount.toFixed(2)} | Final: ₹${Math.max(0, _activeBillTotal - _discountAmount).toFixed(2)}`
      : "";
  }
}

// ---- end discount helpers ----

async function finalizeBill() {
  if (isFinalizingBill) {
    showToast("Bill is being processed, please wait...", "error");
    return;
  }
  isFinalizingBill = true;
  
  const finalizeBtn = document.querySelector('#billModal .primary-btn');
  if (finalizeBtn) finalizeBtn.disabled = true;

  try {
    if (!currentOrderId) {
      showToast("No order selected", "error");
      return;
    }
    
    const paymentModeRadio = document.querySelector('input[name="paymentMode"]:checked');
    if (!paymentModeRadio) {
      showToast("Please select a payment mode", "warning");
      if (finalizeBtn) finalizeBtn.disabled = false;
      return;
    }
    
    const paymentMode = paymentModeRadio.value;

    // Remember this payment mode for next bill
    try { localStorage.setItem("lastPaymentMode", paymentMode); } catch (_) {}

    const result = await window.electronAPI.finalizeBill( {
      orderId:        currentOrderId,
      paymentMode:    paymentMode,
      discountAmount: _discountAmount || 0,
    });
    
    if (!result || !result.success) {
      showToast(result?.error || "Bill finalization failed", "error");
      if (finalizeBtn) finalizeBtn.disabled = false;
      return;
    }
    
    const finalBill = result.data;
    if (finalBill && finalBill.billNo) {
      // Attach cash received for receipt rendering
      const cashInput = document.getElementById("cashReceivedInput");
      const cashReceived = cashInput && cashInput.value ? parseFloat(cashInput.value) : null;
      if (cashReceived !== null && !isNaN(cashReceived) && paymentMode === "Cash") {
        finalBill.cashReceived = cashReceived;
      }
      renderBillContent(finalBill);
      showToast(`Bill #${finalBill.billNo} finalized successfully!`);

      const autoPrint = localStorage.getItem("autoPrintAfterFinalize") === "true";

      if (autoPrint) {
        // Auto-print: skip confirmation dialog, print immediately
        closeBillPreview();
        currentOrderId = null;
        await updateTableStatus();
        await printBill(finalBill.billNo);
        showTableView();
      } else {
        // Show print confirmation dialog
        const printModalId = "printConfirmModal";
        let existingModal = document.getElementById(printModalId);
        if (existingModal) existingModal.remove();

        const printModal = document.createElement("div");
        printModal.id = printModalId;
        printModal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;";
        printModal.innerHTML = `
          <div style="background:white;padding:30px;border-radius:16px;text-align:center;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
            <h3 style="margin-bottom:10px;color:#3C2A21;">✅ Bill Finalized!</h3>
            <p style="color:#666;margin-bottom:8px;">Bill #${escapeHTML(finalBill.billNo)}</p>
            <p style="color:#E86A33;font-size:20px;font-weight:bold;margin-bottom:20px;">₹${(finalBill.total || 0).toFixed(2)}</p>
            <p style="color:#888;font-size:13px;margin-bottom:20px;">Payment: ${escapeHTML(paymentMode)}</p>
            <div style="display:flex;gap:12px;justify-content:center;">
              <button id="printReceiptBtn" style="padding:14px 28px;background:#4CAF50;color:white;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;">🖨️ Print Receipt</button>
              <button id="skipPrintBtn" style="padding:14px 28px;background:#e0d5c5;color:#333;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;">Skip</button>
            </div>
          </div>
        `;
        document.body.appendChild(printModal);

        document.getElementById("printReceiptBtn").onclick = async function() {
          const modalEl = document.getElementById(printModalId);
          if (modalEl) modalEl.remove();
          await printBill(finalBill.billNo);
          showTableView();
        };

        document.getElementById("skipPrintBtn").onclick = function() {
          const modalEl = document.getElementById(printModalId);
          if (modalEl) modalEl.remove();
          showTableView();
        };

        closeBillPreview();
        currentOrderId = null;
        await updateTableStatus();
      }
    } else {
      throw new Error("Invalid bill data received");
    }
  } catch (error) {
    console.error("finalizeBill error:", error);
    if (finalizeBtn) finalizeBtn.disabled = false;
    showToast("Failed to finalize bill. Please try again.", "error");
  } finally {
    isFinalizingBill = false;
    if (finalizeBtn) finalizeBtn.disabled = false;
  }
}

async function printBill(billNo) {
  const billContent = document.getElementById("billContent");
  const billModal = document.getElementById("billModal");
  if (!billContent) { showToast("Nothing to print", "error"); return; }
  if (billModal) billModal.style.display = "block";
  billContent.style.display = "block";
  // Small delay so the DOM fully renders before Chromium captures the print view
  await new Promise(resolve => setTimeout(resolve, 200));
  try {
    const result = await window.electronAPI.printReceipt();
    if (!result || !result.success) {
      if (result?.error === "cancelled") {
        // User closed the dialog intentionally — not an error, no toast needed
        return;
      }
      showToast("Print failed: " + (result?.error || "Unknown error"), "error");
    } else {
      showToast("Receipt printed!");
      if (billNo) {
        await window.electronAPI.markBillPrinted(billNo);
      }
    }
  } catch (error) {
    showToast("Print error: " + error.message, "error");
  }
}

async function deleteBill(billNo) {
  showConfirmModal("Are you sure you want to delete this bill?", async () => {
    try {
      const result = await window.electronAPI.deleteBill( billNo);
      const success = typeof result === "boolean" ? result : !!result?.success;
      if (success) {
        showToast("Bill deleted.");
      } else {
        showToast(result?.error || "Failed to delete bill.", "error");
      }
      const datePicker = document.getElementById("dashDatePicker");
      const _nd = new Date();
      const selectedDate = datePicker?.value || `${_nd.getFullYear()}-${String(_nd.getMonth()+1).padStart(2,"0")}-${String(_nd.getDate()).padStart(2,"0")}`;
      await loadDashboardForDate(selectedDate);
      await loadWeeklyChart();
      await loadCategories();
    } catch (error) {
      console.error("deleteBill error:", error);
      showToast("Failed to delete bill.", "error");
    }
  });
}
