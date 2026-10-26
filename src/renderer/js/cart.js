// ================= CART FUNCTIONS =================

let _lastAddedName = null;   // highlight the cart row that was just added

function openSizeModal(product, categoryName) {
  pendingProductForSize = { product, categoryName };

  const sizeProductName = document.getElementById("sizeProductName");
  const halfPrice = document.getElementById("halfPrice");
  const fullPrice = document.getElementById("fullPrice");

  if (!sizeProductName || !halfPrice || !fullPrice) return;

  sizeProductName.textContent = product.name;
  halfPrice.textContent = formatMoney(product.halfPrice || 0);
  fullPrice.textContent = formatMoney(product.price || 0);
  openModal("sizeModal", { focus: ".full-btn" });
}

function selectSize(size) {
  if (!pendingProductForSize) return;
  const { product, categoryName } = pendingProductForSize;
  const selectedPrice = size === "half" ? (product.halfPrice || 0) : (product.price || 0);
  const selectedName = product.name + (size === "half" ? " (Half)" : " (Full)");
  closeSizeModal();
  selectProduct(selectedName, categoryName, selectedPrice, product.addons || []);
}

function closeSizeModal() {
  closeModal("sizeModal");
  pendingProductForSize = null;
}

function selectProduct(productName, categoryName, price = 0, addons = []) {
  if (!Array.isArray(currentMenu)) return;

  const baseProductName = String(productName).replace(/\s\((Half|Full)\)$/, "");
  const isVariantSelection = /\s\((Half|Full)\)$/.test(productName);
  const product = currentMenu
    .find(c => c.name === categoryName)
    ?.products?.find(p => p.name === baseProductName || p.name === productName);

  if (product?.unavailable === true) {
    showToast("This item is currently unavailable", "error");
    return;
  }

  if (!isVariantSelection && product?.hasVariants) {
    openSizeModal(product, categoryName);
    return;
  }

  addToCart({
    name: productName,
    price: Number(price) || 0,
    addons: Array.isArray(addons) ? addons : []
  });
}

function addToCart(product) {
  if (!currentOrderId) return showToast("Please select a table or delivery first.", "error");

  if (product.addons && product.addons.length > 0) {
    // Show addon selection modal
    pendingProduct = product;

    const addonProductName = document.getElementById("addonProductName");
    const optionsDiv = document.getElementById("addonOptions");
    if (!addonProductName || !optionsDiv) return; // DOM safety

    addonProductName.textContent = `${product.name} · ${formatMoney(product.price, "auto")}`;
    optionsDiv.replaceChildren();

    product.addons.forEach(addon => {
      const label = document.createElement("label");
      label.className = "addon-checkbox";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = addon.name;
      checkbox.dataset.price = addon.price;

      const name = document.createElement("span");
      name.className = "addon-name";
      name.textContent = addon.name;
      const price = document.createElement("span");
      price.className = "addon-price";
      price.textContent = `+${formatMoney(addon.price, "auto")}`;

      label.append(checkbox, name, price);
      optionsDiv.appendChild(label);
    });

    openModal("addonModal", { focus: "#addonConfirmBtn" });
  } else {
    // Add directly to cart
    addToCartWithAddons(product, []);
  }
}

async function addToCartWithAddons(product, addons) {
  try {
    if (!currentOrderId) return;

    const item = {
      name: product.name,
      price: product.price || 0,
      addons: addons
    };

    const response = await window.electronAPI.addToOrder(currentOrderId, item);
    if (!response.success) {
      if (response.error === "OUT_OF_STOCK") {
        showToast(`${product.name} is out of stock`, "error");
        return;
      }
      console.error("Failed to add item to order:", response.error);
      showToast(`Failed to add item: ${response.error}`, "error");
      return;
    }

    _lastAddedName = item.name;
    await refreshCartView();
  } catch (error) {
    console.error("addToCartWithAddons error:", error);
    showToast("Failed to add item to cart", "error");
  }
}

function confirmAddons() {
  const addonOptions = document.getElementById("addonOptions");
  if (!addonOptions) return; // DOM safety

  const checkboxes = addonOptions.querySelectorAll("input:checked");
  const selected = Array.from(checkboxes).map(cb => {
    const price = parseFloat(cb.dataset.price);
    return {
      name: cb.value,
      price: isNaN(price) ? 0 : price  // Safety check for NaN
    };
  });

  if (!pendingProduct) {
    console.error("confirmAddons: No pending product");
    return;
  }

  const product = pendingProduct;
  closeAddonModal();
  addToCartWithAddons(product, selected);
}

function closeAddonModal() {
  closeModal("addonModal");
  pendingProduct = null;
}

// Shared helper: fetch active orders once, update both cart DOM and table status badges.
async function refreshCartView() {
  try {
    const response = await window.electronAPI.getActiveOrders();
    if (!response.success) {
      console.error("refreshCartView: failed to get active orders:", response.error);
      return;
    }
    _renderCartFromData(response.data);
    _updateTableStatusFromData(response.data);
  } catch (error) {
    console.error("refreshCartView error:", error);
    showToast("Failed to refresh cart", "error");
  }
}

function _renderCartEmpty(cartItemsEl) {
  cartItemsEl.innerHTML = `
    <div class="cart-empty">
      ${icon("bag")}
      <strong>No items yet</strong>
      <span>Tap a product, or type in search and press Enter.</span>
    </div>`;
}

// Internal: render cart DOM from pre-fetched activeOrders data object
function _renderCartFromData(activeOrders) {
  if (!currentOrderId) return;

  const order = activeOrders ? activeOrders[currentOrderId] : null;
  const cartItemsEl = document.getElementById("cart-items");
  const totalEl = document.getElementById("total");
  const countEl = document.getElementById("cartCount");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const clearBtn = document.getElementById("clearCartBtn");
  if (!cartItemsEl || !totalEl) return;

  const items = Array.isArray(order) ? order : (order?.items || []);
  const { count, total } = cartTotals(items);

  totalEl.textContent = total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (countEl) countEl.textContent = String(count);
  if (checkoutBtn) checkoutBtn.disabled = items.length === 0;
  if (clearBtn) clearBtn.disabled = items.length === 0;

  if (items.length === 0) {
    _renderCartEmpty(cartItemsEl);
    _lastAddedName = null;
    return;
  }

  const frag = document.createDocumentFragment();
  let highlightRow = null;

  items.forEach((item, index) => {
    const unit = (Number(item.price) || 0) + (Array.isArray(item.addons) ? item.addons.reduce((a, ad) => a + (Number(ad.price) || 0), 0) : 0);
    const qty = Number(item.quantity) || 1;

    let addonsHtml = "";
    if (item.addons && item.addons.length > 0) {
      addonsHtml = `<div class="cart-addons">${item.addons.map(a => `+ ${escapeHTML(a.name)} (${formatMoney(a.price, "auto")})`).join(", ")}</div>`;
    }

    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHTML(item.name)}</div>
        ${addonsHtml}
      </div>
      <div class="cart-line-total">${formatMoney(unit * qty)}</div>
      <div class="cart-item-foot">
        <span class="item-price">${formatMoney(unit)} × ${qty}</span>
        <div class="cart-item-actions">
          <button type="button" class="qty-btn qty-btn-remove" data-action="remove" data-index="${index}" title="Remove item" aria-label="Remove ${escapeHTML(item.name)}">${icon("trash")}</button>
          <button type="button" class="qty-btn" data-action="decrease" data-index="${index}" aria-label="Decrease quantity">${icon("minus")}</button>
          <span class="qty" aria-label="Quantity">${qty}</span>
          <button type="button" class="qty-btn" data-action="increase" data-index="${index}" aria-label="Increase quantity">${icon("plus")}</button>
        </div>
      </div>
    `;
    if (_lastAddedName && item.name === _lastAddedName) highlightRow = row;
    frag.appendChild(row);
  });

  cartItemsEl.replaceChildren(frag);

  if (highlightRow) {
    highlightRow.classList.add("just-added");
    highlightRow.scrollIntoView({ block: "nearest" });
  }
  _lastAddedName = null;
}

async function renderCart() {
  try {
    if (!currentOrderId) return;

    const response = await window.electronAPI.getActiveOrders();
    if (!response.success) {
      console.error("Failed to get active orders:", response.error);
      return;
    }

    _renderCartFromData(response.data);
  } catch (error) {
    console.error("renderCart error:", error);
    showToast("Failed to refresh cart", "error");
  }
}

async function increaseQuantity(index) {
  if (!currentOrderId || index === undefined || index === null || index < 0) return; // DOM safety

  try {
    const result = await window.electronAPI.increaseCartItemQuantity(currentOrderId, index);
    if (!result || !result.success) {
      showToast(result?.error || "Failed to increase quantity", "error");
      return;
    }

    await refreshCartView();
  } catch (error) {
    console.error("increaseQuantity error:", error);
    showToast("Failed to increase quantity", "error");
  }
}

async function decreaseQuantity(index) {
  if (!currentOrderId || index === undefined || index === null || index < 0) return; // DOM safety

  try {
    const result = await window.electronAPI.decreaseCartItemQuantity(currentOrderId, index);
    if (!result || !result.success) {
      showToast(result?.error || "Failed to decrease quantity", "error");
      return;
    }

    await refreshCartView();
  } catch (error) {
    console.error("decreaseQuantity error:", error);
    showToast("Failed to decrease quantity", "error");
  }
}

async function removeCartItem(index) {
  if (!currentOrderId || index === undefined || index === null || index < 0) return;

  try {
    const result = await window.electronAPI.removeCartItem(currentOrderId, index);
    if (!result || !result.success) {
      showToast(result?.error || "Failed to remove item", "error");
      return;
    }
    await refreshCartView();
  } catch (error) {
    console.error("removeCartItem error:", error);
    showToast("Failed to remove item", "error");
  }
}

async function clearCart() {
  if (!currentOrderId) return;
  const orderId = currentOrderId;

  showConfirmModal(
    `Remove all items from ${orderId}? This cannot be undone.`,
    async () => {
      try {
        const result = await window.electronAPI.clearCart(orderId);
        if (!result || !result.success) {
          showToast(result?.error || "Failed to clear cart", "error");
          return;
        }
        await refreshCartView();
      } catch (error) {
        console.error("clearCart error:", error);
        showToast("Failed to clear cart", "error");
      }
    },
    { confirmLabel: "Yes, Clear", tone: "warning", title: "Clear this order?" }
  );
}

// Event delegation for cart buttons (one listener, survives re-renders)
const cartContainer = document.getElementById("cart-items");
if (cartContainer) {
  cartContainer.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !cartContainer.contains(btn)) return;
    const index = parseInt(btn.dataset.index, 10);
    if (Number.isNaN(index)) return;
    if (btn.dataset.action === "increase") increaseQuantity(index);
    else if (btn.dataset.action === "decrease") decreaseQuantity(index);
    else if (btn.dataset.action === "remove") removeCartItem(index);
  });
}

registerModal("sizeModal", closeSizeModal);
registerModal("addonModal", closeAddonModal);
