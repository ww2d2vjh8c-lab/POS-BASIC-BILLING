// ================= PRINTER SETTINGS =================

async function loadPrinterSettings() {
  try {
    const response = await window.electronAPI.getPrinterConfig();
    if (!response.success) {
      console.error("Failed to load printer settings:", response.error);
      return;
    }
    
    const config = response.data;
    const printerNameEl = document.getElementById("printerName");
    const useThermalEl = document.getElementById("useThermalPrinting");
    const autoPrintEl = document.getElementById("autoPrintAfterFinalize");

    if (printerNameEl) printerNameEl.value = config.printerName || '';
    if (useThermalEl) useThermalEl.checked = config.useThermalPrinting !== false;
    if (autoPrintEl) {
      autoPrintEl.checked = localStorage.getItem("autoPrintAfterFinalize") === "true";
    }
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
    
    showToast("Printer settings saved successfully!", "success");
  } catch (error) {
    console.error("savePrinterSettings error:", error);
    showToast("Failed to save printer settings", "error");
  }
}

async function testPrinter() {
  try {
    showToast("Testing printer... Please wait.", "info");

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

    // Reuse the shared receipt helpers (centerText, divider, formatReceiptLine, formatPrice)
    // These are defined in bill.js and available globally in the renderer.
    const lines = [
      centerText("BLOOM CAFE"),
      centerText("PRINTER DIAGNOSTIC"),
      divider("="),
      centerText("58mm Alignment Test"),
      divider(),
      "Date: " + dateStr + "  Time: " + timeStr,
      divider(),
      // Column header — must align with data rows below
      formatReceiptLine("#", "ITEM", "QTY", "AMT"),
      divider(),
      // Short name — baseline
      formatReceiptLine(1, "Espresso", 1, formatPrice(80)),
      // Long name — triggers 12-char truncation with ".."
      formatReceiptLine(2, "Caramel Macchiato Latte", 2, formatPrice(320)),
      // Addon row — indented with "+"
      formatReceiptLine("", "+Extra Shot", "", formatPrice(30)),
      // Price stress — 5-digit amount tests padStart(10) field
      formatReceiptLine(3, "Party Platter", 10, formatPrice(12500)),
      // Rupee symbol rendering
      formatReceiptLine(4, "\u20B9 Symbol OK", 1, formatPrice(1)),
      divider(),
      "Items:  4   Total: " + formatPrice(12931).padStart(11),
      divider(),
      centerText("-- Alignment Check --"),
      // Ruler: verify each character column
      "0        1         2         3 ",
      "123456789012345678901234567890123",
      divider(),
      centerText("If columns are straight,"),
      centerText("printer is configured correctly."),
      divider("="),
      centerText("DIAGNOSTIC COMPLETE"),
      divider("="),
      ""
    ];

    const testContent = lines.join("\n");

    const billContent = document.getElementById("billContent");
    if (!billContent) {
      showToast("Bill content area not found", "error");
      return;
    }

    billContent.innerHTML = `<pre style="font-family: 'Courier New', 'Consolas', monospace; font-size: 9px; line-height: 1.1; margin: 0; padding: 0; white-space: pre; overflow: hidden; width: 56mm; max-width: 56mm;">${testContent}</pre>`;

    // Show bill modal so Chromium renders it before print capture
    const billModal = document.getElementById("billModal");
    if (billModal) billModal.style.display = "block";

    await new Promise(resolve => setTimeout(resolve, 200));

    const result = await window.electronAPI.printReceipt();
    if (!result || !result.success) {
      if (result?.error === "cancelled") {
        // User closed dialog — not an error
      } else {
        showToast("Printer test failed: " + (result?.error || "Unknown error"), "error");
      }
    } else {
      showToast("Diagnostic receipt sent to printer!", "success");
    }

    // Hide modal and clear content
    if (billModal) billModal.style.display = "none";
    setTimeout(() => { if (billContent) billContent.innerHTML = ""; }, 500);

  } catch (error) {
    console.error("testPrinter error:", error);
    showToast("Printer test failed: " + error.message, "error");
  }
}

function openPrinterSettings() {
  const modal = document.getElementById('printerModal');
  if (modal) modal.style.display = 'block';
  loadPrinterSettings();
}

function closePrinterSettings() {
  const modal = document.getElementById('printerModal');
  if (modal) modal.style.display = 'none';
}
