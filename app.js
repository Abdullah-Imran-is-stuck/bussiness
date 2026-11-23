// ─────────────────────────────────────────────────────────────────────────────
// VOID storefront configuration — replace these values before accepting orders.
// Formspree sends the email alert; the webhook can be a Make, Zapier, or Apps
// Script endpoint that writes the same structured order into Google Sheets.
// ─────────────────────────────────────────────────────────────────────────────
const FORMSPREE_ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID";
const WEBHOOK_URL = "https://your-webhook-url-here.com";
// Optional: add the international WhatsApp number with country code, digits only.
// Example format: "15551234567". Leave blank to hide the WhatsApp fallback.
const WHATSAPP_NUMBER = "";
// BaaS extension point: initialize Supabase or Firebase here later if you want
// authenticated accounts, inventory sync, or a server-side order database.

// Keep the catalog, cart, and active filter in one small client-side state object.
const state = {
  products: [],
  cart: loadCart(),
  activeCategory: "All",
  searchTerm: ""
};

// Cache frequently used elements once so event handlers can update the page quickly.
const ui = {
  productGrid: document.querySelector("#productGrid"),
  categoryFilters: document.querySelector("#categoryFilters"),
  resultCount: document.querySelector("#resultCount"),
  searchInput: document.querySelector("#searchInput"),
  cartCount: document.querySelector("#cartCount"),
  drawerCount: document.querySelector("#drawerCount"),
  cartDrawer: document.querySelector("#cartDrawer"),
  cartScrim: document.querySelector("#cartScrim"),
  cartItems: document.querySelector("#cartItems"),
  cartSubtotal: document.querySelector("#cartSubtotal"),
  cartTotal: document.querySelector("#cartTotal"),
  shippingLabel: document.querySelector("#shippingLabel"),
  checkoutForm: document.querySelector("#checkoutForm"),
  submitOrder: document.querySelector("#submitOrder"),
  checkoutStatus: document.querySelector("#checkoutStatus"),
  whatsappFallback: document.querySelector("#whatsappFallback"),
  toast: document.querySelector("#toast")
};

// Format all prices consistently in the storefront currency.
const money = (amount) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD"
}).format(amount);

// Read previously saved cart data and recover safely if storage is unavailable.
function loadCart() {
  try {
    const savedCart = JSON.parse(localStorage.getItem("void-cart") || "[]");
    return Array.isArray(savedCart) ? savedCart : [];
  } catch (error) {
    console.warn("VOID could not read the saved cart.", error);
    return [];
  }
}

// Save every cart change so refreshes preserve chosen products and sizes.
function saveCart() {
  try {
    localStorage.setItem("void-cart", JSON.stringify(state.cart));
  } catch (error) {
    console.warn("VOID could not save the cart in this browser.", error);
  }
}

// Calculate total pieces and merchandise value from the current cart lines.
function getCartTotals() {
  return state.cart.reduce((totals, line) => {
    const product = state.products.find((item) => item.id === line.productId);
    if (!product) return totals;
    totals.quantity += line.quantity;
    totals.subtotal += product.price * line.quantity;
    return totals;
  }, { quantity: 0, subtotal: 0 });
}

// Build category pills from the catalog, then add an All option at the front.
function renderFilters() {
  const categories = ["All", ...new Set(state.products.map((product) => product.category))];
  ui.categoryFilters.innerHTML = categories.map((category) => `
    <button class="filter-btn ${state.activeCategory === category ? "active" : ""}"
      type="button" data-category="${escapeHtml(category)}" aria-pressed="${state.activeCategory === category}">
      ${escapeHtml(category === "All" ? "All pieces" : category)}
    </button>`).join("");
}

// Escape catalog text before it is inserted into HTML attributes or content.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

// Return catalog entries that match both the selected category and search text.
function getVisibleProducts() {
  const query = state.searchTerm.trim().toLowerCase();
  return state.products.filter((product) => {
    const matchesCategory = state.activeCategory === "All" || product.category === state.activeCategory;
    const searchableText = `${product.name} ${product.category} ${product.description}`.toLowerCase();
    return matchesCategory && (!query || searchableText.includes(query));
  });
}

// Build product cards with size selectors and add-to-bag actions.
function renderProducts() {
  const products = getVisibleProducts();
  ui.resultCount.textContent = `${String(products.length).padStart(2, "0")} pieces`;
  if (!products.length) {
    ui.productGrid.innerHTML = '<div class="empty-state"><strong>Nothing in this orbit.</strong>Try another category or search.</div>';
    return;
  }

  ui.productGrid.innerHTML = products.map((product, index) => `
    <article class="product-card">
      <div class="product-visual" data-tilt>
        <img src="${escapeHtml(product.images[0])}" alt="${escapeHtml(product.name)}" loading="lazy">
        <span class="product-number">VOID / ${String(index + 1).padStart(2, "0")}</span>
        <span class="stock-mark">${product.inStock ? "In rotation" : "Sold out"}</span>
        <button class="quick-view" type="button" data-quick-view="${escapeHtml(product.id)}" aria-label="View ${escapeHtml(product.name)} details">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      <div class="product-info">
        <div class="product-overline"><span>${escapeHtml(product.category)}</span><span>Essential / ${String(index + 1).padStart(2, "0")}</span></div>
        <div class="product-name-row"><h3>${escapeHtml(product.name)}</h3><span class="product-price">${money(product.price)}</span></div>
        <p class="product-description">${escapeHtml(product.description)}</p>
        <div class="product-controls">
          <select class="size-select" aria-label="Choose a size for ${escapeHtml(product.name)}" data-size-for="${escapeHtml(product.id)}" ${product.inStock ? "" : "disabled"}>
            ${product.sizes.map((size) => `<option value="${escapeHtml(size)}">Size / ${escapeHtml(size)}</option>`).join("")}
          </select>
          <button class="add-button" type="button" data-add-to-cart="${escapeHtml(product.id)}" ${product.inStock ? "" : "disabled"}>
            ${product.inStock ? "Add to bag +" : "Currently unavailable"}
          </button>
        </div>
      </div>
    </article>`).join("");

  // Reveal cards as they enter view; browsers without IntersectionObserver show them immediately.
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          currentObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    ui.productGrid.querySelectorAll(".product-card").forEach((card) => observer.observe(card));
  } else {
    ui.productGrid.querySelectorAll(".product-card").forEach((card) => card.classList.add("visible"));
  }
  attachTiltToCards();
}

// Add a product and size as one line, or increase the matching line quantity.
function addToCart(productId, size) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || !product.inStock) return;
  const matchingLine = state.cart.find((line) => line.productId === productId && line.size === size);
  if (matchingLine) matchingLine.quantity += 1;
  else state.cart.push({ productId, size, quantity: 1 });
  saveCart();
  renderCart();
  // Give the bag badge a quick spring so the add action has immediate feedback.
  const cartIcon = document.querySelector(".cart-icon");
  cartIcon.classList.remove("pop");
  void cartIcon.offsetWidth;
  cartIcon.classList.add("pop");
  showToast(`${product.name} / ${size} added to your bag`);
}

// Change one line's count; removing the last piece also removes the line.
function changeQuantity(productId, size, delta) {
  const line = state.cart.find((item) => item.productId === productId && item.size === size);
  if (!line) return;
  line.quantity += delta;
  if (line.quantity <= 0) state.cart = state.cart.filter((item) => item !== line);
  saveCart();
  renderCart();
}

// Remove a chosen size line from the cart.
function removeLine(productId, size) {
  state.cart = state.cart.filter((line) => !(line.productId === productId && line.size === size));
  saveCart();
  renderCart();
}

// Repaint the bag, badge, subtotal, and estimated total from the saved state.
function renderCart() {
  const totals = getCartTotals();
  ui.cartCount.textContent = totals.quantity;
  ui.drawerCount.textContent = `(${totals.quantity})`;
  ui.cartSubtotal.textContent = money(totals.subtotal);
  ui.cartTotal.textContent = money(totals.subtotal);
  ui.shippingLabel.textContent = totals.subtotal >= 150 ? "Complimentary" : "Calculated at checkout";
  ui.submitOrder.disabled = totals.quantity === 0;

  if (!state.cart.length) {
    ui.cartItems.innerHTML = '<div class="cart-empty"><div><strong>Your bag is taking a breather.</strong>Find something that feels like you.</div></div>';
    return;
  }

  ui.cartItems.innerHTML = state.cart.map((line) => {
    const product = state.products.find((item) => item.id === line.productId);
    if (!product) return "";
    return `
      <article class="cart-line">
        <img src="${escapeHtml(product.images[0])}" alt="${escapeHtml(product.name)}">
        <div class="cart-line-info"><strong>${escapeHtml(product.name)}</strong><small>Size / ${escapeHtml(line.size)}</small>
          <div class="quantity-control"><button type="button" data-quantity="-1" data-product="${escapeHtml(product.id)}" data-size="${escapeHtml(line.size)}" aria-label="Decrease quantity">−</button><span>${line.quantity}</span><button type="button" data-quantity="1" data-product="${escapeHtml(product.id)}" data-size="${escapeHtml(line.size)}" aria-label="Increase quantity">+</button></div>
        </div>
        <div class="cart-line-end"><b>${money(product.price * line.quantity)}</b><button class="remove-item" type="button" data-remove="${escapeHtml(product.id)}" data-size="${escapeHtml(line.size)}">Remove</button></div>
      </article>`;
  }).join("");
}

// Show or hide the cart drawer and lock background scrolling while it's open.
function setCartOpen(isOpen) {
  ui.cartDrawer.classList.toggle("open", isOpen);
  ui.cartScrim.classList.toggle("open", isOpen);
  ui.cartDrawer.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("locked", isOpen);
  if (isOpen) document.querySelector("#closeCart").focus();
}

// Display short feedback after an add-to-bag action.
let toastTimer;
function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("show"), 2300);
}

// Only treat non-placeholder endpoints as configured destinations.
function isConfigured(endpoint, placeholder) {
  return Boolean(endpoint && !endpoint.includes(placeholder));
}

// Create the WhatsApp message and expose it as a fallback if network checkout fails.
function setWhatsAppFallback(order) {
  if (!/^\d{8,15}$/.test(WHATSAPP_NUMBER)) {
    ui.whatsappFallback.classList.remove("show");
    return;
  }
  const message = [
    `VOID order request — ${order.order_id}`,
    `Name: ${order.customer_name}`,
    `Phone: ${order.phone}`,
    `Address: ${order.address}`,
    `Preference: ${order.payment_preference}`,
    "Items:",
    ...order.items.map((item) => `${item.quantity} × ${item.name} / ${item.size} — ${money(item.subtotal)}`),
    `Estimated total: ${money(order.total_amount)}`
  ].join("\n");
  ui.whatsappFallback.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  ui.whatsappFallback.classList.add("show");
}

// POST one JSON order to a configured destination and reject unsuccessful responses.
async function postOrder(endpoint, payload, destinationName) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`${destinationName} returned ${response.status}.`);
  return response;
}

// Prepare one complete order object for both the email and spreadsheet endpoints.
function createOrder(formData) {
  const items = state.cart.map((line) => {
    const product = state.products.find((item) => item.id === line.productId);
    return {
      product_id: product.id,
      name: product.name,
      category: product.category,
      size: line.size,
      quantity: line.quantity,
      unit_price: product.price,
      subtotal: product.price * line.quantity
    };
  });
  const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
  const cartSummary = items.map((item) => `${item.quantity} × ${item.name} / ${item.size} — ${money(item.subtotal)}`).join("\n");
  return {
    order_id: `VOID-${Date.now()}`,
    customer_name: String(formData.get("customer_name")).trim(),
    phone: String(formData.get("phone")).trim(),
    address: String(formData.get("address")).trim(),
    payment_preference: String(formData.get("preference")),
    items,
    cart_summary: cartSummary,
    total_amount: totalAmount,
    currency: "USD",
    submitted_at: new Date().toISOString()
  };
}

// Send to Formspree and the sheet webhook together; only clear the cart after both confirm.
async function submitOrder(event) {
  event.preventDefault();
  if (!state.cart.length || !ui.checkoutForm.reportValidity()) return;

  const formData = new FormData(ui.checkoutForm);
  const order = createOrder(formData);
  // Formspree receives the exact email fields requested plus order metadata.
  const emailPayload = {
    customer_name: order.customer_name,
    phone: order.phone,
    address: order.address,
    cart_summary: order.cart_summary,
    total_amount: order.total_amount,
    payment_preference: order.payment_preference,
    order_id: order.order_id,
    currency: order.currency
  };
  // The webhook receives structured line items for straightforward Sheets columns.
  const webhookPayload = { ...order, source: "VOID static storefront" };
  const destinations = [];
  if (isConfigured(FORMSPREE_ENDPOINT, "YOUR_FORM_ID")) {
    destinations.push({ name: "Email alert", promise: postOrder(FORMSPREE_ENDPOINT, emailPayload, "Email alert") });
  }
  if (isConfigured(WEBHOOK_URL, "your-webhook-url-here.com")) {
    destinations.push({ name: "Google Sheets log", promise: postOrder(WEBHOOK_URL, webhookPayload, "Google Sheets log") });
  }

  // If the owner hasn't added either URL, retain the cart and offer WhatsApp if configured.
  if (!destinations.length) {
    ui.checkoutStatus.textContent = "Add your Formspree and webhook URLs in app.js before placing online orders.";
    ui.checkoutStatus.className = "checkout-status error";
    setWhatsAppFallback(order);
    return;
  }

  // Freeze the submit control during requests to prevent duplicate orders.
  ui.submitOrder.disabled = true;
  ui.submitOrder.textContent = "Processing order…";
  ui.checkoutStatus.textContent = "Sending your order to email and the order sheet…";
  ui.checkoutStatus.className = "checkout-status";
  ui.whatsappFallback.classList.remove("show");

  // Always wait for every configured destination so partial failures are reported accurately.
  const results = await Promise.allSettled(destinations.map((destination) => destination.promise));
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [`${destinations[index].name}: ${result.reason.message}`]
    : []);
  const succeededCount = results.length - failures.length;

  // Clear storage only when each configured destination accepted the order.
  if (!failures.length && destinations.length === 2) {
    state.cart = [];
    saveCart();
    renderCart();
    ui.checkoutForm.reset();
    ui.checkoutStatus.textContent = `Order placed successfully! ${order.order_id} has been emailed and logged.`;
    ui.checkoutStatus.className = "checkout-status success";
    showToast("Order placed / thank you");
  } else if (!failures.length) {
    // Avoid silently losing the second destination: one endpoint must be configured before clearing.
    ui.checkoutStatus.textContent = `${destinations[0].name} accepted the order. Add the second endpoint to complete dual delivery; your bag is saved.`;
    ui.checkoutStatus.className = "checkout-status error";
    setWhatsAppFallback(order);
  } else {
    ui.checkoutStatus.textContent = `${succeededCount ? "One destination accepted the order. " : "Order not fully sent. "}${failures.join(" ")} Your bag is saved; retry or use WhatsApp.`;
    ui.checkoutStatus.className = "checkout-status error";
    setWhatsAppFallback(order);
  }

  // Restore the button after the asynchronous request settles.
  ui.submitOrder.disabled = state.cart.length === 0;
  ui.submitOrder.innerHTML = 'Place order <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 12h15M13 5l7 7-7 7"/></svg>';
}

// Add restrained pointer-driven depth to the campaign object and product imagery.
function attachTiltToCards() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(pointer: fine)").matches) return;
  ui.productGrid.querySelectorAll("[data-tilt]").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const bounds = card.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      card.style.setProperty("--pointer-x", `${x * 100}%`);
      card.style.setProperty("--pointer-y", `${y * 100}%`);
      card.style.transform = `rotateX(${(0.5 - y) * 5}deg) rotateY(${(x - 0.5) * 5}deg)`;
    });
    card.addEventListener("pointerleave", () => { card.style.transform = ""; });
  });
}

// Apply a gentler 3D parallax to the hero campaign image on pointer devices.
function attachHeroParallax() {
  const stage = document.querySelector("#heroStage");
  if (!stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(pointer: fine)").matches) return;
  stage.addEventListener("pointermove", (event) => {
    const bounds = stage.getBoundingClientRect();
    const rotateY = ((event.clientX - bounds.left) / bounds.width - 0.5) * 8;
    const rotateX = (0.5 - (event.clientY - bounds.top) / bounds.height) * 6;
    stage.style.transform = `perspective(1100px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });
  stage.addEventListener("pointerleave", () => { stage.style.transform = ""; });
}

// Fade secondary editorial blocks into view as they enter the viewport.
function attachRevealObserver() {
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".reveal").forEach((element) => element.classList.add("visible"));
    return;
  }
  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        currentObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
}

// Load the static catalog with async/await and then paint the shop and saved bag.
async function initializeStore() {
  try {
    const response = await fetch("products.json");
    if (!response.ok) throw new Error(`Catalog returned ${response.status}.`);
    state.products = await response.json();
    renderFilters();
    renderProducts();
    renderCart();
    attachHeroParallax();
    attachRevealObserver();
  } catch (error) {
    console.error("VOID could not load products.json.", error);
    ui.resultCount.textContent = "Catalog unavailable";
    ui.productGrid.innerHTML = '<div class="empty-state"><strong>The collection is out of orbit.</strong>Open this site through GitHub Pages or a local web server so products.json can load.</div>';
  }
}

// Category chip clicks update the active category and repaint the product grid.
ui.categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.activeCategory = button.dataset.category;
  renderFilters();
  renderProducts();
});

// Header category links choose the matching filter before jumping to the shop.
document.querySelectorAll("[data-category-link]").forEach((link) => {
  link.addEventListener("click", () => {
    state.activeCategory = link.dataset.categoryLink;
    renderFilters();
    renderProducts();
  });
});

// Let the floating capsule header settle into a slightly deeper shadow on scroll.
window.addEventListener("scroll", () => {
  document.querySelector(".site-header").classList.toggle("is-scrolled", window.scrollY > 24);
}, { passive: true });

// Search by product name, category, or description as the visitor types.
ui.searchInput.addEventListener("input", (event) => {
  state.searchTerm = event.target.value;
  renderProducts();
});

// Use one delegated handler for add buttons and product quick-detail buttons.
ui.productGrid.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-to-cart]");
  if (addButton) {
    const productId = addButton.dataset.addToCart;
    const selector = ui.productGrid.querySelector(`[data-size-for="${CSS.escape(productId)}"]`);
    addToCart(productId, selector.value);
    // Confirm the specific button briefly, then restore its normal label.
    addButton.classList.add("just-added");
    addButton.textContent = "Added ✓";
    window.setTimeout(() => {
      addButton.classList.remove("just-added");
      addButton.textContent = "Add to bag +";
    }, 1100);
    return;
  }
  const quickView = event.target.closest("[data-quick-view]");
  if (quickView) {
    const product = state.products.find((item) => item.id === quickView.dataset.quickView);
    if (product) showToast(product.description);
  }
});

// Handle quantity changes and removals from the cart using delegated clicks.
ui.cartItems.addEventListener("click", (event) => {
  const quantityButton = event.target.closest("[data-quantity]");
  if (quantityButton) {
    changeQuantity(quantityButton.dataset.product, quantityButton.dataset.size, Number(quantityButton.dataset.quantity));
    return;
  }
  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) removeLine(removeButton.dataset.remove, removeButton.dataset.size);
});

// Open and close the cart drawer with its buttons, backdrop, and Escape key.
document.querySelector("#openCart").addEventListener("click", () => setCartOpen(true));
document.querySelector("#closeCart").addEventListener("click", () => setCartOpen(false));
ui.cartScrim.addEventListener("click", () => setCartOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setCartOpen(false);
});

// Submit checkout to email plus the webhook, retaining the cart on any partial failure.
ui.checkoutForm.addEventListener("submit", submitOrder);

// Kick off the static storefront once its HTML is ready.
initializeStore();
