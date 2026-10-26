// ================= BILL PREVIEW / RECEIPT =================

// Optimized for Everycom EC-58 58mm thermal printer (32 chars max per line)
const RECEIPT_WIDTH = 32;

// Item line: " 1. ItemName       x1    ₹50.00"
//   index 3 | space | name (14) | space | qty (3) | space | amount (9) = 32 chars.
// If an unusually long qty/amount needs more room, the name column shrinks so the
// line never exceeds 32 characters (the printer would cut the overflow off).
// qty may be a number (shown as "x2") or a column label such as "QTY".
function formatReceiptLine(index, name, qty, price) {
  const idxStr = index ? String(index).padStart(2) + "." : "   ";
  const qtyStr = (qty === "" || qty === null || qty === undefined) ? "" : (typeof qty === "number" ? "x" + qty : String(qty));
  const priceStr = price ? String(price) : "";
  const right = qtyStr.padEnd(3) + " " + priceStr.padStart(9);
  const nameWidth = Math.max(4, RECEIPT_WIDTH - idxStr.length - 2 - right.length);

  // Smart name truncation - if too long, truncate with ".."
  let nameStr = String(name ?? "");
  if (nameStr.length > nameWidth) nameStr = nameStr.substring(0, nameWidth - 2) + "..";
  return idxStr + " " + nameStr.padEnd(nameWidth) + " " + right;
}

// Column header that lines up with formatReceiptLine rows.
function receiptHeaderLine() {
  return formatReceiptLine("#", "ITEM", "QTY", "AMT");
}

// Helper to center text in 32 char width
function centerText(text, width = RECEIPT_WIDTH) {
  text = String(text ?? "");
  if (text.length >= width) return text.substring(0, width);
  const padding = Math.max(0, width - text.length);
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;
  return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
}

// Helper to create a divider line
function divider(char = '-') {
  return char.repeat(RECEIPT_WIDTH);
}

// Format currency with proper spacing
function formatPrice(amount) {
  return "₹" + (Number(amount) || 0).toFixed(2);
}

function _fitLine(text) {
  return text.length > RECEIPT_WIDTH ? text.substring(0, RECEIPT_WIDTH) : text;
}

// Puts receipt text into #billContent as plain text (never parsed as HTML, so
// product names like "Mac & Cheese <Large>" print exactly as typed).
function setReceiptText(text) {
  const billContent = document.getElementById("billContent");
  if (!billContent) return;
  const pre = document.createElement("pre");
  pre.className = "receipt-pre";
  pre.textContent = text;
  billContent.replaceChildren(pre);
}

function buildReceiptText(billData, { isPreview = false } = {}) {
  const items = Array.isArray(billData?.items) ? billData.items : [];
  const paymentMode = billData?.paymentMode || "Cash";
  const orderLabel = String(billData?.orderId || currentOrderId || "Walk-in");
  const billNo = String(billData?.billNo || "1");
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

    itemsText += formatReceiptLine(index + 1, item.name, quantity, formatPrice(itemTotal)) + "\n";

    // Add-on lines - compact format
    if (Array.isArray(item.addons) && item.addons.length > 0) {
      item.addons.forEach(addon => {
        itemsText += formatReceiptLine("", "+" + String(addon.name || "").substring(0, 12), "", formatPrice(addon.price || 0)) + "\n";
      });
    }
  });

  const rawTotal    = total;
  const discountAmt = typeof billData?.discountAmount === "number" ? billData.discountAmount : 0;
  const finalTotal  = typeof billData?.total === "number" ? billData.total : Math.max(0, rawTotal - discountAmt);
  const cashReceived = typeof billData?.cashReceived === "number" ? billData.cashReceived : finalTotal;

  // Cafe details from appSettings (set by loadSettings on startup).
  const cafeName  = (typeof appSettings !== "undefined" && appSettings.cafeName)  || "BLOOM CAFE";
  const cafePhone = (typeof appSettings !== "undefined" && appSettings.cafePhone) || "Ph: 9343761114";

  return [
    centerText(cafeName),
    centerText(cafePhone),
    divider(),
    isPreview ? centerText("Preview Receipt") : centerText("Receipt"),
    divider(),
    // Bill number gets its own line: "BC-YYYYMMDD-N" no longer pushes the line past 32 chars.
    _fitLine("Bill: " + billNo + (isPreview ? " (prev)" : "")),
    _fitLine("Date: " + dateStr + "  Time: " + timeStr),
    _fitLine("Table: " + orderLabel),
    divider(),
    receiptHeaderLine(),
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
    ...(paymentMode === "Cash" ? [
      "Received: " + formatPrice(cashReceived).padStart(21),
      "Change:   " + formatPrice(Math.max(0, cashReceived - finalTotal)).padStart(21),
    ] : []),
    divider(),
    centerText("Thank You!"),
    centerText("Visit Again"),
    divider(),
    ""
  ].join("\n");
}

function renderBillContent(billData, { isPreview = false } = {}) {
  setReceiptText(buildReceiptText(billData, { isPreview }));
}

// ================= CHECKOUT MODAL =================

let isFinalizingBill = false;
let _activeBillTotal = 0;   // cart subtotal of the bill being previewed
let _discountAmount  = 0;   // current discount in rupees
let _previewBill     = null; // { billNo, orderId, time, items } shown in the preview

function _selectedPaymentMode() {
  return document.querySelector('input[name="paymentMode"]:checked')?.value || "Cash";
}

function _grandTotal() {
  return Math.max(0, _activeBillTotal - (_discountAmount || 0));
}

function _enteredCash() {
  const el = document.getElementById("cashReceivedInput");
  const raw = el ? el.value.trim() : "";
  if (raw === "") return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

// Re-render the paper preview so it always matches what will print.
function _renderPreview() {
  if (!_previewBill) return;
  const mode = _selectedPaymentMode();
  const cash = mode === "Cash" ? _enteredCash() : null;
  renderBillContent({
    ..._previewBill,
    paymentMode: mode,
    discountAmount: _discountAmount || 0,
    ...(cash !== null ? { cashReceived: cash } : {}),
  }, { isPreview: true });
}

function _updateBillSummary() {
  const sub = document.getElementById("billSubtotal");
  const disc = document.getElementById("discountDisplay");
  const grand = document.getElementById("billGrandTotal");
  if (sub) sub.textContent = formatMoney(_activeBillTotal);
  if (disc) {
    disc.innerHTML = _discountAmount > 0
      ? `<span>Discount</span><span class="num">−${formatMoney(_discountAmount)}</span>`
      : "";
  }
  if (grand) grand.textContent = formatMoney(_grandTotal());
}

function _renderQuickCash() {
  const box = document.getElementById("quickCash");
  if (!box) return;
  const g = _grandTotal();
  if (_selectedPaymentMode() !== "Cash" || g <= 0) { box.replaceChildren(); return; }
  const values = [g];
  [50, 100, 500].forEach(step => values.push(Math.ceil(g / step) * step));
  [500, 1000, 2000].forEach(note => values.push(note));
  const unique = [...new Set(values.map(v => Math.round(v * 100) / 100))]
    .filter(v => v >= g)
    .sort((a, b) => a - b)
    .slice(0, 5);
  box.innerHTML = unique.map((v, i) =>
    `<button type="button" class="chip" data-cash="${v}">${i === 0 ? "Exact " : ""}${formatMoney(v, "auto")}</button>`
  ).join("");
}

async function openBillPreview() {
  try {
    if (!currentOrderId) return;
    if (isModalOpen("billModal")) return;
    const ordersResponse = await window.electronAPI.getActiveOrders();
    if (!ordersResponse.success) {
      console.error("Failed to get active orders:", ordersResponse.error);
      showToast("Could not load the order", "error");
      return;
    }
    const activeOrders = ordersResponse.data;
    const cart = activeOrders[currentOrderId] || [];

    if (!Array.isArray(cart)) {
      console.error("Invalid cart data: cart is not an array");
      return;
    }

    if (cart.length === 0) {
      showToast("Cart is empty! Add items first.", "warning");
      return;
    }

    const billResponse = await window.electronAPI.getNextBillNumber();
    if (!billResponse.success && !billResponse.data) {
      console.error("Failed to get next bill number:", billResponse.error);
      showToast("Could not prepare the bill", "error");
      return;
    }

    // Restore last-used payment mode
    let savedMode = "Cash";
    try { savedMode = localStorage.getItem("lastPaymentMode") || "Cash"; } catch (_) {}
    const modeRadio = document.querySelector(`input[name="paymentMode"][value="${savedMode}"]`)
      || document.querySelector('input[name="paymentMode"][value="Cash"]');
    if (modeRadio) modeRadio.checked = true;

    const { count, total } = cartTotals(cart);
    _activeBillTotal = total;
    _previewBill = {
      billNo: billResponse.data,
      orderId: currentOrderId,
      time: new Date().toISOString(),
      items: cart,
    };

    const label = document.getElementById("billOrderLabel");
    if (label) label.textContent = `${currentOrderId} · ${count} item${count !== 1 ? "s" : ""}`;

    _resetDiscount();
    const cashInput = document.getElementById("cashReceivedInput");
    if (cashInput) cashInput.value = "";
    _syncCashReceivedRow();
    _updateBillSummary();
    updateChangeDisplay();   // also renders the receipt preview

    const finalizeBtn = document.getElementById("finalizeBillBtn");
    if (finalizeBtn) finalizeBtn.disabled = false;

    openModal("billModal", { focus: _selectedPaymentMode() === "Cash" ? "#cashReceivedInput" : "#finalizeBillBtn" });
  } catch (error) {
    console.error("openBillPreview error:", error);
    showToast("Failed to open bill preview", "error");
  }
}

function closeBillPreview() {
  closeModal("billModal");
  // Reset discount / cash entry (the cart itself stays saved on the table).
  _resetDiscount();
  const cashInput = document.getElementById("cashReceivedInput");
  if (cashInput) cashInput.value = "";
  const changeDisplay = document.getElementById("changeDisplay");
  if (changeDisplay) { changeDisplay.textContent = ""; changeDisplay.className = "change-display"; }
  _previewBill = null;
}

// Show/hide cash received row depending on selected payment mode
function _syncCashReceivedRow() {
  const selectedMode = _selectedPaymentMode();
  const cashRow = document.getElementById("cashReceivedRow");
  if (cashRow) cashRow.style.display = selectedMode === "Cash" ? "flex" : "none";
  if (selectedMode !== "Cash") {
    const cashInput = document.getElementById("cashReceivedInput");
    if (cashInput) cashInput.value = "";
    const changeDisplay = document.getElementById("changeDisplay");
    if (changeDisplay) { changeDisplay.textContent = ""; changeDisplay.className = "change-display"; }
  }
  _renderQuickCash();
}

function _onPaymentModeChange() {
  _syncCashReceivedRow();
  updateChangeDisplay();
}

// Called by oninput on cashReceivedInput (and whenever the total changes)
function updateChangeDisplay() {
  const changeDisplay = document.getElementById("changeDisplay");
  const received = _selectedPaymentMode() === "Cash" ? _enteredCash() : null;

  if (changeDisplay) {
    if (received === null) {
      changeDisplay.textContent = "";
      changeDisplay.className = "change-display";
    } else {
      // Change is calculated on the discounted total.
      const change = received - _grandTotal();
      if (change >= 0) {
        changeDisplay.innerHTML = `<span>Change to return</span><span class="num">${formatMoney(change)}</span>`;
        changeDisplay.className = "change-display";
      } else {
        changeDisplay.innerHTML = `<span>Short by</span><span class="num">${formatMoney(Math.abs(change))}</span>`;
        changeDisplay.className = "change-display insufficient";
      }
    }
  }
  _renderPreview();
}

// ---- Discount helpers ----

function _setDiscountActive(key) {
  document.querySelectorAll(".discount-btn").forEach(b => b.classList.toggle("active", b.dataset.discount === key));
}

function _resetDiscount() {
  _discountAmount = 0;
  _setDiscountActive(null);
  const customRow = document.getElementById("discountCustomRow");
  if (customRow) customRow.style.display = "none";
  const customInput = document.getElementById("discountCustomInput");
  if (customInput) customInput.value = "";
  const discountDisplay = document.getElementById("discountDisplay");
  if (discountDisplay) discountDisplay.textContent = "";
}

function _afterDiscountChange() {
  _updateBillSummary();
  _renderQuickCash();
  updateChangeDisplay();
}

function applyDiscount(type) {
  if (type === "0") {
    _resetDiscount();
    _setDiscountActive("0");
    _afterDiscountChange();
    return;
  }

  if (type === "custom") {
    _discountAmount = 0;
    _setDiscountActive("custom");
    const customRow = document.getElementById("discountCustomRow");
    if (customRow) customRow.style.display = "flex";
    const customInput = document.getElementById("discountCustomInput");
    if (customInput) { customInput.value = ""; customInput.focus(); }
    _afterDiscountChange();
    return;
  }

  const pct = parseInt(type, 10);
  if (isNaN(pct)) return;

  _discountAmount = Math.round(_activeBillTotal * pct / 100);
  _setDiscountActive(String(pct));
  const customRow = document.getElementById("discountCustomRow");
  if (customRow) customRow.style.display = "none";
  _afterDiscountChange();
}

function applyCustomDiscount() {
  const customInput = document.getElementById("discountCustomInput");
  if (!customInput) return;
  const val = parseFloat(customInput.value);
  _discountAmount = (!isNaN(val) && val >= 0) ? Math.min(val, _activeBillTotal) : 0;
  _afterDiscountChange();
}

// ---- end discount helpers ----

async function finalizeBill() {
  if (isFinalizingBill) {
    showToast("Bill is being processed, please wait...", "warning");
    return;
  }
  isFinalizingBill = true;

  const finalizeBtn = document.getElementById("finalizeBillBtn");
  if (finalizeBtn) finalizeBtn.disabled = true;

  try {
    if (!currentOrderId) {
      showToast("No order selected", "error");
      return;
    }

    const paymentModeRadio = document.querySelector('input[name="paymentMode"]:checked');
    if (!paymentModeRadio) {
      showToast("Please select a payment mode", "warning");
      return;
    }

    const paymentMode = paymentModeRadio.value;

    // Remember this payment mode for next bill
    try { localStorage.setItem("lastPaymentMode", paymentMode); } catch (_) {}

    // Cash received (only relevant for Cash)
    const cashReceived = paymentMode === "Cash" ? _enteredCash() : null;

    // Short-payment guard: block finalization when entered cash < total
    if (cashReceived !== null) {
      const discountedTotal = _grandTotal();
      if (cashReceived < discountedTotal) {
        showToast(`Cash ${formatMoney(cashReceived)} is less than total ${formatMoney(discountedTotal)}`, "error");
        document.getElementById("cashReceivedInput")?.focus();
        return;
      }
    }

    const result = await window.electronAPI.finalizeBill({
      orderId:        currentOrderId,
      paymentMode:    paymentMode,
      discountAmount: _discountAmount || 0,
      cashReceived:   cashReceived,
    });

    if (!result || !result.success) {
      showToast(result?.error || "Bill finalization failed", "error");
      return;
    }

    const finalBill = result.data;
    if (!finalBill || !finalBill.billNo) throw new Error("Invalid bill data received");

    renderBillContent(finalBill);
    showToast(`Bill #${finalBill.billNo} finalized`);
    if (Array.isArray(finalBill.stockWarnings) && finalBill.stockWarnings.length) {
      const names = finalBill.stockWarnings.map(w => `${w.name} (short ${w.short})`).join(", ");
      setTimeout(() => showToast(`Stock count too low for: ${names}. Please update inventory.`, "warning"), 1500);
    }

    let autoPrint = false;
    try { autoPrint = localStorage.getItem("autoPrintAfterFinalize") === "true"; } catch (_) {}

    closeBillPreview();
    currentOrderId = null;
    await updateTableStatus();

    if (autoPrint) {
      // Auto-print: skip confirmation dialog, print immediately
      await printBill(finalBill.billNo);
      showTableView();
    } else {
      _showPrintConfirm(finalBill);
    }
  } catch (error) {
    console.error("finalizeBill error:", error);
    showToast("Failed to finalize bill. Please try again.", "error");
  } finally {
    isFinalizingBill = false;
    if (finalizeBtn) finalizeBtn.disabled = false;
  }
}

function _showPrintConfirm(finalBill) {
  const meta = document.getElementById("printConfirmMeta");
  const totalEl = document.getElementById("printConfirmTotal");
  const changeEl = document.getElementById("printConfirmChange");
  const printBtn = document.getElementById("printReceiptBtn");
  const skipBtn = document.getElementById("skipPrintBtn");
  if (!printBtn || !skipBtn) { showTableView(); return; }

  if (meta) meta.textContent = `Bill #${finalBill.billNo} · ${finalBill.paymentMode || "Cash"}`;
  if (totalEl) totalEl.textContent = formatMoney(finalBill.total || 0);
  if (changeEl) {
    const change = typeof finalBill.cashReceived === "number" ? finalBill.cashReceived - (finalBill.total || 0) : 0;
    changeEl.textContent = change > 0 ? `Change to return: ${formatMoney(change)}` : "";
  }

  const done = () => { closeModal("printConfirmModal"); showTableView(); };
  registerModal("printConfirmModal", done);   // Esc = Skip

  printBtn.disabled = false;
  printBtn.onclick = async () => {
    if (printBtn.disabled) return;
    printBtn.disabled = true;
    closeModal("printConfirmModal");
    await printBill(finalBill.billNo);
    showTableView();
  };
  skipBtn.onclick = done;

  openModal("printConfirmModal", { focus: "#printReceiptBtn" });
}

async function printBill(billNo) {
  const billContent = document.getElementById("billContent");
  const billModal = document.getElementById("billModal");
  if (!billContent || !billContent.textContent.trim()) { showToast("Nothing to print", "error"); return; }
  // Restore the modal to how we found it, so printing after finalize does not
  // leave a stale bill preview covering the table view.
  const modalWasVisible = isModalOpen(billModal);
  if (billModal && !modalWasVisible) billModal.style.display = "flex";
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
      showToast(result.printer ? `Receipt printed on ${result.printer}` : "Receipt printed!");
      if (billNo) {
        await window.electronAPI.markBillPrinted(billNo);
      }
    }
  } catch (error) {
    showToast("Print error: " + error.message, "error");
  } finally {
    if (billModal && !modalWasVisible) billModal.style.display = "none";
  }
}

async function deleteBill(billNo) {
  showConfirmModal(`Delete bill #${billNo}? Stock sold on this bill will be restored.`, async () => {
    try {
      const result = await window.electronAPI.deleteBill(billNo);
      const success = typeof result === "boolean" ? result : !!result?.success;
      if (success) {
        showToast("Bill deleted.");
      } else {
        showToast(result?.error || "Failed to delete bill.", "error");
      }
      const datePicker = document.getElementById("dashDatePicker");
      const selectedDate = datePicker?.value || todayStr();
      await loadDashboardForDate(selectedDate);
      await loadWeeklyChart();
      await loadCategories();
    } catch (error) {
      console.error("deleteBill error:", error);
      showToast("Failed to delete bill.", "error");
    }
  }, { confirmLabel: "Delete Bill", title: "Delete this bill?" });
}

// ---- one-time wiring ----
document.querySelectorAll('input[name="paymentMode"]').forEach(radio => {
  radio.addEventListener("change", _onPaymentModeChange);
});

const _quickCashBox = document.getElementById("quickCash");
if (_quickCashBox) {
  _quickCashBox.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cash]");
    if (!btn) return;
    const input = document.getElementById("cashReceivedInput");
    if (!input) return;
    input.value = btn.dataset.cash;
    updateChangeDisplay();
    document.getElementById("finalizeBillBtn")?.focus();
  });
}

registerModal("billModal", closeBillPreview);
