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

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.style.cssText = `position:fixed;bottom:30px;right:30px;background:${type==="success"?"#4CAF50":type==="error"?"#f44336":"#FF9800"};color:white;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);opacity:1;transition:opacity 0.4s ease;`;
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(()=>{toast.style.opacity="0";setTimeout(()=>toast.remove(),400);},2500);
}

function showConfirmModal(message, onConfirm, { confirmLabel = "Yes, Delete", confirmColor = "#f44336" } = {}) {
  const existing = document.getElementById("confirmModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "confirmModal";
  modal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;";

  // Build the inner container safely — no innerHTML for user-controlled content
  const inner = document.createElement("div");
  inner.style.cssText = "background:white;padding:30px;border-radius:16px;text-align:center;min-width:300px;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.3);";

  const heading = document.createElement("h3");
  heading.style.cssText = "margin-bottom:15px;color:#3C2A21;";
  heading.textContent = "⚠️ Confirm Action";

  const body = document.createElement("p");
  body.style.cssText = "color:#666;margin-bottom:25px;line-height:1.5;";
  body.textContent = message;   // textContent — safe, no HTML injection

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:12px;justify-content:center;";

  const yesBtn = document.createElement("button");
  yesBtn.id = "confirmYesBtn";
  yesBtn.style.cssText = `padding:12px 28px;background:${confirmColor};color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;`;
  yesBtn.textContent = confirmLabel;

  const noBtn = document.createElement("button");
  noBtn.id = "confirmNoBtn";
  noBtn.style.cssText = "padding:12px 28px;background:#e0d5c5;color:#333;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;";
  noBtn.textContent = "Cancel";

  btnRow.appendChild(yesBtn);
  btnRow.appendChild(noBtn);
  inner.appendChild(heading);
  inner.appendChild(body);
  inner.appendChild(btnRow);
  modal.appendChild(inner);
  document.body.appendChild(modal);

  yesBtn.onclick = function() { modal.remove(); onConfirm(); };
  noBtn.onclick  = function() { modal.remove(); };
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
