// ================= UTILITY FUNCTIONS =================

function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ₹ amount with Indian digit grouping. decimals: 2 (bills) or "auto" (drop .00).
function formatMoney(amount, decimals = 2) {
  const n = Number(amount) || 0;
  const digits = decimals === "auto" ? (Number.isInteger(n) ? 0 : 2) : decimals;
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Sum of a cart line: (price + add-ons) × quantity.
function lineTotal(item) {
  const addons = Array.isArray(item?.addons) ? item.addons.reduce((s, a) => s + (Number(a.price) || 0), 0) : 0;
  return ((Number(item?.price) || 0) + addons) * (Number(item?.quantity) || 1);
}

function cartTotals(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    count: list.reduce((s, i) => s + (Number(i.quantity) || 1), 0),
    total: list.reduce((s, i) => s + lineTotal(i), 0),
  };
}

// Inline SVG icon from the sprite in index.html (static names only).
function icon(name, extraClass = "") {
  return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

// ================= MODAL MANAGER =================
// Modals are shown with style.display = "flex" (the e2e test and older code
// also hide them via style.display = "none"). The most recently opened
// visible modal is "on top"; Esc / backdrop clicks act on that one only.

let _modalSeq = 0;
const _modalClosers = {};   // id -> function that closes it with proper cleanup

function registerModal(id, closeFn) {
  _modalClosers[id] = closeFn;
}

function isModalOpen(idOrEl) {
  const el = typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return false;
  const d = el.style.display;
  return d !== "" && d !== "none";
}

function openModal(id, { focus } = {}) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (!isModalOpen(el)) el._returnFocus = document.activeElement;
  _modalSeq++;
  el.dataset.openSeq = String(_modalSeq);
  el.style.zIndex = String(1000 + _modalSeq);
  el.style.display = "flex";
  setTimeout(() => {
    if (!isModalOpen(el)) return;
    if (el.contains(document.activeElement) && document.activeElement !== el) return;
    const target = (focus && el.querySelector(focus))
      || el.querySelector("[data-autofocus]")
      || el.querySelector(".modal-close-btn")
      || el.querySelector("button");
    if (target) target.focus({ preventScroll: true });
  }, 30);
  return el;
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const wasOpen = isModalOpen(el);
  el.style.display = "none";
  if (wasOpen) {
    const back = el._returnFocus;
    el._returnFocus = null;
    if (back && document.contains(back) && typeof back.focus === "function" && !getTopModal()) {
      back.focus({ preventScroll: true });
    }
  }
}

function getTopModal() {
  let top = null;
  let topSeq = -1;
  document.querySelectorAll(".modal").forEach(el => {
    if (!isModalOpen(el)) return;
    const seq = parseInt(el.dataset.openSeq || "0", 10);
    if (seq >= topSeq) { top = el; topSeq = seq; }
  });
  return top;
}

// Close the top modal the same way its own close button would.
function closeTopModal() {
  const top = getTopModal();
  if (!top) return false;
  const closer = _modalClosers[top.id];
  if (closer) closer(); else closeModal(top.id);
  return true;
}

// Backdrop click closes only modals marked data-backdrop-close="true"
// (never the checkout, menu or inventory forms, so work is not lost by a stray tap).
document.addEventListener("pointerdown", (e) => {
  const m = e.target;
  window._backdropDown = (m && m.classList && m.classList.contains("modal")) ? m : null;
});
document.addEventListener("click", (e) => {
  const m = e.target;
  if (!m || !m.classList || !m.classList.contains("modal")) return;
  if (window._backdropDown !== m) return;
  if (m.dataset.backdropClose !== "true") return;
  if (getTopModal() !== m) return;
  closeTopModal();
});

// Keep Tab focus inside the top modal.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const top = getTopModal();
  if (!top) return;
  const focusables = Array.from(top.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null || el.getClientRects().length > 0);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!top.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

// ================= TOASTS =================
// Shown top-centre below the header so they never cover the cart / checkout buttons.

const TOAST_ICONS = { success: "check", error: "alert", warning: "alert", info: "info" };

function showToast(message, type = "success") {
  const kind = TOAST_ICONS[type] ? type : "info";
  let region = document.getElementById("toastRegion");
  if (!region) {
    region = document.createElement("div");
    region.id = "toastRegion";
    region.className = "toast-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  // Keep at most 2 on screen so the stack never reaches the table tiles / search box.
  while (region.children.length >= 2) region.firstElementChild.remove();

  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.innerHTML = icon(TOAST_ICONS[kind]);
  const text = document.createElement("span");
  text.textContent = String(message);   // textContent — never interpret as HTML
  toast.appendChild(text);
  region.appendChild(toast);

  const dismiss = () => {
    if (toast._gone) return;
    toast._gone = true;
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 260);
  };
  setTimeout(dismiss, kind === "error" || kind === "warning" ? 4500 : 2600);
}

// ================= CONFIRM DIALOG =================

function showConfirmModal(message, onConfirm, { confirmLabel = "Yes, Delete", tone = "danger", title = "Confirm Action", cancelLabel = "Cancel" } = {}) {
  const modal = document.getElementById("confirmModal");
  const yesBtn = document.getElementById("confirmYesBtn");
  const noBtn = document.getElementById("confirmNoBtn");
  if (!modal || !yesBtn || !noBtn) return;

  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;   // textContent — safe
  const iconBox = document.getElementById("confirmIcon");
  if (iconBox) {
    iconBox.className = `result-icon ${tone === "danger" ? "result-icon-danger" : "result-icon-warning"}`;
    iconBox.innerHTML = icon("alert");
  }

  yesBtn.textContent = confirmLabel;
  yesBtn.className = `btn btn-lg ${tone === "danger" ? "btn-danger" : tone === "primary" ? "btn-primary" : "btn-warning"}`;
  noBtn.textContent = cancelLabel;
  noBtn.style.display = "";

  const close = () => closeModal("confirmModal");
  registerModal("confirmModal", close);
  yesBtn.onclick = () => { close(); onConfirm(); };
  noBtn.onclick = close;

  // Destructive by default: focus Cancel so a stray Enter never deletes anything.
  openModal("confirmModal", { focus: "#confirmNoBtn" });
}

// Single-button notice using the same dialog (e.g. "data was restored from a backup").
function showAlertModal(title, message, { okLabel = "OK", tone = "warning", onClose = null } = {}) {
  const modal = document.getElementById("confirmModal");
  const okBtn = document.getElementById("confirmYesBtn");
  const noBtn = document.getElementById("confirmNoBtn");
  if (!modal || !okBtn || !noBtn) return;

  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;
  const iconBox = document.getElementById("confirmIcon");
  if (iconBox) {
    iconBox.className = `result-icon result-icon-${tone === "success" ? "success" : tone === "danger" ? "danger" : "warning"}`;
    iconBox.innerHTML = icon(tone === "success" ? "check" : "alert");
  }
  okBtn.textContent = okLabel;
  okBtn.className = "btn btn-lg btn-primary";
  noBtn.style.display = "none";

  const close = () => {
    closeModal("confirmModal");
    noBtn.style.display = "";
    if (iconBox) iconBox.innerHTML = icon("alert");
    if (typeof onClose === "function") onClose();
  };
  registerModal("confirmModal", close);
  okBtn.onclick = close;
  openModal("confirmModal", { focus: "#confirmYesBtn" });
}

function formatDisplayDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  });
}

function appendOption(selectEl, value, label) {
  if (!selectEl) return;
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  selectEl.appendChild(option);
}
