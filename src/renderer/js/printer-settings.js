// ================= PRINTER SETTINGS =================

let _savedPrinterName = "";

// Make sure the printer <select> has an option for `name` (e.g. a saved printer
// that is currently unplugged) so its value can be shown and saved.
function _ensurePrinterOption(name, label) {
  const select = document.getElementById("printerName");
  if (!select || !name) return;
  const exists = Array.from(select.options).some(o => o.value === name);
  if (!exists) appendOption(select, name, label || name);
}

function _setPrinterStatus(kind, text) {
  const card = document.getElementById("printerStatusCard");
  const statusEl = document.getElementById("printerDetectStatus");
  if (statusEl) statusEl.textContent = text;
  if (card) card.className = `status-card status-card-${kind}`;
}

async function loadPrinterSettings() {
  try {
    const response = await window.electronAPI.getPrinterConfig();
    if (!response.success) {
      console.error("Failed to load printer settings:", response.error);
      _setPrinterStatus("warn", "Could not load printer settings");
      return;
    }

    const config = response.data || {};
    const useThermalEl = document.getElementById("useThermalPrinting");
    const autoPrintEl = document.getElementById("autoPrintAfterFinalize");

    _savedPrinterName = config.printerName || "";
    if (useThermalEl) useThermalEl.checked = config.useThermalPrinting !== false;
    if (autoPrintEl) {
      try { autoPrintEl.checked = localStorage.getItem("autoPrintAfterFinalize") === "true"; } catch (_) { autoPrintEl.checked = false; }
    }
    await detectPrinters();
  } catch (error) {
    console.error("loadPrinterSettings error:", error);
  }
}

async function savePrinterSettings() {
  try {
    const printerNameEl = document.getElementById("printerName");
    const useThermalEl = document.getElementById("useThermalPrinting");
    const autoPrintEl = document.getElementById("autoPrintAfterFinalize");

    // Auto-print preference stored locally (no DB round-trip needed)
    try {
      localStorage.setItem("autoPrintAfterFinalize", autoPrintEl ? String(autoPrintEl.checked) : "false");
    } catch (_) {}

    const config = {
      printerName: printerNameEl ? printerNameEl.value.trim() : '',
      useThermalPrinting: useThermalEl ? useThermalEl.checked : false
    };

    const response = await window.electronAPI.savePrinterConfig(config);
    if (!response.success) {
      showToast("Failed to save printer settings: " + response.error, "error");
      return;
    }

    _savedPrinterName = config.printerName;
    showToast("Printer settings saved", "success");
    await detectPrinters();
  } catch (error) {
    console.error("savePrinterSettings error:", error);
    showToast("Failed to save printer settings", "error");
  }
}

async function testPrinter() {
  try {
    showToast("Sending test receipt…", "info");

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

    // Reuse the shared receipt helpers (centerText, divider, formatReceiptLine,
    // receiptHeaderLine, formatPrice) from bill.js so the test matches real bills.
    const lines = [
      centerText("BLOOM CAFE"),
      centerText("PRINTER DIAGNOSTIC"),
      divider("="),
      centerText("58mm Alignment Test"),
      divider(),
      "Date: " + dateStr + "  Time: " + timeStr,
      divider(),
      // Column header — must align with data rows below
      receiptHeaderLine(),
      divider(),
      // Short name — baseline
      formatReceiptLine(1, "Espresso", 1, formatPrice(80)),
      // Long name — triggers truncation with ".."
      formatReceiptLine(2, "Caramel Macchiato Latte", 2, formatPrice(320)),
      // Addon row — indented with "+"
      formatReceiptLine("", "+Extra Shot", "", formatPrice(30)),
      // Two-digit qty and 5-digit amount — widest normal line
      formatReceiptLine(3, "Party Platter", 10, formatPrice(12500)),
      // Rupee symbol rendering
      formatReceiptLine(4, "₹ Symbol OK", 1, formatPrice(1)),
      divider(),
      "Items: 14   Total: " + formatPrice(12931).padStart(11),
      divider(),
      centerText("-- Alignment Check --"),
      // Ruler: exactly 32 columns
      "0        1         2         3  ",
      "12345678901234567890123456789012",
      divider(),
      centerText("If columns are straight,"),
      centerText("printer is configured correctly."),
      divider("="),
      centerText("DIAGNOSTIC COMPLETE"),
      divider("="),
      ""
    ];

    const billContent = document.getElementById("billContent");
    if (!billContent) {
      showToast("Bill content area not found", "error");
      return;
    }

    setReceiptText(lines.join("\n"));

    // Show bill modal so Chromium renders it before print capture
    const billModal = document.getElementById("billModal");
    if (billModal) billModal.style.display = "flex";

    await new Promise(resolve => setTimeout(resolve, 200));

    const result = await window.electronAPI.printReceipt();
    if (!result || !result.success) {
      if (result?.error === "cancelled") {
        // User closed dialog — not an error
      } else {
        showToast("Printer test failed: " + (result?.error || "Unknown error"), "error");
      }
    } else {
      showToast(result.printer ? `Test receipt sent to ${result.printer}` : "Test receipt sent to printer", "success");
    }

    // Hide modal and clear content
    if (billModal) billModal.style.display = "none";
    setTimeout(() => { if (billContent) billContent.replaceChildren(); }, 500);
    await detectPrinters();
  } catch (error) {
    console.error("testPrinter error:", error);
    showToast("Printer test failed: " + error.message, "error");
  }
}

// Fills the printer dropdown from the OS and shows which one will be used.
async function detectPrinters() {
  const select = document.getElementById("printerName");
  const btn = document.getElementById("detectPrinterBtn");
  try {
    if (!window.electronAPI.listPrinters) return;
    if (btn) btn.disabled = true;
    _setPrinterStatus("pending", "Detecting printers…");
    const response = await window.electronAPI.listPrinters();
    if (!response || !response.success) {
      _setPrinterStatus("warn", "Could not list printers — the print dialog will be shown");
      return;
    }
    const { printers = [], detected } = response.data || {};

    if (select) {
      const keep = select.value || _savedPrinterName;
      select.replaceChildren();
      appendOption(select, "", "Auto-detect (recommended)");
      printers.forEach(p => {
        appendOption(select, p.name, (p.displayName || p.name) + (p.isDefault ? " (system default)" : ""));
      });
      if (_savedPrinterName && !printers.some(p => p.name === _savedPrinterName)) {
        _ensurePrinterOption(_savedPrinterName, `${_savedPrinterName} (saved, not connected)`);
      }
      select.value = Array.from(select.options).some(o => o.value === keep) ? keep : "";
    }

    if (detected && detected.name) {
      const how = detected.reason === "saved" ? "saved choice"
        : detected.reason === "thermal" ? "auto-detected receipt printer"
        : detected.reason === "default" ? "system default"
        : "auto-detected";
      _setPrinterStatus("ok", `Will print to: ${detected.name} (${how})`);
    } else {
      _setPrinterStatus("warn", printers.length
        ? "No receipt printer found — the print dialog will be shown"
        : "No printer found — the print dialog will be shown");
    }
  } catch (error) {
    console.error("detectPrinters error:", error);
    _setPrinterStatus("warn", "Could not list printers");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openPrinterSettings() {
  openModal("printerModal", { focus: "#printerName" });
  loadPrinterSettings();
}

function closePrinterSettings() {
  closeModal("printerModal");
}

registerModal("printerModal", closePrinterSettings);
