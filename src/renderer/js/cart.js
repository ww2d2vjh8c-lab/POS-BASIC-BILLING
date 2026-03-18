// ================= CART FUNCTIONS =================

function openSizeModal(product, categoryName) {
  pendingProductForSize = { product, categoryName };

  const sizeProductName = document.getElementById("sizeProductName");
  const halfPrice = document.getElementById("halfPrice");
  const fullPrice = document.getElementById("fullPrice");
  const sizeModal = document.getElementById("sizeModal");

  if (!sizeProductName || !halfPrice || !fullPrice || !sizeModal) return;

  sizeProductName.innerText = product.name;
  halfPrice.innerText = "₹" + (product.halfPrice || 0).toFixed(2);
  fullPrice.innerText = "₹" + (product.price || 0).toFixed(2);
  sizeModal.style.display = "block";
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
  const sizeModal = document.getElementById("sizeModal");
  if (!sizeModal) return;
  sizeModal.style.display = "none";
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
    const addonModal = document.getElementById("addonModal");
    
    if (!addonProductName || !optionsDiv || !addonModal) return; // DOM safety
    
    addonProductName.innerText = product.name + " - ₹" + product.price;
    optionsDiv.innerHTML = "";
    
    product.addons.forEach(addon => {
      const label = document.createElement("label");
      label.className = "addon-checkbox";
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = addon.name;
      checkbox.dataset.price = addon.price;

      const span = document.createElement('span');
      span.textContent = `${addon.name} (+₹${addon.price})`;

      label.appendChild(checkbox);
      label.appendChild(span);
      optionsDiv.appendChild(label);
    });
    
    addonModal.style.display = "block";
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

    const response = await window.electronAPI.addToOrder( currentOrderId, item);
    if (!response.success) {
      if (response.error === "OUT_OF_STOCK") {
        showToast("Item out of stock!", "error");
        return;
      }
      console.error("Failed to add item to order:", response.error);
      showToast(`Failed to add item: ${response.error}`, "error");
      return;
    }

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
  const addonModal = document.getElementById("addonModal");
  if (!addonModal) return; // DOM safety
  addonModal.style.display = "none";
  pendingProduct = null;
}

// Shared helper: fetch active orders once, update both cart DOM and table status badges.
// Replaces the repeated "await renderCart(); await updateTableStatus();" pattern.
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

// Internal: render cart DOM from pre-fetched activeOrders data object
function _renderCartFromData(activeOrders) {
  if (!currentOrderId) return;

  const order = activeOrders[currentOrderId];
  const cartItemsEl = document.getElementById("cart-items");
  const totalEl = document.getElementById("total");
  if (!cartItemsEl || !totalEl) return;

  if (!order) {
    cartItemsEl.innerHTML = "";
    totalEl.innerText = "0";
    return;
  }

  const items = Array.isArray(order) ? order : (order?.items || []);
  if (!Array.isArray(items)) return;

  cartItemsEl.innerHTML = "";
  let total = 0;

  items.forEach((item, index) => {
    const itemTotal = item.price + (item.addons ? item.addons.reduce((a, ad) => a + ad.price, 0) : 0);
    total += itemTotal * item.quantity;

    let addonsHtml = "";
    if (item.addons && item.addons.length > 0) {
      addonsHtml = `<div class="cart-addons">${item.addons.map(a => `+ ${escapeHTML(a.name)} (₹${a.price})`).join(", ")}</div>`;
    }

    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-info">
        <strong>${escapeHTML(item.name)}</strong>
        ${addonsHtml}
        <span class="item-price">₹${itemTotal.toFixed(2)} × ${item.quantity}</span>
      </div>
      <div class="cart-item-actions">
        <button class="qty-btn qty-btn-remove" data-action="remove" data-index="${index}" title="Remove item">✕</button>
        <button class="qty-btn" data-action="decrease" data-index="${index}">-</button>
        <span class="qty">${item.quantity}</span>
        <button class="qty-btn" data-action="increase" data-index="${index}">+</button>
      </div>
    `;
    cartItemsEl.appendChild(row);
  });

  totalEl.innerText = total.toFixed(2);
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
    const result = await window.electronAPI.increaseCartItemQuantity( currentOrderId, index);
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
    const result = await window.electronAPI.decreaseCartItemQuantity( currentOrderId, index);
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
  
  showConfirmModal(
    `Are you sure you want to clear the cart for ${currentOrderId}?`,
    async () => {
      try {
        const result = await window.electronAPI.clearCart(currentOrderId);
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
    { confirmLabel: "Yes, Clear", confirmColor: "#FF9800" }
  );
}

// Initializing event delegation
const cartContainer = document.getElementById("cart-items");
if (cartContainer) {
  cartContainer.addEventListener("click", (e) => {
    const increaseBtn = e.target.closest("[data-action='increase']");
    const decreaseBtn = e.target.closest("[data-action='decrease']");
    const removeBtn = e.target.closest("[data-action='remove']");

    if (increaseBtn) {
      const index = parseInt(increaseBtn.dataset.index);
      increaseQuantity(index);
    }
    if (decreaseBtn) {
      const index = parseInt(decreaseBtn.dataset.index);
      decreaseQuantity(index);
    }
    if (removeBtn) {
      const index = parseInt(removeBtn.dataset.index);
      removeCartItem(index);
    }
  });
}
