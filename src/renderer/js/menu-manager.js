// ================= MENU MANAGEMENT =================

let _activeCategory = null;   // name of the category shown in the product grid

async function loadCategories() {
  try {
    const response = await window.electronAPI.getMenu();
    if (!response.success) {
      console.error("Failed to load menu:", response.error);
      return;
    }

    const menu = response.data;
    currentMenu = menu.categories;

    if (!Array.isArray(currentMenu)) {
      console.error("Invalid menu data: categories is not an array");
      return;
    }

    const div = document.getElementById("categoryList");
    if (!div) return; // DOM safety
    const frag = document.createDocumentFragment();
    currentMenu.forEach(cat => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-btn";
      btn.dataset.category = cat.name;   // compare by data, never by rendered text
      const name = document.createElement("span");
      name.className = "category-name";
      name.textContent = cat.name;
      const count = document.createElement("span");
      count.className = "category-count";
      count.textContent = String((cat.products || []).length);
      btn.append(name, count);
      btn.onclick = () => loadProducts(cat.name);
      frag.appendChild(btn);
    });
    div.replaceChildren(frag);

    // Keep the cashier on the same category after menu edits.
    const keep = currentMenu.find(c => c.name === _activeCategory) ? _activeCategory : currentMenu[0]?.name;
    const searchInput = document.getElementById("productSearch");
    if (searchInput && searchInput.value.trim()) {
      _activeCategory = keep;
      _markActiveCategory(keep);
      searchProducts(searchInput.value);
    } else if (keep) {
      loadProducts(keep);
    } else {
      document.getElementById("products")?.replaceChildren();
    }

    refreshManagerDropdowns(currentMenu);
  } catch (error) {
    showToast("Failed to load menu. Please restart the app.", "error");
  }
}

function _markActiveCategory(categoryName) {
  document.querySelectorAll("#categoryList .category-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.category === categoryName);
  });
}

function _setProductsHeading(title, count) {
  const heading = document.getElementById("productsHeading");
  const countEl = document.getElementById("productsCount");
  if (heading) heading.textContent = title;
  if (countEl) countEl.textContent = `${count} item${count !== 1 ? "s" : ""}`;
}

// One product card markup for both category and search views.
function _buildProductCard(product, categoryName, { showCategory = false } = {}) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "product-card";
  const unavailable = product.unavailable === true;
  if (unavailable) {
    card.classList.add("unavailable-product");
    card.setAttribute("aria-disabled", "true");
  }
  card.dataset.productName = product.name;
  card.dataset.categoryName = categoryName;
  card.dataset.price = product.price || 0;
  card.dataset.addons = JSON.stringify(product.addons || []);
  card.dataset.unavailable = String(unavailable);

  const tags = [];
  if (unavailable) tags.push('<span class="tag tag-danger">Unavailable</span>');
  else {
    if (product.hasVariants) tags.push('<span class="tag">Half / Full</span>');
    if (product.addons && product.addons.length > 0) tags.push('<span class="tag">+ Add-ons</span>');
  }

  const price = product.hasVariants && product.halfPrice
    ? `${formatMoney(product.halfPrice, "auto")} – ${formatMoney(product.price || 0, "auto")}`
    : formatMoney(product.price || 0, "auto");

  card.innerHTML = `
    ${showCategory ? `<span class="product-card-cat">${escapeHTML(categoryName)}</span>` : ""}
    <span class="product-card-name">${escapeHTML(product.name)}</span>
    <span class="product-card-foot">
      <span class="product-card-price">${price}</span>
      <span class="product-card-tags">${tags.join("")}</span>
    </span>`;
  card.setAttribute("aria-label", `${product.name}, ${price}${unavailable ? ", unavailable" : ""}`);
  return card;
}

function loadProducts(categoryName) {
  const searchInput = document.getElementById("productSearch");
  if (searchInput) searchInput.value = "";
  const clearBtn = document.getElementById("clearSearchBtn");
  if (clearBtn) clearBtn.style.display = "none";

  if (!Array.isArray(currentMenu)) return;
  const category = currentMenu.find(c => c.name === categoryName);
  if (!category) return;

  if (!Array.isArray(category.products)) {
    console.error("Invalid category data: products is not an array");
    return;
  }

  _activeCategory = categoryName;
  _markActiveCategory(categoryName);

  const div = document.getElementById("products");
  if (!div) return;
  const frag = document.createDocumentFragment();
  category.products.forEach(product => frag.appendChild(_buildProductCard(product, categoryName)));
  div.replaceChildren(frag);
  div.scrollTop = 0;
  _setProductsHeading(categoryName, category.products.length);
}

// Event delegation for the product grid
const productsContainer = document.getElementById("products");
if (productsContainer) {
  productsContainer.addEventListener("click", (e) => {
    const productCard = e.target.closest(".product-card");
    if (!productCard) return;

    const { productName, categoryName, price, addons, unavailable } = productCard.dataset;

    if (unavailable === "true") {
      showToast("This item is currently unavailable", "error");
      return;
    }

    let addonList = [];
    try { addonList = JSON.parse(addons || "[]"); } catch (_) { addonList = []; }

    productCard.classList.add("just-added");
    setTimeout(() => productCard.classList.remove("just-added"), 450);
    selectProduct(productName, categoryName, parseFloat(price), addonList);
  });
}

function searchProducts(query) {
  const clearBtn = document.getElementById("clearSearchBtn");
  const productsDiv = document.getElementById("products");

  if (!query || query.trim() === "") {
    if (clearBtn) clearBtn.style.display = "none";
    const cat = _activeCategory || (Array.isArray(currentMenu) && currentMenu[0]?.name);
    if (cat) loadProducts(cat);
    return;
  }

  if (clearBtn) clearBtn.style.display = "inline-flex";

  if (!Array.isArray(currentMenu) || !productsDiv) return;

  const q = query.trim().toLowerCase();
  const results = [];

  currentMenu.forEach(cat => {
    if (!Array.isArray(cat.products)) return;
    cat.products.forEach(product => {
      if (product?.name?.toLowerCase().includes(q)) {
        results.push({ product, categoryName: cat.name });
      }
    });
  });

  // Names that start with the query first, then the rest.
  results.sort((a, b) => {
    const as = a.product.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bs = b.product.name.toLowerCase().startsWith(q) ? 0 : 1;
    return as - bs;
  });

  _markActiveCategory(null);
  _setProductsHeading(`Results for “${query.trim()}”`, results.length);

  if (results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "no-search-results";
    empty.append("No items found for ");
    const strong = document.createElement("strong");
    strong.textContent = `“${query.trim()}”`;   // textContent — the query is user input
    empty.appendChild(strong);
    productsDiv.replaceChildren(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  results.forEach(({ product, categoryName }) => frag.appendChild(_buildProductCard(product, categoryName, { showCategory: true })));
  productsDiv.replaceChildren(frag);
  productsDiv.scrollTop = 0;
}

// Enter in the search box adds the first available result (fast keyboard ordering).
function addFirstSearchResult() {
  const first = document.querySelector('#products .product-card:not(.unavailable-product)');
  if (first) first.click();
  return !!first;
}

function openMenuManager() {
  openModal("menuModal");
  refreshManagerDropdowns();
}

function closeMenuManager() {
  closeModal("menuModal");
}

function showMenuTab(tab, clickedBtn) {
  const views = ["menuCategoriesTab", "menuProductsTab", "menuAddonsTab"];
  views.forEach(viewId => {
    const viewEl = document.getElementById(viewId);
    if (viewEl) viewEl.style.display = viewId === `menu${tab.charAt(0).toUpperCase() + tab.slice(1)}Tab` ? "block" : "none";
  });
  document.querySelectorAll(".menu-tabs .tab-btn").forEach(b => b.classList.remove("active"));
  const activeTab = document.getElementById(`menu${tab.charAt(0).toUpperCase() + tab.slice(1)}Tab`);
  if (activeTab) activeTab.style.display = "block";
  if (clickedBtn) clickedBtn.classList.add("active");
}

async function refreshManagerDropdowns(preloadedCategories) {
  try {
    if (Array.isArray(preloadedCategories)) {
      currentMenu = preloadedCategories;   // avoid a second getMenu round-trip
    } else {
      const response = await window.electronAPI.getMenu();
      if (!response.success) {
        console.error("Failed to load menu:", response.error);
        return;
      }
      const menu = response.data;
      currentMenu = Array.isArray(menu?.categories)
        ? menu.categories
        : [];
    }

    populateCategorySelects();
    renderCategoryManagementList();

    updateEditProductDropdown();
    updateDeleteProductDropdown();
    updateAddonProductDropdown();
    updateRemoveAddonProductDropdown();
    renderProductAvailabilityList();
  } catch (error) {
    console.error("refreshManagerDropdowns error:", error);
    showToast("Failed to refresh menu manager", "error");
  }
}

function populateCategorySelects() {
  const categorySelects = [
    document.getElementById("productCategorySelect"),
    document.getElementById("editProductCategorySelect"),
    document.getElementById("deleteProductCategorySelect"),
    document.getElementById("addonCategorySelect"),
    document.getElementById("removeAddonCategorySelect"),
    document.getElementById("renameCategorySelect"),
    document.getElementById("availabilityCategorySelect")
  ];

  categorySelects.forEach(selectEl => {
    if (!selectEl) return;
    const previous = selectEl.value;   // keep the manager's current choice after a refresh
    selectEl.replaceChildren();
    currentMenu.forEach(cat => appendOption(selectEl, cat.name, cat.name));
    if (previous && currentMenu.some(c => c.name === previous)) selectEl.value = previous;
  });
}

function _manageRow(labelText, metaText, button) {
  const row = document.createElement("div");
  row.className = "manage-item";
  const text = document.createElement("span");
  text.className = "manage-item-text";
  const label = document.createElement("span");
  label.className = "manage-item-label";
  label.textContent = labelText;
  text.appendChild(label);
  if (metaText) {
    const meta = document.createElement("span");
    meta.className = "manage-item-meta";
    meta.textContent = metaText;
    text.appendChild(meta);
  }
  row.append(text, button);
  return row;
}

function renderCategoryManagementList() {
  const catList = document.getElementById("categoryManagementList");
  if (!catList) return;

  catList.replaceChildren();
  currentMenu.forEach(cat => {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-danger-soft btn-sm";
    deleteBtn.innerHTML = `${icon("trash", "icon-sm")}Delete`;
    deleteBtn.onclick = () => deleteCategory(cat.name);
    const n = (cat.products || []).length;
    catList.appendChild(_manageRow(cat.name, `${n} product${n !== 1 ? "s" : ""}`, deleteBtn));
  });
}

function renderProductAvailabilityList() {
  const categorySelect = document.getElementById("availabilityCategorySelect");
  const availabilityList = document.getElementById("productAvailabilityList");
  if (!categorySelect || !availabilityList) return;

  availabilityList.replaceChildren();
  const category = currentMenu.find(c => c.name === categorySelect.value);
  if (!category || !Array.isArray(category.products) || category.products.length === 0) {
    availabilityList.innerHTML = "<p class='no-data'>No products in this category</p>";
    return;
  }

  category.products.forEach(product => {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = product.unavailable ? "btn btn-danger-soft btn-sm" : "btn btn-secondary btn-sm";
    toggleBtn.innerHTML = product.unavailable
      ? `${icon("x", "icon-sm")}Unavailable`
      : `${icon("check", "icon-sm")}Available`;
    toggleBtn.title = product.unavailable ? "Tap to make available" : "Tap to mark unavailable";
    const row = _manageRow(product.name, formatMoney(product.price || 0), toggleBtn);
    if (product.unavailable) row.classList.add("is-unavailable");
    toggleBtn.dataset.category = category.name;
    toggleBtn.dataset.product = product.name;
    toggleBtn.onclick = function() {
      toggleProductAvailability(this.dataset.category, this.dataset.product);
    };

    availabilityList.appendChild(row);
  });
}

// Refill a <select> with [value, label] pairs, keeping the current choice when it still exists.
function _fillSelect(selectEl, options) {
  if (!selectEl) return;
  const previous = selectEl.value;
  selectEl.replaceChildren();
  options.forEach(([value, label]) => appendOption(selectEl, value, label));
  if (previous && options.some(([value]) => value === previous)) selectEl.value = previous;
}

function updateEditProductDropdown() {
  if (!Array.isArray(currentMenu)) {
    console.error("currentMenu is not an array in updateEditProductDropdown");
    return;
  }

  const category = document.getElementById("editProductCategorySelect").value;
  const categoryObj = currentMenu.find(c => c.name === category);
  _fillSelect(document.getElementById("editProductSelect"),
    (categoryObj?.products || []).map(p => [p.name, `${p.name} · ${formatMoney(p.price || 0, "auto")}`]));
}

function updateDeleteProductDropdown() {
  if (!Array.isArray(currentMenu)) {
    console.error("currentMenu is not an array in updateDeleteProductDropdown");
    return;
  }

  const category = document.getElementById("deleteProductCategorySelect").value;
  const categoryObj = currentMenu.find(c => c.name === category);
  _fillSelect(document.getElementById("deleteProductSelect"),
    (categoryObj?.products || []).map(p => [p.name, p.name]));
}

document.getElementById("editProductCategorySelect").addEventListener("change", updateEditProductDropdown);

document.getElementById("deleteProductCategorySelect").addEventListener("change", updateDeleteProductDropdown);

async function addCategory() {
  try {
    const nameEl = document.getElementById("newCategoryName");
    if (!nameEl) return; // DOM safety

    const categoryName = nameEl.value.trim();
    if (!categoryName) {
      showToast("Category name cannot be empty", "error");
      return;
    }

    if (currentMenu.some(c => c.name.toLowerCase() === categoryName.toLowerCase())) {
      showToast("Category already exists!", "error");
      return;
    }

    const result = await window.electronAPI.addCategory( categoryName);
    if (!result || !result.success) {
      showToast(result?.error || "Failed to add category", "error");
      return;
    }
    
    nameEl.value = "";
    await loadCategories();
    showToast("Category added successfully!");
  } catch (error) {
    console.error("addCategory error:", error);
    showToast("Failed to add category", "error");
  }
}

async function deleteCategory(categoryName) {
  showConfirmModal(
    `Delete category "${categoryName}"? All products in this category will also be deleted.`,
    async () => {
      try {
        const response = await window.electronAPI.deleteCategory( categoryName);
        if (response.success) {
          showToast("Category deleted!");
          await loadCategories();
          await refreshManagerDropdowns();
        } else {
          showToast(response.error || "Failed to delete category", "error");
        }
      } catch (error) {
        console.error("deleteCategory error:", error);
        showToast("Failed to delete category", "error");
      }
    }
  );
}

async function renameCategory() {
  try {
    const oldName = document.getElementById("renameCategorySelect").value;
    const newName = document.getElementById("newCategoryNameRename").value.trim();

    if (!oldName || !newName) {
      showToast("Please select category and enter new name", "error");
      return;
    }
    if (oldName === newName) {
      showToast("New name is same as current name", "error");
      return;
    }

    const response = await window.electronAPI.renameCategory( oldName, newName);
    if (response.success) {
      showToast("Category renamed!");
      document.getElementById("newCategoryNameRename").value = "";
      await loadCategories();
      await refreshManagerDropdowns();
    } else {
      showToast(response.error || "Failed to rename category", "error");
    }
  } catch (error) {
    console.error("renameCategory error:", error);
    showToast("Failed to rename category", "error");
  }
}

function toggleVariantFields() {
  const toggle = document.getElementById("hasVariantsToggle");
  const fields = document.getElementById("variantFields");
  if (!toggle || !fields) return;
  fields.style.display = toggle.checked ? "flex" : "none";
}

async function addProduct() {
  try {
    const categoryEl = document.getElementById("productCategorySelect");
    const nameEl = document.getElementById("newProductName");
    const priceEl = document.getElementById("newProductPrice");
    const hasVariantsEl = document.getElementById("hasVariantsToggle");
    const halfPriceEl = document.getElementById("halfPriceInput");
    const variantFieldsEl = document.getElementById("variantFields");
    
    if (!categoryEl || !nameEl || !priceEl || !hasVariantsEl || !halfPriceEl || !variantFieldsEl) return; // DOM safety
    
    const category = categoryEl.value;
    const name = nameEl.value.trim();
    const price = parseFloat(priceEl.value);
    const hasVariants = hasVariantsEl.checked;
    const parsedHalfPrice = parseFloat(halfPriceEl.value);
    const halfPrice = hasVariants ? (isNaN(parsedHalfPrice) ? 0 : parsedHalfPrice) : null;
    
    if (!category) {
      showToast("Please select a category", "error");
      return;
    }
    if (!name) {
      showToast("Product name cannot be empty", "error");
      return;
    }
    if (isNaN(price) || price < 0) {
      showToast("Please enter a valid price (0 or more)", "error");
      return;
    }
    if (hasVariants && halfPrice < 0) {
      showToast("Please enter a valid half price (0 or more)", "error");
      return;
    }

    const newProduct = {
      name: name,
      price: price,
      halfPrice: hasVariants ? halfPrice : null,
      hasVariants: hasVariants,
      addons: []
    };

    const result = await window.electronAPI.addProduct( category, newProduct);
    
    if (!result || !result.success) {
      showToast(result?.error || "Failed to add product", "error");
      return;
    }
    
    nameEl.value = "";
    priceEl.value = "";
    hasVariantsEl.checked = false;
    variantFieldsEl.style.display = "none";
    halfPriceEl.value = "";
    await loadCategories();
    showToast("Product added successfully!");
  } catch (error) {
    console.error("addProduct error:", error);
    showToast("Failed to add product. Please try again.", "error");
  }
}

async function editProductPrice() {
  const category = document.getElementById("editProductCategorySelect").value;
  const productName = document.getElementById("editProductSelect").value;
  const price = parseFloat(document.getElementById("editProductPrice").value);
  
  if (!category || !productName) {
    showToast("Please select category and product", "error");
    return;
  }
  if (isNaN(price) || price < 0) {
    showToast("Please enter a valid price (0 or more)", "error");
    return;
  }
  
  try {
    if (!category || !productName) return; // DOM safety
    const halfPriceEl = document.getElementById("editHalfProductPrice");
    const halfPrice = halfPriceEl?.value ? parseFloat(halfPriceEl.value) : null;
    const response = await window.electronAPI.editProductPrice( category, productName, price, halfPrice);
    if (!response.success) {
      console.error("Failed to edit product price:", response.error);
      showToast(`Failed to edit price: ${response.error}`, "error");
      return;
    }
    document.getElementById("editProductPrice").value = "";
    const halfEl = document.getElementById("editHalfProductPrice");
    if (halfEl) halfEl.value = "";
    await loadCategories();
    showToast("Price updated successfully!");
  } catch (error) {
    showToast("Failed to edit product price", "error");
  }
}

async function deleteProduct() {
  const category = document.getElementById("deleteProductCategorySelect").value;
  const productName = document.getElementById("deleteProductSelect").value;
  
  if (!category || !productName) {
    showToast("Please select a product to delete", "error");
    return;
  }

  showConfirmModal(
    `Delete product "${productName}" from ${category}?`,
    async () => {
      try {
        const response = await window.electronAPI.deleteProduct( category, productName);
        if (response.success) {
          showToast("Product deleted!");
          await loadCategories();
          await refreshManagerDropdowns();
        } else {
          showToast(response.error || "Failed to delete product", "error");
        }
      } catch (error) {
        console.error("deleteProduct error:", error);
        showToast("Failed to delete product", "error");
      }
    }
  );
}

function updateAddonProductDropdown() {
  if (!Array.isArray(currentMenu)) return;
  const category = document.getElementById("addonCategorySelect").value;
  const categoryObj = currentMenu.find(c => c.name === category);
  _fillSelect(document.getElementById("addonProductSelect"),
    (categoryObj?.products || []).map(p => [p.name, p.name]));
}

async function addAddon() {
  try {
    const categoryEl = document.getElementById("addonCategorySelect");
    const productNameEl = document.getElementById("addonProductSelect");
    const nameEl = document.getElementById("addonName");
    const priceEl = document.getElementById("addonPrice");
    
    if (!categoryEl || !productNameEl || !nameEl || !priceEl) return; // DOM safety
    
    const category = categoryEl.value;
    const productName = productNameEl.value;
    const name = nameEl.value.trim();
    const price = parseFloat(priceEl.value);
    
    if (!category || !productName) {
      showToast("Please select category and product", "error");
      return;
    }
    if (!name) {
      showToast("Addon name cannot be empty", "error");
      return;
    }
    if (isNaN(price) || price < 0) {
      showToast("Please enter a valid price (0 or more)", "error");
      return;
    }
    
    const result = await window.electronAPI.addAddon( category, productName, { name, price });
    if (!result || !result.success) {
      showToast(result?.error || "Failed to add add-on", "error");
      return;
    }
    
    nameEl.value = "";
    priceEl.value = "";
    await loadCategories();
    showToast("Add-on added successfully!");
  } catch (error) {
    console.error("addAddon error:", error);
    showToast("Failed to add add-on", "error");
  }
}

function updateRemoveAddonProductDropdown() {
  if (!Array.isArray(currentMenu)) {
    console.error("currentMenu is not an array in updateRemoveAddonProductDropdown");
    return;
  }
  
  const category = document.getElementById("removeAddonCategorySelect").value;
  const cat = currentMenu.find(c => c.name === category);
  // Only products that actually have add-ons
  const productsWithAddons = (cat?.products || []).filter(p => p.addons && p.addons.length > 0);
  _fillSelect(document.getElementById("removeAddonProductSelect"),
    productsWithAddons.map(p => [p.name, p.name]));
  updateRemoveAddonDropdown();
}

function updateRemoveAddonDropdown() {
  if (!Array.isArray(currentMenu)) return;
  const category = document.getElementById("removeAddonCategorySelect").value;
  const productName = document.getElementById("removeAddonProductSelect").value;
  const cat = currentMenu.find(c => c.name === category);
  const product = cat?.products?.find(p => p.name === productName);
  _fillSelect(document.getElementById("removeAddonSelect"),
    (product?.addons || []).map(a => [a.name, `${a.name} (${formatMoney(a.price, "auto")})`]));
}

document.getElementById("removeAddonProductSelect").addEventListener("change", updateRemoveAddonDropdown);

async function removeAddon() {
  try {
    const category = document.getElementById("removeAddonCategorySelect").value;
    const productName = document.getElementById("removeAddonProductSelect").value;
    const addonName = document.getElementById("removeAddonSelect").value;
    
    if (!category || !productName || !addonName) {
      showToast("Please select an add-on to remove", "error");
      return;
    }

    showConfirmModal(`Are you sure you want to remove the "${addonName}" add-on from "${productName}"?`, async () => {
      try {
        const response = await window.electronAPI.removeAddon( category, productName, addonName);
        if (!response.success) {
          console.error("Failed to remove addon:", response.error);
          showToast(`Failed to remove addon: ${response.error}`, "error");
          return;
        }
        await loadCategories();
        showToast("Add-on removed!");
      } catch (error) {
        showToast("Failed to remove add-on", "error");
      }
    });
  } catch (error) {
    showToast("Failed to remove add-on", "error");
  }
}

async function toggleProductAvailability(categoryName, productName) {
  try {
    const response = await window.electronAPI.toggleProductAvailability( categoryName, productName);
    if (!response.success) {
      showToast(response.error || "Failed to update availability", "error");
      return;
    }

    showToast(response.data?.unavailable ? "Product marked as unavailable" : "Product marked as available");
    await loadCategories();
    await refreshManagerDropdowns();
  } catch (error) {
    console.error("toggleProductAvailability error:", error);
    showToast("Failed to update availability", "error");
  }
}

registerModal("menuModal", closeMenuManager);
