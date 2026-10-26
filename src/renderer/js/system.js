// ================= BACKUPS & SYSTEM HEALTH =================
// Uses: electronAPI.listBackups / restoreBackup / createBackup / getHealthStatus

let _restoringBackup = false;

function _formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function _formatBackupDay(dateStr) {
  const d = new Date(String(dateStr) + "T00:00:00");
  if (isNaN(d.getTime())) return String(dateStr || "");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function _formatClock(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

async function _fetchBackups() {
  try {
    const res = await window.electronAPI.listBackups();
    if (!res || !res.success) return { ok: false, list: [], error: res?.error };
    return { ok: true, list: Array.isArray(res.data) ? res.data : [] };
  } catch (e) {
    return { ok: false, list: [], error: e.message };
  }
}

// "Last saved …" line on the dashboard settings card.
async function loadBackupSummary() {
  const el = document.getElementById("backupSummary");
  if (!el) return;
  const { ok, list } = await _fetchBackups();
  if (!ok) { el.textContent = "Could not read backups"; return; }
  if (list.length === 0) { el.textContent = "No backups yet"; return; }
  const latest = list[0];
  const time = _formatClock(latest.modifiedAt);
  el.textContent = `Last saved ${formatDisplayDate(latest.date)}${time ? ", " + time : ""} · ${list.length} kept`;
}

async function openBackups() {
  openModal("backupModal", { focus: "#backupNowBtn" });
  await renderBackupList();
}

function closeBackups() {
  closeModal("backupModal");
}

async function renderBackupList() {
  const listEl = document.getElementById("backupList");
  const emptyEl = document.getElementById("backupEmpty");
  if (!listEl) return;
  listEl.innerHTML = '<p class="no-data">Loading backups…</p>';

  const { ok, list, error } = await _fetchBackups();
  if (!ok) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "none";
    showToast(error || "Could not load backups", "error");
    return;
  }
  if (list.length === 0) {
    listEl.replaceChildren();
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  listEl.innerHTML = list.map((b, i) => {
    const time = _formatClock(b.modifiedAt);
    return `
      <div class="manage-item" data-backup-date="${escapeHTML(b.date)}">
        <span class="manage-item-text">
          <span class="manage-item-label">${escapeHTML(_formatBackupDay(b.date))}${i === 0 ? '<span class="badge badge-success">Latest</span>' : ""}</span>
          <span class="manage-item-meta">${time ? "Saved " + escapeHTML(time) + " · " : ""}${escapeHTML(_formatBytes(b.size))}</span>
        </span>
        <button type="button" class="btn btn-secondary btn-sm" data-backup-action="restore">${icon("refresh", "icon-sm")}Restore</button>
      </div>`;
  }).join("");
}

async function confirmRestoreBackup(date) {
  if (_restoringBackup || !date) return;
  let openOrders = 0;
  try {
    const res = await window.electronAPI.getActiveOrders();
    const orders = (res && res.success && res.data) || {};
    openOrders = Object.values(orders).filter(items => Array.isArray(items) && items.length > 0).length;
  } catch (_) { /* informational only */ }

  const day = _formatBackupDay(date);
  const message =
    `Restore the backup from ${day}? All current data will be replaced by that copy and the app will restart.` +
    (openOrders > 0 ? ` ${openOrders} open order${openOrders !== 1 ? "s" : ""} not yet billed will be cleared.` : "") +
    " Your current data is kept as a safety copy.";

  showConfirmModal(message, () => _doRestoreBackup(date), {
    confirmLabel: "Restore & Restart",
    tone: "danger",
    title: "Restore this backup?",
  });
}

function _showRestartOverlay(title, message) {
  const overlay = document.getElementById("restartOverlay");
  if (!overlay) return;
  document.getElementById("restartTitle").textContent = title;
  document.getElementById("restartMessage").textContent = message;
  overlay.style.display = "flex";
}

function _hideRestartOverlay() {
  const overlay = document.getElementById("restartOverlay");
  if (overlay) overlay.style.display = "none";
}

async function _doRestoreBackup(date) {
  if (_restoringBackup) return;
  _restoringBackup = true;
  _showRestartOverlay("Restoring backup…", "Please wait. Don't close the app.");
  try {
    const res = await window.electronAPI.restoreBackup(date);
    if (!res || !res.success) {
      _restoringBackup = false;
      _hideRestartOverlay();
      showToast(res?.error || "Restore failed", "error");
      return;
    }
    _showRestartOverlay("Backup restored", "The app is restarting… it will open again by itself.");
  } catch (e) {
    _restoringBackup = false;
    _hideRestartOverlay();
    showToast("Restore failed: " + e.message, "error");
  }
}

async function backupNow() {
  const btn = document.getElementById("backupNowBtn");
  if (btn) btn.disabled = true;
  try {
    const res = await window.electronAPI.createBackup();
    if (res && res.success) showToast("Backup saved");
    else showToast(res?.error || "Backup failed", "error");
  } catch (e) {
    showToast("Backup failed: " + e.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
  await renderBackupList();
  await loadBackupSummary();
}

const _backupListEl = document.getElementById("backupList");
if (_backupListEl) {
  _backupListEl.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-backup-action="restore"]');
    if (!btn) return;
    const row = btn.closest("[data-backup-date]");
    if (row) confirmRestoreBackup(row.dataset.backupDate);
  });
}

// Block every key while the app is restarting (nothing may change mid-restore).
document.addEventListener("keydown", (e) => {
  if (_restoringBackup) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

registerModal("backupModal", closeBackups);

// ================= HEALTH NOTICES (after entering the POS) =================

function renderSystemBanner(degraded) {
  const banner = document.getElementById("systemBanner");
  if (!banner) return;
  if (!degraded) { banner.style.display = "none"; return; }
  const detail = document.getElementById("systemBannerDetail");
  if (detail) {
    detail.textContent = degraded.reason ? `Details: ${degraded.reason}` : "";
    detail.title = degraded.reason || "";
  }
  banner.style.display = "flex";
}

function _showRecoveryNotice(rec) {
  const key = "recoveryNoticeSeen";
  const stamp = String(rec.at || rec.restoredFrom || "shown");
  try { if (localStorage.getItem(key) === stamp) return; } catch (_) {}

  const manual = rec.reason === "manual restore";
  const when = rec.at ? `${formatDisplayDate(todayStrFrom(rec.at))}, ${_formatClock(rec.at)}` : "";
  const fromDay = rec.restoredFrom ? _formatBackupDay(rec.restoredFrom) : null;
  const kept = rec.preservedAs ? String(rec.preservedAs).split(/[\\/]/).pop() : null;

  let title;
  let message;
  if (manual) {
    title = "Backup restored";
    message = `Your data was restored from the backup of ${fromDay || "the selected day"}. The data it replaced was kept as a safety copy${kept ? ` (${kept})` : ""}.`;
  } else if (fromDay) {
    title = "Data was restored from a backup";
    message = `The database was damaged${rec.reason ? ` (${rec.reason})` : ""}, so the app restored the backup from ${fromDay}${when ? ` on ${when}` : ""}. ` +
      `Bills made after that backup may be missing — please check today's sales. The damaged file was kept${kept ? ` as ${kept}` : ""} for support.`;
  } else {
    title = "Database was reset";
    message = `The database was damaged${rec.reason ? ` (${rec.reason})` : ""} and no backup was available, so a new empty database was started. ` +
      `The damaged file was kept${kept ? ` as ${kept}` : ""} — please contact support to recover it.`;
  }

  showAlertModal(title, message, {
    okLabel: "OK, understood",
    tone: manual ? "success" : "warning",
    onClose: () => { try { localStorage.setItem(key, stamp); } catch (_) {} },
  });
}

function todayStrFrom(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return todayStr();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function checkSystemHealthOnEnter() {
  try {
    const res = await window.electronAPI.getHealthStatus();
    if (!res || !res.success) return;
    const health = res.data || {};
    renderSystemBanner(health.degraded);
    if (health.recovery) _showRecoveryNotice(health.recovery);
    if (health.diskSpace === false) {
      showToast(`Low disk space (${health.freeMB} MB free). Free up space so backups keep working.`, "warning");
    }
  } catch (e) {
    console.warn("health check failed", e);
  }
}
