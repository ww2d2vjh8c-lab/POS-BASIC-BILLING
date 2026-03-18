// ================= DASHBOARD =================

let _dashCurrentDate  = null;
let _dashChartMode    = 'week'; // 'week' | 'hour'
let _dashExportOpen   = false;

function _getTodayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

async function openDashboard() {
  const modal = document.getElementById("dashboardModal");
  if (!modal) return;
  modal.style.display = "block";

  const today = _getTodayStr();
  _dashCurrentDate = today;
  _dashChartMode   = 'week';

  const datePicker = document.getElementById("dashDatePicker");
  if (datePicker) datePicker.value = today;

  await loadDashboardForDate(today);
  await loadWeeklyChart();
}

async function loadDashboardForDate(dateStr) {
  if (!dateStr) return;
  _dashCurrentDate = dateStr;

  // Update next-button disabled state
  const nextBtn = document.getElementById("dashNextBtn");
  if (nextBtn) nextBtn.disabled = dateStr >= _getTodayStr();

  // Update subtitle
  const subtitle = document.getElementById("dashSubtitle");
  const today = _getTodayStr();
  const isToday = dateStr === today;
  if (subtitle) subtitle.textContent = isToday ? "Today's Overview" : `Overview for ${formatDisplayDate(dateStr)}`;

  // Live strip — only meaningful when viewing today
  _updateLiveStrip(dateStr);

  try {
    // Fetch current day + previous day in parallel for delta
    const prevDate = _getPrevDateStr(dateStr);
    const [response, prevResponse] = await Promise.all([
      window.electronAPI.getSalesData(dateStr),
      window.electronAPI.getSalesData(prevDate),
    ]);

    const salesData = (response.success && response.data) ? response.data : { totalRevenue: 0, totalBills: 0, bills: [] };
    const prevData  = (prevResponse.success && prevResponse.data) ? prevResponse.data : null;

    // Stat values
    const revenue = salesData.totalRevenue || 0;
    const bills   = salesData.totalBills || salesData.bills?.length || 0;
    const avgBill = bills > 0 ? revenue / bills : 0;
    let totalItems = 0;
    (salesData.bills || []).forEach(bill => {
      (bill.items || []).forEach(item => { totalItems += (item.quantity || 1); });
    });

    // Update stat card values
    const dashTotalRevenue = document.getElementById("dashTotalRevenue");
    const dashTotalBills   = document.getElementById("dashTotalBills");
    const dashAvgBill      = document.getElementById("dashAvgBill");
    const dashItemsSold    = document.getElementById("dashItemsSold");
    if (dashTotalRevenue) dashTotalRevenue.textContent = "₹" + revenue.toFixed(0);
    if (dashTotalBills)   dashTotalBills.textContent   = String(bills);
    if (dashAvgBill)      dashAvgBill.textContent      = "₹" + avgBill.toFixed(0);
    if (dashItemsSold)    dashItemsSold.textContent    = String(totalItems);

    // Delta indicators
    if (prevData) {
      const pRev   = prevData.totalRevenue || 0;
      const pBills = prevData.totalBills || prevData.bills?.length || 0;
      const pAvg   = pBills > 0 ? pRev / pBills : 0;
      let pItems   = 0;
      (prevData.bills || []).forEach(b => {
        (b.items || []).forEach(i => { pItems += (i.quantity || 1); });
      });
      _renderDelta("dashRevenueDelta", revenue, pRev, true);
      _renderDelta("dashBillsDelta",   bills,   pBills, false);
      _renderDelta("dashAvgDelta",     avgBill, pAvg, true);
      _renderDelta("dashItemsDelta",   totalItems, pItems, false);
    } else {
      ["dashRevenueDelta","dashBillsDelta","dashAvgDelta","dashItemsDelta"].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = ""; el.className = "dash-card-delta"; }
      });
    }

    renderPaymentBreakdown(salesData.bills || []);
    renderTopItems(salesData.bills || []);
    renderBillsList(salesData.bills || []);
    await renderCategoryRevenue(dateStr);
    await renderInventoryHealth();
    await checkAndShowHealth();

  } catch (error) {
    showToast("Failed to load dashboard data", "error");
  }
}

function _getPrevDateStr(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function _renderDelta(elId, current, prev, isRevenue) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (prev == null) { el.textContent = ""; el.className = "dash-card-delta"; return; }
  const diff = current - prev;
  if (Math.abs(diff) < 0.5) {
    el.textContent = "Same as yesterday";
    el.className = "dash-card-delta flat";
    return;
  }
  const pct = prev > 0 ? Math.round(Math.abs(diff / prev) * 100) : null;
  const sign = diff > 0 ? "↑" : "↓";
  const cls  = diff > 0 ? "up" : "down";
  const valStr = isRevenue ? "₹" + Math.abs(diff).toFixed(0) : Math.abs(diff).toFixed(0);
  el.textContent = `${sign}${valStr}${pct != null ? " (" + pct + "%)" : ""} vs yesterday`;
  el.className = "dash-card-delta " + cls;
}

async function _updateLiveStrip(dateStr) {
  const strip = document.getElementById("dashLiveStrip");
  if (!strip) return;
  if (dateStr !== _getTodayStr()) { strip.classList.add("hidden"); return; }
  try {
    const resp = await window.electronAPI.getActiveOrders();
    if (!resp.success) { strip.classList.add("hidden"); return; }
    const count = Object.keys(resp.data || {}).length;
    strip.classList.remove("hidden");
    strip.innerHTML = count > 0
      ? `🟢 <strong>${count}</strong> table${count !== 1 ? "s" : ""} active right now`
      : `⚪ All tables currently free`;
  } catch (e) { strip.classList.add("hidden"); }
}

// ── Date navigation ──────────────────────────────────────────

async function dashNavigateDate(direction) {
  if (!_dashCurrentDate) return;
  const d = new Date(_dashCurrentDate + "T12:00:00");
  d.setDate(d.getDate() + direction);
  const newDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  if (newDate > _getTodayStr()) return;
  _dashCurrentDate = newDate;
  const datePicker = document.getElementById("dashDatePicker");
  if (datePicker) datePicker.value = newDate;
  await loadDashboardForDate(newDate);
  if (newDate === _getTodayStr()) await loadWeeklyChart();
}

async function dashGoToday() {
  const today = _getTodayStr();
  _dashCurrentDate = today;
  const datePicker = document.getElementById("dashDatePicker");
  if (datePicker) datePicker.value = today;
  await loadDashboardForDate(today);
  await loadWeeklyChart();
}

// ── Panels ───────────────────────────────────────────────────

function renderPaymentBreakdown(bills) {
  const container = document.getElementById("dashPaymentBreakdown");
  if (!container) return;

  const breakdown = {};
  let total = 0;
  bills.forEach(bill => {
    const mode = bill.paymentMode || bill.payment || "Cash";
    breakdown[mode] = (breakdown[mode] || 0) + (bill.total || 0);
    total += (bill.total || 0);
  });

  if (Object.keys(breakdown).length === 0) {
    container.innerHTML = '<div class="dash-empty">No transactions yet</div>';
    return;
  }

  const colors = { Cash: "#4CAF50", UPI: "#2196F3", Card: "#9C27B0", Other: "#FF9800" };
  container.innerHTML = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([mode, amount]) => {
      const pct   = total > 0 ? ((amount / total) * 100).toFixed(0) : 0;
      const color = colors[mode] || "#888";
      return `
        <div class="dash-payment-row">
          <div class="dash-payment-dot" style="background:${color}"></div>
          <span class="dash-payment-mode">${escapeHTML(mode)}</span>
          <div class="dash-payment-bar-wrap">
            <div class="dash-payment-bar" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="dash-payment-amount">₹${amount.toFixed(0)}</span>
          <span class="dash-payment-pct">${pct}%</span>
        </div>`;
    }).join("");
}

function renderTopItems(bills) {
  const container = document.getElementById("dashTopItems");
  if (!container) return;

  const itemMap = {};
  bills.forEach(bill => {
    (bill.items || []).forEach(item => {
      const baseName = (item.name || "").replace(/\s*\((Half|Full)\)\s*$/i, "").trim();
      if (!itemMap[baseName]) itemMap[baseName] = { qty: 0, revenue: 0 };
      itemMap[baseName].qty += (item.quantity || 1);
      const addonTotal = (item.addons || []).reduce((s, a) => s + (a.price || 0), 0);
      itemMap[baseName].revenue += ((item.price || 0) + addonTotal) * (item.quantity || 1);
    });
  });

  const sorted = Object.entries(itemMap).sort((a, b) => b[1].qty - a[1].qty).slice(0, 6);
  if (sorted.length === 0) {
    container.innerHTML = '<div class="dash-empty">No items sold yet</div>';
    return;
  }

  const maxQty  = sorted[0][1].qty;
  const medals  = ["🥇", "🥈", "🥉"];
  container.innerHTML = sorted.map(([name, data], i) => {
    const barWidth = maxQty > 0 ? (data.qty / maxQty * 100).toFixed(0) : 0;
    return `
      <div class="dash-top-item-row">
        <span class="dash-top-medal">${medals[i] || "  "}</span>
        <span class="dash-top-name">${escapeHTML(name)}</span>
        <div class="dash-top-bar-wrap">
          <div class="dash-top-bar" style="width:${barWidth}%"></div>
        </div>
        <span class="dash-top-qty">${data.qty}x</span>
        <span class="dash-top-rev">₹${data.revenue.toFixed(0)}</span>
      </div>`;
  }).join("");
}

function renderBillsList(bills) {
  const container = document.getElementById("dashBillsList");
  if (!container) return;

  if (bills.length === 0) {
    container.innerHTML = '<div class="dash-empty">No bills found</div>';
    return;
  }

  // Show most-recent bills first
  const sorted = [...bills].sort((a, b) => {
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return tb - ta;
  });

  const badgeCls = { Cash: "dash-bill-badge-cash", UPI: "dash-bill-badge-upi", Card: "dash-bill-badge-card" };

  container.innerHTML = sorted.map(bill => {
    const time    = bill.time ? new Date(bill.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
    const cls     = badgeCls[bill.paymentMode] || "dash-bill-badge-other";
    const billNo  = escapeHTML(String(bill.billNo || ""));
    const orderId = escapeHTML(bill.orderId || "");
    const mode    = escapeHTML(bill.paymentMode || "Cash");
    return `
      <div class="dash-bill-row">
        <span class="dash-bill-no">#${billNo}</span>
        <span class="dash-bill-time">${escapeHTML(time)}</span>
        <span class="dash-bill-table">${orderId}</span>
        <span class="dash-bill-badge ${cls}">${mode}</span>
        <span class="dash-bill-amount">₹${(bill.total || 0).toFixed(0)}</span>
        <div class="dash-bill-actions">
          <button class="dash-bill-btn dash-bill-reprint" onclick="reprintBill('${billNo}')" title="Reprint">🖨️</button>
          <button class="dash-bill-btn dash-bill-delete"  onclick="deleteBill('${billNo}')"  title="Delete">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

async function reprintBill(billNo) {
  try {
    const dateStr  = _dashCurrentDate || _getTodayStr();
    const response = await window.electronAPI.getSalesData(dateStr);
    if (!response.success) return showToast("Could not load bill", "error");
    const bill = response.data.bills.find(b => b.billNo === billNo);
    if (!bill) return showToast("Bill not found", "error");
    renderBillContent(bill);
    const billModal = document.getElementById("billModal");
    if (billModal) billModal.style.display = "block";
    await printBill(billNo);
  } catch (e) {
    showToast("Reprint failed: " + e.message, "error");
  }
}

async function checkAndShowHealth() {
  try {
    const response = await window.electronAPI.getHealthStatus();
    if (!response.success) return;
    const health = response.data;
    if (!health.database) showToast("⚠️ Database integrity issue. Please backup immediately.", "error");
    if (!health.diskSpace) showToast(`⚠️ Low disk space (${health.freeMB}MB free).`, "warning");
  } catch (e) {}
}

async function loadWeeklyChart() {
  const chartDiv  = document.getElementById("weeklyChart");
  const labelsDiv = document.getElementById("weeklyChartLabels");
  if (!chartDiv || !labelsDiv) return;

  try {
    const response = await window.electronAPI.getWeeklyRevenue();
    const weekData = (response.success && Array.isArray(response.data)) ? response.data : [];
    const revenues = weekData.map(d => d.revenue || 0);
    const days     = weekData.map(d => d.date);
    const maxRev   = Math.max(...revenues, 1);

    chartDiv.innerHTML = revenues.map((rev, i) => {
      const heightPct = ((rev / maxRev) * 100).toFixed(0);
      const isToday   = i === revenues.length - 1;
      return `
        <div class="dash-bar-wrap" title="₹${rev.toFixed(0)}">
          <span class="dash-bar-value">${rev > 0 ? "₹" + (rev >= 1000 ? (rev/1000).toFixed(1)+"k" : rev.toFixed(0)) : ""}</span>
          <div class="dash-bar ${isToday ? "dash-bar-today" : ""}" style="height:${heightPct}%"></div>
        </div>`;
    }).join("");

    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    labelsDiv.innerHTML = days.map((d, i) => {
      const name    = dayNames[new Date(d + "T00:00:00").getDay()];
      const isToday = i === days.length - 1;
      return `<span class="dash-chart-label ${isToday ? "dash-label-today" : ""}">${isToday ? "Today" : name}</span>`;
    }).join("");
  } catch (error) {
    console.error("loadWeeklyChart error:", error);
  }
}

// ── Export dropdown ───────────────────────────────────────────────────────────

function toggleExportMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('dashExportMenu');
  if (!menu) return;
  _dashExportOpen = !_dashExportOpen;
  menu.style.display = _dashExportOpen ? 'block' : 'none';
  if (_dashExportOpen) {
    // Close when clicking outside
    const close = () => {
      _dashExportOpen = false;
      menu.style.display = 'none';
      document.removeEventListener('click', close);
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

async function exportDashboardData(type) {
  // Close dropdown
  const menu = document.getElementById('dashExportMenu');
  if (menu) menu.style.display = 'none';
  _dashExportOpen = false;

  const dateStr = _dashCurrentDate || _getTodayStr();

  try {
    if (type === 'sales' || !type) {
      // ── Sales Report (original behaviour) ──────────────────
      const response = await window.electronAPI.getSalesData(dateStr);
      if (!response.success || !response.data) { showToast("No data to export", "error"); return; }
      const bills = response.data.bills || [];
      let csv = "Bill No,Time,Table,Items,Total,Payment\n";
      bills.forEach(bill => {
        const itemNames = (bill.items || []).map(i => `${i.name} x${i.quantity || 1}`).join(" | ");
        let time = "";
        if (bill.time) {
          const t = new Date(bill.time);
          time = isNaN(t.getTime()) ? bill.time : t.toLocaleTimeString("en-IN");
        }
        csv += `"${bill.billNo || ""}","${time}","${bill.orderId || ""}","${itemNames}","${(bill.total || 0).toFixed(2)}","${bill.paymentMode || "Cash"}"\n`;
      });
      _downloadCSV(csv, `bloom-cafe-sales-${dateStr}.csv`);

    } else if (type === 'inventory') {
      // ── Inventory Snapshot ──────────────────────────────────
      const response = await window.electronAPI.getInventory();
      if (!response.success || !response.data) { showToast("No inventory data", "error"); return; }
      const items = response.data.items || [];
      let csv = "Item Name,Stock,Low Stock Alert,Status\n";
      items.forEach(i => {
        const status = i.stock <= 0 ? "Out of Stock"
          : i.stock <= i.lowStock ? "Low Stock"
          : "In Stock";
        csv += `"${i.name}","${i.stock}","${i.lowStock}","${status}"\n`;
      });
      _downloadCSV(csv, `bloom-cafe-inventory-${dateStr}.csv`);

    } else if (type === 'combined') {
      // ── Combined: top items sold + remaining stock ──────────
      const [salesRes, invRes] = await Promise.all([
        window.electronAPI.getSalesData(dateStr),
        window.electronAPI.getInventory(),
      ]);
      if (!salesRes.success) { showToast("No sales data", "error"); return; }
      const bills  = salesRes.data?.bills || [];
      const invMap = {};
      (invRes.data?.items || []).forEach(i => { invMap[i.name.toLowerCase()] = i.stock; });

      const itemMap = {};
      bills.forEach(bill => {
        (bill.items || []).forEach(item => {
          const base = (item.name || "").replace(/\s*\((Half|Full)\)\s*$/i, "").trim();
          if (!itemMap[base]) itemMap[base] = { qty: 0, revenue: 0 };
          itemMap[base].qty     += (item.quantity || 1);
          const addon = (item.addons || []).reduce((s, a) => s + (a.price || 0), 0);
          itemMap[base].revenue += ((item.price || 0) + addon) * (item.quantity || 1);
        });
      });

      let csv = "Item,Qty Sold,Revenue,Remaining Stock\n";
      Object.entries(itemMap)
        .sort((a, b) => b[1].qty - a[1].qty)
        .forEach(([name, data]) => {
          const stock = invMap[name.toLowerCase()] ?? "—";
          csv += `"${name}","${data.qty}","${data.revenue.toFixed(2)}","${stock}"\n`;
        });
      _downloadCSV(csv, `bloom-cafe-combined-${dateStr}.csv`);
    }

    showToast("Exported successfully!");
  } catch (e) {
    console.error("exportDashboardData error:", e);
    showToast("Export failed", "error");
  }
}

function _downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function closeDashboard() {
  document.getElementById("dashboardModal").style.display = "none";
}

// ── Category revenue panel ────────────────────────────────────────────────────

async function renderCategoryRevenue(dateStr) {
  const container = document.getElementById("dashCategoryRevenue");
  if (!container) return;

  try {
    const res = await window.electronAPI.getDashboardAnalytics(dateStr || _dashCurrentDate || _getTodayStr());
    if (!res.success || !res.data?.salesByCategory?.length) {
      container.innerHTML = '<div class="dash-empty">No category data yet</div>';
      return;
    }

    const categories = res.data.salesByCategory;
    const total = categories.reduce((s, c) => s + (c.revenue || 0), 0);
    const palette = ["#c17f24","#2196F3","#4CAF50","#9C27B0","#FF9800","#F44336","#00BCD4"];

    container.innerHTML = categories
      .sort((a, b) => b.revenue - a.revenue)
      .map((cat, i) => {
        const pct   = total > 0 ? ((cat.revenue / total) * 100).toFixed(0) : 0;
        const color = palette[i % palette.length];
        return `
          <div class="dash-category-row">
            <div class="dash-payment-dot" style="background:${color}"></div>
            <span class="dash-payment-mode">${escapeHTML(cat.name)}</span>
            <div class="dash-payment-bar-wrap">
              <div class="dash-payment-bar" style="width:${pct}%;background:${color}"></div>
            </div>
            <span class="dash-payment-amount">₹${(cat.revenue || 0).toFixed(0)}</span>
            <span class="dash-payment-pct">${pct}%</span>
          </div>`;
      }).join('');
  } catch (e) {
    console.error("renderCategoryRevenue error:", e);
    container.innerHTML = '<div class="dash-empty">Failed to load</div>';
  }
}

// ── Inventory health panel ────────────────────────────────────────────────────

async function renderInventoryHealth() {
  const lowListEl  = document.getElementById("dashInvLowList");
  const outListEl  = document.getElementById("dashInvOutList");
  const outCardEl  = document.getElementById("dashOutOfStock");
  if (!lowListEl && !outListEl) return;

  try {
    const res = await window.electronAPI.getInventoryHealth();
    if (!res.success) return;

    const { lowStock, outOfStock } = res.data;

    // Update 5th stat card
    if (outCardEl) outCardEl.textContent = String(outOfStock.length);

    // Low stock list
    if (lowListEl) {
      lowListEl.innerHTML = lowStock.length === 0
        ? '<div class="dash-inv-ok">All items well stocked ✅</div>'
        : lowStock.map(i => `
            <div class="dash-inv-row">
              <span class="dash-inv-name">${escapeHTML(i.name)}</span>
              <span class="dash-stock-badge dash-stock-low">${i.stock}</span>
            </div>`).join('');
    }

    // Out of stock list
    if (outListEl) {
      outListEl.innerHTML = outOfStock.length === 0
        ? '<div class="dash-inv-ok">No items out of stock ✅</div>'
        : outOfStock.map(i => `
            <div class="dash-inv-row">
              <span class="dash-inv-name">${escapeHTML(i.name)}</span>
              <span class="dash-stock-badge dash-stock-out">Out of stock 🔴</span>
            </div>`).join('');
    }
  } catch (e) {
    console.error("renderInventoryHealth error:", e);
  }
}

// ── Hourly chart toggle ───────────────────────────────────────────────────────

async function switchDashChart(mode, btn) {
  _dashChartMode = mode;
  document.querySelectorAll('.dash-toggle-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (mode === 'week') {
    await loadWeeklyChart();
  } else {
    await loadHourlyChart();
  }
}

async function loadHourlyChart() {
  const chartDiv  = document.getElementById("weeklyChart");
  const labelsDiv = document.getElementById("weeklyChartLabels");
  if (!chartDiv || !labelsDiv) return;

  try {
    const today = _dashCurrentDate || _getTodayStr();
    const res   = await window.electronAPI.getDashboardAnalytics(today);
    if (!res.success) return;

    const salesByHour = res.data?.salesByHour || Array(24).fill(0);
    const currentHour = new Date().getHours();

    // Find first and last non-zero hours (at least show 7am–10pm)
    let firstH = 7, lastH = 22;
    salesByHour.forEach((v, h) => { if (v > 0) { firstH = Math.min(firstH, h); lastH = Math.max(lastH, h); } });
    firstH = Math.max(0, firstH - 1);
    lastH  = Math.min(23, lastH + 1);

    const visibleHours   = salesByHour.slice(firstH, lastH + 1);
    const maxHourRevenue = Math.max(...visibleHours, 1);

    chartDiv.innerHTML = visibleHours.map((rev, i) => {
      const h          = firstH + i;
      const heightPct  = ((rev / maxHourRevenue) * 100).toFixed(0);
      const isCurrent  = h === currentHour;
      return `
        <div class="dash-bar-wrap" title="${h}:00 — ₹${rev.toFixed(0)}">
          <span class="dash-bar-value">${rev > 0 ? "₹" + (rev >= 1000 ? (rev/1000).toFixed(1) + "k" : rev.toFixed(0)) : ""}</span>
          <div class="dash-bar ${isCurrent ? "dash-bar-today" : ""}" style="height:${heightPct}%"></div>
        </div>`;
    }).join('');

    labelsDiv.innerHTML = visibleHours.map((_, i) => {
      const h        = firstH + i;
      const label    = h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
      const isCurrent = h === currentHour;
      return `<span class="dash-chart-label ${isCurrent ? "dash-label-today" : ""}">${label}</span>`;
    }).join('');
  } catch (e) {
    console.error("loadHourlyChart error:", e);
  }
}

// ── Backward-compat ───────────────────────────────────────────────────────────

// Kept for backward-compat (called from old dashboard settings row, now removed — no-op)
async function loadDashboardSettings() {}
async function changeTableCount(delta) {}
