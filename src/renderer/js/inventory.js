// ================= INVENTORY MANAGER (3-tab redesign) =================
//
// Tabs: Stock | Menu Sync | History
// Globals used: escapeHTML, showToast, showConfirmModal, queueInventoryOperation
//               (all defined in utils.js / store.js, loaded before this file)

// ── Module state ──────────────────────────────────────────────────────────────

let _invSnapshot       = [];   // current inventory items (archived=0)
let _invSyncStatus     = null; // { linked, unlinked, missing }
let _invHistory        = [];   // inventory_audit_log entries
let _invCurrentTab     = 'stock';
let _invRestockMode    = false;
let _invRestockChanges = {};   // { itemName: newStock }

// ── Open / Close ──────────────────────────────────────────────────────────────

async function openInventoryManager() {
  try {
    const modal = document.getElementById('inventoryModal');
    if (!modal) return;
    modal.style.display = 'block';
    await _loadAllInventoryData();
    _showTab('stock');
  } catch (e) {
    console.error('openInventoryManager error:', e);
    showToast('Failed to open inventory', 'error');
  }
}

function closeInventoryManager() {
  document.getElementById('inventoryModal').style.display = 'none';
  _invRestockMode = false;
  _invRestockChanges = {};
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function _loadAllInventoryData() {
  try {
    const [invRes, syncRes, histRes] = await Promise.all([
      window.electronAPI.getInventory(),
      window.electronAPI.getInventorySyncStatus(),
      window.electronAPI.getInventoryAuditLog(),
    ]);

    _invSnapshot   = invRes.success  ? (invRes.data?.items  || []) : [];
    _invSyncStatus = syncRes.success ? (syncRes.data         || { linked: [], unlinked: [], missing: [] }) : { linked: [], unlinked: [], missing: [] };
    _invHistory    = histRes.success ? (histRes.data         || []) : [];

    _renderSummaryBar();
    if (_invCurrentTab === 'stock')   renderStockTab();
    if (_invCurrentTab === 'sync')    renderSyncTab();
    if (_invCurrentTab === 'history') renderHistoryTab();
  } catch (e) {
    console.error('_loadAllInventoryData error:', e);
    showToast('Failed to load inventory data', 'error');
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchInvTab(tab, btn) {
  _invCurrentTab = tab;
  document.querySelectorAll('.inv-tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _showTab(tab);
}

function _showTab(tab) {
  const panels = { stock: 'invTabStock', sync: 'invTabSync', history: 'invTabHistory' };
  Object.entries(panels).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = key === tab ? '' : 'none';
  });
  if (tab === 'stock')   renderStockTab();
  if (tab === 'sync')    renderSyncTab();
  if (tab === 'history') renderHistoryTab();
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function _renderSummaryBar() {
  let well = 0, low = 0, out = 0;
  _invSnapshot.forEach(item => {
    const stock   = Number(item.stock)   || 0;
    const alertAt = Number(item.lowStock) || 10;
    if (stock <= 0)              out++;
    else if (stock <= alertAt)   low++;
    else                         well++;
  });

  const untracked = (_invSyncStatus?.missing?.length || 0);

  _setEl('invStatWell',      String(well));
  _setEl('invStatLow',       String(low));
  _setEl('invStatOut',       String(out));
  _setEl('invStatUntracked', String(untracked));
}

// ── TAB 1: Stock ──────────────────────────────────────────────────────────────

function renderStockTab() {
  const container = document.getElementById('invCategoryGroups');
  const empty     = document.getElementById('invEmptyState');
  if (!container) return;

  if (_invSnapshot.length === 0) {
    container.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Group items by category
  const groups = {};
  _invSnapshot.forEach(item => {
    const cat = item.categoryName || 'Uncategorized';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  container.innerHTML = Object.entries(groups).map(([cat, items]) => {
    const rows = items.map(item => _buildItemRow(item)).join('');
    return `
      <div class="inv-category-section">
        <div class="inv-category-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="inv-cat-arrow">▼</span>
          <span class="inv-cat-name">${escapeHTML(cat)}</span>
          <span class="inv-cat-count">${items.length} item${items.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="inv-category-body">
          ${rows}
        </div>
      </div>`;
  }).join('');
}

function _buildItemRow(item) {
  const stock   = Number(item.stock)   || 0;
  const alertAt = Number(item.lowStock) || 10;
  const isOut  = stock <= 0;
  const isLow  = !isOut && stock <= alertAt;
  const dotCls = isOut ? 'inv-dot-red' : isLow ? 'inv-dot-yellow' : 'inv-dot-green';
  const rowCls = isOut ? 'inv-row-out' : isLow ? 'inv-row-low' : '';
  const name   = escapeHTML(item.name);

  if (_invRestockMode) {
    const cur = _invRestockChanges.hasOwnProperty(item.name)
      ? _invRestockChanges[item.name]
      : stock;
    return `
      <div class="inv-item-row ${rowCls}" data-name="${name}">
        <span class="inv-status-dot ${dotCls}"></span>
        <span class="inv-item-name">${name}</span>
        <div class="inv-stock-control">
          <input type="number" class="inv-restock-input" value="${cur}" min="0"
            data-item="${name}"
            onchange="invRestockChange('${name}', this.value)" />
        </div>
        <input type="number" class="inv-alert-input" value="${alertAt}" min="0"
          onchange="updateLowStockAlert('${item.name}', this.value)" />
        <div></div>
      </div>`;
  }

  return `
    <div class="inv-item-row ${rowCls}" data-name="${name}">
      <span class="inv-status-dot ${dotCls}"></span>
      <span class="inv-item-name">${name}</span>
      <div class="inv-stock-control">
        <button class="inv-qty-btn" onclick="adjustStock('${escapeHTML(item.name)}', -1)">−</button>
        <span class="inv-stock-number ${isOut ? 'inv-stock-zero' : isLow ? 'inv-stock-low' : ''}">${stock}</span>
        <button class="inv-qty-btn" onclick="adjustStock('${escapeHTML(item.name)}', 1)">+</button>
      </div>
      <input type="number" class="inv-alert-input" value="${alertAt}" min="0"
        onchange="updateLowStockAlert('${escapeHTML(item.name)}', this.value)" />
      <div class="inv-row-actions">
        <button class="inv-delete-btn" onclick="deleteInventoryItem('${escapeHTML(item.name)}')" title="Remove">🗑️</button>
      </div>
    </div>`;
}

// ── Restock mode ──────────────────────────────────────────────────────────────

function toggleAddItemForm() {
  const form = document.getElementById('invAddItemForm');
  const btn  = document.getElementById('invAddToggleBtn');
  if (!form) return;
  const visible = form.style.display !== 'none';
  form.style.display = visible ? 'none' : '';
  if (btn) btn.textContent = visible ? '➕ Add Item' : '✕ Cancel';
}

function toggleRestockMode() {
  _invRestockMode    = true;
  _invRestockChanges = {};
  _setVisible('invRestockToggleBtn', false);
  _setVisible('invSaveAllBtn',       true);
  _setVisible('invCancelRestockBtn', true);
  renderStockTab();
}

function cancelRestockMode() {
  _invRestockMode    = false;
  _invRestockChanges = {};
  _setVisible('invRestockToggleBtn', true);
  _setVisible('invSaveAllBtn',       false);
  _setVisible('invCancelRestockBtn', false);
  renderStockTab();
}

function invRestockChange(name, value) {
  const parsed = parseInt(value, 10);
  if (!isNaN(parsed) && parsed >= 0) {
    _invRestockChanges[name] = parsed;
  }
}

async function saveRestockMode() {
  const updates = Object.entries(_invRestockChanges).map(([name, stock]) => ({ name, stock }));
  if (updates.length === 0) {
    cancelRestockMode();
    return;
  }
  try {
    const res = await window.electronAPI.bulkUpdateStock(updates);
    if (res.success) {
      showToast(`${updates.length} item${updates.length !== 1 ? 's' : ''} updated`);
    } else {
      showToast(res.error || 'Failed to save', 'error');
    }
  } catch (e) {
    showToast('Save failed', 'error');
  }
  cancelRestockMode();
  await _loadAllInventoryData();
}

// ── Stock adjustments ─────────────────────────────────────────────────────────

async function adjustStock(itemName, delta) {
  return queueInventoryOperation(`stock:${itemName}`, async () => {
    try {
      const item = _invSnapshot.find(i => i.name === itemName);
      if (!item) { await _loadAllInventoryData(); return; }

      const prev     = Number(item.stock) || 0;
      const newStock = Math.max(0, prev + delta);
      item.stock = newStock;
      renderStockTab();
      _renderSummaryBar();

      const result = await window.electronAPI.updateStock(itemName, newStock, 'manual');
      if (!result.success) {
        item.stock = prev;
        renderStockTab();
        _renderSummaryBar();
        showToast(result.error || 'Failed to update stock', 'error');
      }
    } catch (e) {
      console.error('adjustStock error:', e);
      await _loadAllInventoryData();
      showToast('Failed to update stock', 'error');
    }
  });
}

async function updateLowStockAlert(itemName, value) {
  return queueInventoryOperation(`alert:${itemName}`, async () => {
    try {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 0) { showToast('Invalid alert value', 'error'); return; }

      const item = _invSnapshot.find(i => i.name === itemName);
      if (!item) { await _loadAllInventoryData(); return; }

      const prev = Number(item.lowStock) || 0;
      item.lowStock = parsed;
      _renderSummaryBar();

      const res = await window.electronAPI.updateLowStock(itemName, parsed);
      if (!res.success) {
        item.lowStock = prev;
        _renderSummaryBar();
        showToast(res.error || 'Failed to update alert', 'error');
      }
    } catch (e) {
      console.error('updateLowStockAlert error:', e);
      await _loadAllInventoryData();
      showToast('Failed to update alert', 'error');
    }
  });
}

async function addInventoryItem() {
  try {
    const nameEl     = document.getElementById('invItemName');
    const stockEl    = document.getElementById('invItemStock');
    const lowStockEl = document.getElementById('invItemLowStock');
    if (!nameEl || !stockEl || !lowStockEl) return;

    const name     = nameEl.value.trim();
    const stock    = parseInt(stockEl.value,    10);
    const lowStock = parseInt(lowStockEl.value, 10);

    if (!name) { showToast('Please enter item name', 'error'); return; }
    if (isNaN(stock) || stock < 0)        { showToast('Stock must be 0 or more', 'error'); return; }
    if (isNaN(lowStock) || lowStock < 0)  { showToast('Alert value must be 0 or more', 'error'); return; }

    const res = await window.electronAPI.addInventoryItem({ name, stock, lowStock });
    if (!res.success) { showToast(res.error || 'Failed to add item', 'error'); return; }

    nameEl.value = ''; stockEl.value = ''; lowStockEl.value = '';
    toggleAddItemForm();
    await _loadAllInventoryData();
    showToast(`${name} added to inventory`);
  } catch (e) {
    console.error('addInventoryItem error:', e);
    showToast('Failed to add item', 'error');
  }
}

async function deleteInventoryItem(itemName) {
  showConfirmModal(
    `Remove "${itemName}" from inventory? (Stock history is preserved.)`,
    async () => {
      try {
        const res = await window.electronAPI.deleteInventoryItem(itemName);
        if (res.success) {
          showToast(`${itemName} removed`);
          await _loadAllInventoryData();
        } else {
          showToast(res.error || 'Failed to remove item', 'error');
        }
      } catch (e) {
        console.error('deleteInventoryItem error:', e);
        showToast('Failed to remove item', 'error');
      }
    }
  );
}

// ── TAB 2: Menu Sync ──────────────────────────────────────────────────────────

function renderSyncTab() {
  if (!_invSyncStatus) return;
  const { linked, unlinked, missing } = _invSyncStatus;

  // Section C: Missing
  const missingEl      = document.getElementById('invSyncMissing');
  const missingEmptyEl = document.getElementById('invSyncMissingEmpty');
  if (missingEl) {
    if (missing.length === 0) {
      missingEl.innerHTML = '';
      if (missingEmptyEl) missingEmptyEl.style.display = 'block';
    } else {
      if (missingEmptyEl) missingEmptyEl.style.display = 'none';
      missingEl.innerHTML = missing.map(p => `
        <div class="inv-missing-row">
          <span class="inv-missing-name">${escapeHTML(p.productName)}</span>
          <span class="inv-category-badge">${escapeHTML(p.categoryName)}</span>
          <button class="inv-sync-one-btn" onclick="syncSingleProduct(${p.productId}, '${escapeHTML(p.productName)}')">+ Add to Inventory</button>
        </div>`).join('');
    }
  }

  // Section B: Unlinked
  const unlinkedEl      = document.getElementById('invSyncUnlinked');
  const unlinkedEmptyEl = document.getElementById('invSyncUnlinkedEmpty');
  if (unlinkedEl) {
    if (unlinked.length === 0) {
      unlinkedEl.innerHTML = '';
      if (unlinkedEmptyEl) unlinkedEmptyEl.style.display = 'block';
    } else {
      if (unlinkedEmptyEl) unlinkedEmptyEl.style.display = 'none';
      unlinkedEl.innerHTML = unlinked.map(i => `
        <div class="inv-sync-row">
          <span class="inv-sync-name">${escapeHTML(i.name)}</span>
          <span class="inv-untracked-badge">Not Connected</span>
          <span class="inv-sync-stock">Stock: ${i.stock}</span>
          <button class="inv-delete-btn" onclick="deleteInventoryItem('${escapeHTML(i.name)}')" title="Remove">🗑️</button>
        </div>`).join('');
    }
  }

  // Section A: Linked
  const linkedEl      = document.getElementById('invSyncLinked');
  const linkedEmptyEl = document.getElementById('invSyncLinkedEmpty');
  if (linkedEl) {
    if (linked.length === 0) {
      linkedEl.innerHTML = '';
      if (linkedEmptyEl) linkedEmptyEl.style.display = 'block';
    } else {
      if (linkedEmptyEl) linkedEmptyEl.style.display = 'none';
      linkedEl.innerHTML = linked.map(i => `
        <div class="inv-sync-row">
          <span class="inv-sync-name">${escapeHTML(i.name)}</span>
          <span class="inv-category-badge">${escapeHTML(i.categoryName || '')}</span>
          <span class="inv-linked-badge">Linked</span>
          <span class="inv-sync-stock">Stock: ${i.stock}</span>
        </div>`).join('');
    }
  }
}

async function syncAllMissing() {
  try {
    const res = await window.electronAPI.syncInventoryToMenu();
    if (res.success) {
      const n = res.data?.created || 0;
      showToast(n > 0 ? `${n} product${n !== 1 ? 's' : ''} added to inventory` : 'Nothing to sync — all products are already tracked');
      await _loadAllInventoryData();
    } else {
      showToast(res.error || 'Sync failed', 'error');
    }
  } catch (e) {
    console.error('syncAllMissing error:', e);
    showToast('Sync failed', 'error');
  }
}

async function syncSingleProduct(productId, productName) {
  try {
    const res = await window.electronAPI.addInventoryItem({
      name: productName, stock: 0, lowStock: 5,
    });
    if (res.success) {
      showToast(`${productName} added to inventory`);
      await _loadAllInventoryData();
    } else {
      showToast(res.error || 'Failed to add', 'error');
    }
  } catch (e) {
    showToast('Failed to add item', 'error');
  }
}

// ── TAB 3: History ────────────────────────────────────────────────────────────

function renderHistoryTab() {
  const tbody = document.getElementById('invHistoryBody');
  const empty = document.getElementById('invHistoryEmpty');
  if (!tbody) return;

  if (_invHistory.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const sourceBadge = {
    sale:             'inv-badge-blue',
    restock:          'inv-badge-green',
    manual:           'inv-badge-grey',
    auto:             'inv-badge-grey',
    bill_delete:      'inv-badge-orange',
    synced_from_menu: 'inv-badge-purple',
    archived:         'inv-badge-red',
    sync:             'inv-badge-purple',
  };

  tbody.innerHTML = _invHistory.map(entry => {
    const delta    = Number(entry.quantity_change) || 0;
    const sign     = delta > 0 ? '+' : '';
    const deltaCls = delta > 0 ? 'inv-delta-pos' : delta < 0 ? 'inv-delta-neg' : 'inv-delta-zero';
    const src      = entry.source || 'manual';
    const badgeCls = sourceBadge[src] || 'inv-badge-grey';
    const action   = entry.reason || entry.action || '—';
    const time     = entry.created_at
      ? new Date(entry.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
      : '—';

    return `<tr>
      <td class="inv-hist-time">${escapeHTML(time)}</td>
      <td class="inv-hist-name">${escapeHTML(entry.item_name || '')}</td>
      <td class="inv-hist-action">${escapeHTML(action)}</td>
      <td class="inv-hist-delta ${deltaCls}">${sign}${delta}</td>
      <td><span class="inv-source-badge ${badgeCls}">${escapeHTML(src.replace(/_/g, ' '))}</span></td>
    </tr>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}
