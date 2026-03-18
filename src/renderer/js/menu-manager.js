// ================= MENU MANAGEMENT =================

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
    div.innerHTML = "";
    currentMenu.forEach(cat => {
      const btn = document.createElement("button");
      btn.className = "category-btn";
      btn.innerText = escapeHTML(cat.name);
      btn.onclick = () => loadProducts(cat.name);
      div.appendChild(btn);
    });
    
    if (currentMenu.length > 0) {
      loadProducts(currentMenu[0].name);
    }
    
    refreshManagerDropdowns();
  } catch (error) {
    showToast("Failed to load menu. Please restart the app.", "error");
  }
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
  
  const div = document.getElementById("products");
  div.innerHTML = "";

  document.querySelectorAll(".category-btn").forEach(btn => {
    btn.classList.toggle("active", btn.innerText === categoryName);
  });
  
  category.products.forEach(product => {
    const card = document.createElement("div");
    card.className = "product-card";
    if (product.unavailable === true) {
      card.classList.add("unavailable-product");
    }
    card.dataset.productName = product.name;
    card.dataset.categoryName = categoryName;
    card.dataset.price = product.price || 0;
    card.dataset.addons = JSON.stringify(product.addons || []);
    card.dataset.unavailable = !!product.unavailable;

    card.innerHTML = `
      <h4>${escapeHTML(product.name)}</h4>
      <p class="price">₹${(product.price || 0).toFixed(2)}</p>
      ${product.addons && product.addons.length > 0 ? '<p class="has-addons">+ Add-ons available</p>' : ''}
    `;
    div.appendChild(card);
  });
}

// Initializing event delegation for product grid
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

    selectProduct(productName, categoryName, parseFloat(price), JSON.parse(addons));
  });
}

function searchProducts(query) {
  const clearBtn = document.getElementById("clearSearchBtn");
  const productsDiv = document.getElementById("products");
  
  if (!query || query.trim() === "") {
    if (clearBtn) clearBtn.style.display = "none";
    const activeCat = document.querySelector(".category-btn.active");
    if (activeCat) loadProducts(activeCat.innerText);
    return;
  }
  
  if (clearBtn) clearBtn.style.display = "block";
  
  if (!Array.isArray(currentMenu) || !productsDiv) return;
  
  const q = query.trim().toLowerCase();
  const results = [];
  
  currentMenu.forEach(cat => {
    if (!Array.isArray(cat.products)) return;
    cat.products.forEach(product => {
      if (product?.name?.toLowerCase().includes(q)) {
        results.push({ ...product, categoryName: cat.name });
      }
    });
  });
  
  productsDiv.innerHTML = "";
  
  if (results.length === 0) {
    productsDiv.innerHTML = `<div class="no-search-results">No items found for "<strong>${query}</strong>"</div>`;
    return;
  }
  
  results.forEach(product => {
    const card = document.createElement("div");
    card.className = "product-card";
    if (product.unavailable === true) {
      card.classList.add("unavailable-product");
    }
    card.dataset.productName = product.name;
    card.dataset.categoryName = product.categoryName;
    card.dataset.price = product.price || 0;
    card.dataset.addons = JSON.stringify(product.addons || []);
    card.dataset.unavailable = !!product.unavailable;

    card.innerHTML = `
      <div class="product-category-tag">${escapeHTML(product.categoryName)}</div>
      <div class="product-name">${escapeHTML(product.name)}</div>
      <div class="product-price">₹${(product.price || 0).toFixed(2)}</div>
    `;
    productsDiv.appendChild(card);
  });
}

function openMenuManager() {
  document.getElementById("menuModal").style.display = "block";
  refreshManagerDropdowns();
}

function closeMenuManager() {
  document.getElementById("menuModal").style.display = "none";
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

async function refreshManagerDropdowns() {
  try {
    const response = await window.electronAPI.getMenu();
    if (!response.success) {
      console.error("Failed to load menu:", response.error);
      return;
    }
    const menu = response.data;
    currentMenu = Array.isArray(menu?.categories)
      ? menu.categories
      : [];

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
    selectEl.innerHTML = "";
    currentMenu.forEach(cat => appendOption(selectEl, cat.name, cat.name));
  });
}

function renderCategoryManagementList() {
  const catList = document.getElementById("categoryManagementList");
  if (!catList) return;

  catList.innerHTML = "";
  currentMenu.forEach(cat => {
    const row = document.createElement("div");
    row.className = "manage-item";

    const label = document.createElement("span");
    label.textContent = `${cat.name} (${(cat.products || []).length} products)`;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "danger-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.onclick = () => deleteCategory(cat.name);

    row.appendChild(label);
    row.appendChild(deleteBtn);
    catList.appendChild(row);
  });
}

function renderProductAvailabilityList() {
  const categorySelect = document.getElementById("availabilityCategorySelect");
  const availabilityList = document.getElementById("productAvailabilityList");
  if (!categorySelect || !availabilityList) return;

  availabilityList.innerHTML = "";
  const category = currentMenu.find(c => c.name === categorySelect.value);
  if (!category || !Array.isArray(category.products) || category.products.length === 0) {
    availabilityList.innerHTML = "<p class='no-data'>No products in this category</p>";
    return;
  }

  category.products.forEach(product => {
    const row = document.createElement("div");
    row.className = "manage-item";

    const label = document.createElement("span");
    label.textContent = `${product.name} - ₹${(product.price || 0).toFixed(2)}`;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = product.unavailable ? "danger-btn" : "secondary-btn";
    toggleBtn.innerText = product.unavailable ? "🚫 Unavailable" : "✅ Available";
    toggleBtn.dataset.category = category.name;
    toggleBtn.dataset.product = product.name;
    toggleBtn.onclick = function() {
      toggleProductAvailability(this.dataset.category, this.dataset.product);
    };

    row.appendChild(label);
    row.appendChild(toggleBtn);
    availabilityList.appendChild(row);
  });
}

function updateEditProductDropdown() {
  if (!Array.isArray(currentMenu)) {
    console.error("currentMenu is not an array in updateEditProductDropdown");
    return;
  }
  
  const category = document.getElementById("editProductCategorySelect").value;
  const productSelect = document.getElementById("editProductSelect");
  productSelect.innerHTML = "";
  
  const categoryObj = currentMenu.find(c => c.name === category);
  if (categoryObj) {
    categoryObj.products.forEach(p => {
      appendOption(productSelect, p.name, `${p.name} - ₹${p.price}`);
    });
  }
}

function updateDeleteProductDropdown() {
  if (!Array.isArray(currentMenu)) {
    console.error("currentMenu is not an array in updateDeleteProductDropdown");
    return;
  }
  
  const category = document.getElementById("deleteProductCategorySelect").value;
  const productSelect = document.getElementById("deleteProductSelect");
  productSelect.innerHTML = "";
  
  const categoryObj = currentMenu.find(c => c.name === category);
  if (categoryObj) {
    categoryObj.products.forEach(p => {
      appendOption(productSelect, p.name, p.name);
    });
  }
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
  const productSelect = document.getElementById("addonProductSelect");
  productSelect.innerHTML = "";
  
  const categoryObj = currentMenu.find(c => c.name === category);
  if (categoryObj) {
    categoryObj.products.forEach(p => {
      appendOption(productSelect, p.name, p.name);
    });
  }
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
  const productSelect = document.getElementById("removeAddonProductSelect");
  productSelect.innerHTML = "";
  
  const cat = currentMenu.find(c => c.name === category);
  if (cat) {
    // Filter for products that have addons
    const productsWithAddons = cat.products.filter(p => p.addons && p.addons.length > 0);
    productsWithAddons.forEach(p => {
      appendOption(productSelect, p.name, p.name);
    });
  }
  // Automatically update the next dropdown, using a timeout to prevent a race condition
          // where the DOM hasn't updated the product dropdown's value yet.
          setTimeout(updateRemoveAddonDropdown, 0);
        }

function updateRemoveAddonDropdown() {
  if (!Array.isArray(currentMenu)) return;
  const category = document.getElementById("removeAddonCategorySelect").value;
  const productName = document.getElementById("removeAddonProductSelect").value;
  const addonSelect = document.getElementById("removeAddonSelect");
  addonSelect.innerHTML = "";

  const cat = currentMenu.find(c => c.name === category);
  if (cat) {
    const product = cat.products.find(p => p.name === productName);
    if (product && product.addons) {
      product.addons.forEach(addon => {
        appendOption(addonSelect, addon.name, `${addon.name} (₹${addon.price})`);
      });
    }
  }
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
