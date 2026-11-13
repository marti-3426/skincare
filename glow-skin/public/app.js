
let products = [];
let cart = [];
let currentReceipt = null;

const $ = id => document.getElementById(id);

const money = value =>
  "US$ " + Number(value).toFixed(2);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Ocurrió un error");
  }

  return data;
}

function imageHTML(url, name) {
  if (!url) return '<div class="product-placeholder">✿</div>';

  return `<img src="${escapeHTML(url)}"
    alt="${escapeHTML(name)}"
    loading="lazy"
    onerror="this.style.display='none'">`;
}

// CARGAR PRODUCTOS

async function loadProducts() {
  try {
    products = await api("/api/products");
    renderProducts();
  } catch (error) {
    $("products").textContent = error.message;
  }
}

function renderProducts() {
  const search = $("search").value.toLowerCase().trim();
  const category = $("category").value;

  const filtered = products.filter(product => {
    return (
      product.name.toLowerCase().includes(search) &&
      (!category || product.category === category)
    );
  });

  if (!filtered.length) {
    $("products").innerHTML = "<p>No encontramos productos.</p>";
    return;
  }

  $("products").innerHTML = filtered.map(product => {
    const finalPrice = product.price * (1 - product.discount / 100);

    return `
      <article class="product-card">
        <div class="product-image">
          ${imageHTML(product.image, product.name)}
        </div>
        <div class="product-info">
          <h3>${escapeHTML(product.name)}</h3>
          <p>${escapeHTML(product.description)}</p>
          <p>${escapeHTML(product.category)}</p>
          <div class="product-price">
            ${product.discount > 0
              ? `<span class="old-price">${money(product.price)}</span>`
              : ""}
            ${money(finalPrice)}
            ${product.discount > 0
              ? `<small> -${product.discount}%</small>`
              : ""}
          </div>
          <p>Stock: ${product.stock}</p>
          <button onclick="addToCart(${product.id})"
            ${product.stock < 1 ? "disabled" : ""}>
            ${product.stock < 1 ? "SIN STOCK" : "AGREGAR AL CARRITO"}
          </button>
        </div>
      </article>
    `;
  }).join("");
}

// CARRITO

function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  const existing = cart.find(item => item.id === id);
  const quantity = existing ? existing.quantity : 0;

  if (quantity >= product.stock) {
    alert("No hay suficiente stock.");
    return;
  }

  if (existing) existing.quantity++;
  else cart.push({ id, quantity: 1 });

  updateCart();
}

function changeQuantity(id, amount) {
  const item = cart.find(i => i.id === id);
  const product = products.find(p => p.id === id);

  if (!item || !product) return;

  const newQuantity = item.quantity + amount;

  if (newQuantity < 1) {
    cart = cart.filter(i => i.id !== id);
  } else if (newQuantity <= product.stock) {
    item.quantity = newQuantity;
  } else {
    alert("No hay suficiente stock.");
  }

  updateCart();
}

function getCartTotal() {
  return cart.reduce((sum, item) => {
    const product = products.find(p => p.id === item.id);
    if (!product) return sum;

    return sum +
      product.price * (1 - product.discount / 100) * item.quantity;
  }, 0);
}

function updateCart() {
  $("cart-count").textContent =
    cart.reduce((sum, item) => sum + item.quantity, 0);

  $("cart-items").innerHTML = cart.map(item => {
    const product = products.find(p => p.id === item.id);
    if (!product) return "";

    const price = product.price * (1 - product.discount / 100);

    return `
      <div class="cart-item">
        <div>
          <strong>${escapeHTML(product.name)}</strong>
          <p>${money(price)} × ${item.quantity}</p>
          <button onclick="changeQuantity(${item.id}, -1)">−</button>
          ${item.quantity}
          <button onclick="changeQuantity(${item.id}, 1)">+</button>
        </div>
        <strong>${money(price * item.quantity)}</strong>
        <button onclick="removeItem(${item.id})">✕</button>
      </div>
    `;
  }).join("");

  $("cart-total").textContent = money(getCartTotal());
  updatePaymentInfo();
}

function removeItem(id) {
  cart = cart.filter(item => item.id !== id);
  updateCart();
}

function toggleCart() {
  $("cart-modal").classList.toggle("hidden");
  updateCart();
}

function updatePaymentInfo() {
  const total = getCartTotal();
  const received = Number($("received").value);
  const info = $("payment-info");

  if (!$("received").value) {
    info.textContent = "Ingresá el dinero recibido.";
  } else if (received < total) {
    info.textContent = "Falta: " + money(total - received);
  } else {
    info.textContent = "Vuelto: " + money(received - total);
  }
}

$("received").addEventListener("input", updatePaymentInfo);

// CAJA Y VENTA

async function checkout() {
  if (!cart.length) {
    alert("Tu carrito está vacío.");
    return;
  }

  const received = Number($("received").value);

  if (!Number.isFinite(received) || received < getCartTotal()) {
    alert("El dinero recibido no alcanza para pagar.");
    return;
  }

  if (!confirm("¿Confirmar esta compra?")) return;

  try {
    const result = await api("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        items: cart,
        received
      })
    });

    currentReceipt = result.receipt;

    cart = [];
    $("received").value = "";
    updateCart();

    $("cart-modal").classList.add("hidden");
    showReceipt(currentReceipt);

    await loadProducts();

  } catch (error) {
    alert(error.message);
    await loadProducts();
  }
}

// RECIBO

function showReceipt(receipt) {
  const date = new Date().toLocaleString();

  $("receipt-content").innerHTML = `
    <div style="text-align:center">
      <h2>✿ GLOW SKIN ✿</h2>
      <p>YOUR SKIN, YOUR GLOW</p>
      <hr>
      <h3>RECIBO DE COMPRA</h3>
      <p>Venta #${receipt.id}</p>
      <p>${escapeHTML(date)}</p>
    </div>

    <hr>

    ${receipt.items.map(item => `
      <div style="display:flex;justify-content:space-between;margin:12px 0">
        <span>${escapeHTML(item.name)} × ${item.quantity}</span>
        <strong>${money(item.lineTotal)}</strong>
      </div>
    `).join("")}

    <hr>
    <p>Subtotal: ${money(receipt.subtotal)}</p>
    <p>Descuentos: ${money(receipt.discount)}</p>
    <h3>Total: ${money(receipt.total)}</h3>
    <p>Pagó: ${money(receipt.received)}</p>
    <h3>Vuelto: ${money(receipt.change)}</h3>

    <hr>
    <p style="text-align:center;margin-top:20px">
      ¡Gracias por elegir Glow Skin! ♡
    </p>
  `;

  $("receipt-modal").classList.remove("hidden");
}

function closeReceipt() {
  $("receipt-modal").classList.add("hidden");
}

// ADMINISTRACION

function showAdmin() {
  $("login-modal").classList.remove("hidden");
}

function hideAdmin() {
  $("login-modal").classList.add("hidden");
}

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("username").value,
        password: $("password").value
      })
    });

    $("login-form").reset();
    $("login-error").textContent = "";
    hideAdmin();

    $("admin-modal").classList.remove("hidden");
    adminTab("dashboard");

  } catch (error) {
    $("login-error").textContent = error.message;
  }
});

async function adminLogout() {
  try {
    await api("/api/logout", { method: "POST" });
  } finally {
    $("admin-modal").classList.add("hidden");
    $("login-modal").classList.add("hidden");
  }
}

function adminTab(tab) {
  document.querySelectorAll(".admin-panel").forEach(panel => {
    panel.classList.add("hidden");
  });

  $(tab).classList.remove("hidden");

  if (tab === "dashboard") loadStats();
  if (tab === "manage") loadAdminProducts();
  if (tab === "history") loadHistory();
}

// ESTADISTICAS

async function loadStats() {
  try {
    const s = await api("/api/stats");

    $("stats").innerHTML = `
      <div class="stat-card">
        <small>Ventas realizadas</small>
        <strong>${s.salesCount}</strong>
      </div>
      <div class="stat-card">
        <small>Ingresos totales</small>
        <strong>${money(s.revenue)}</strong>
      </div>
      <div class="stat-card">
        <small>Descuentos otorgados</small>
        <strong>${money(s.discounts)}</strong>
      </div>
      <div class="stat-card">
        <small>Venta promedio</small>
        <strong>${money(s.averageSale)}</strong>
      </div>
      <div class="stat-card">
        <small>Productos activos</small>
        <strong>${s.total}</strong>
      </div>
      <div class="stat-card">
        <small>Unidades en stock</small>
        <strong>${s.stock}</strong>
      </div>
      <div class="stat-card">
        <small>Ganancia estimada</small>
        <strong>${s.cost === 0
          ? "Sin costos cargados"
          : money(s.estimatedProfit)}</strong>
      </div>
    `;

  } catch (error) {
    $("stats").textContent = error.message;
  }
}

// PRODUCTOS ADMIN

async function loadAdminProducts() {
  try {
    const list = await api("/api/products");

    $("admin-products").innerHTML = list.map(p => `
      <div class="admin-product">
        <strong>${escapeHTML(p.name)}</strong>
        <p>${money(p.price)} | Stock: ${p.stock} |
          Descuento: ${p.discount}%</p>
        <button onclick="editProduct(${p.id})">Editar</button>
        <button onclick="deleteProduct(${p.id})">Eliminar</button>
      </div>
    `).join("");

  } catch (error) {
    $("admin-products").textContent = error.message;
  }
}

function resetProductForm() {
  $("product-form").reset();
  $("product-id").value = "";
  $("p-discount").value = 0;
}

$("product-form").addEventListener("submit", async event => {
  event.preventDefault();

  const id = $("product-id").value;

  const product = {
    name: $("p-name").value.trim(),
    description: $("p-description").value,
    category: $("p-category").value,
    price: Number($("p-price").value),
    stock: Number($("p-stock").value),
    discount: Number($("p-discount").value),
    image: $("p-image").value
  };

  try {
    await api(id ? `/api/products/${id}` : "/api/products", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(product)
    });

    alert("Producto guardado correctamente.");
    resetProductForm();
    await loadAdminProducts();
    await loadProducts();

  } catch (error) {
    alert(error.message);
  }
});

async function editProduct(id) {
  try {
    const list = await api("/api/products");
    const p = list.find(item => item.id === id);
    if (!p) return;

    $("product-id").value = p.id;
    $("p-name").value = p.name;
    $("p-description").value = p.description;
    $("p-category").value = p.category;
    $("p-price").value = p.price;
    $("p-stock").value = p.stock;
    $("p-discount").value = p.discount;
    $("p-image").value = p.image;

    $("manage").scrollIntoView({ behavior: "smooth" });

  } catch (error) {
    alert(error.message);
  }
}

async function deleteProduct(id) {
  if (!confirm("¿Eliminar este producto de la tienda?")) return;

  try {
    await api(`/api/products/${id}`, { method: "DELETE" });
    await loadAdminProducts();
    await loadProducts();
  } catch (error) {
    alert(error.message);
  }
}

// HISTORIAL

async function loadHistory() {
  try {
    const sales = await api("/api/sales");

    $("sales-history").innerHTML = sales.length
      ? sales.map(s => `
        <div class="sale-card">
          <strong>Venta #${s.id}</strong>
          <p>${escapeHTML(s.created_at)}</p>
          <p>Total: ${money(s.total)}</p>
          <p>Descuentos: ${money(s.discount)}</p>
          <button onclick="viewSale(${s.id})">Ver recibo</button>
        </div>
      `).join("")
      : "<p>Todavía no hay ventas registradas.</p>";

  } catch (error) {
    $("sales-history").textContent = error.message;
  }
}

async function viewSale(id) {
  try {
    const sale = await api(`/api/sales/${id}`);

    showReceipt({
      id: sale.id,
      subtotal: sale.subtotal,
      discount: sale.discount,
      total: sale.total,
      received: sale.received,
      change: sale.change_amount,
      items: sale.items.map(item => ({
        name: item.product_name,
        quantity: item.quantity,
        lineTotal: item.line_total
      }))
    });

  } catch (error) {
    alert(error.message);
  }
}

// INICIO

loadProducts();
updateCart();
