
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const db = new Database("glow-skin.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET ||
    !process.env.ADMIN_USER) {
  throw new Error("Configura ADMIN_USER, ADMIN_PASSWORD y SESSION_SECRET en .env");
}

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new SQLiteStore({
    db: "sessions.db",
    dir: "."
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, "public")));

// BASE DE DATOS

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT DEFAULT '',
  discount REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subtotal REAL NOT NULL,
  discount REAL NOT NULL,
  total REAL NOT NULL,
  received REAL NOT NULL,
  change_amount REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  discount REAL NOT NULL,
  line_total REAL NOT NULL,
  FOREIGN KEY(sale_id) REFERENCES sales(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
`);

const adminHash = bcrypt.hashSync(
  process.env.ADMIN_PASSWORD,
  12
);

db.prepare(`
INSERT INTO admin(username, password_hash)
VALUES (?, ?)
ON CONFLICT(username) DO NOTHING
`).run(process.env.ADMIN_USER, adminHash);

// FUNCIONES

function adminOnly(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Acceso no autorizado"
    });
  }
  next();
}

function validId(id) {
  return Number.isSafeInteger(Number(id)) && Number(id) > 0;
}

const categories = [
  "limpiadores",
  "serums",
  "cremas",
  "protectores solares"
];

// INICIAR SESION

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

app.post("/api/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;

  if (typeof username !== "string" ||
      typeof password !== "string") {
    return res.status(400).json({ error: "Datos inválidos" });
  }

  const user = db.prepare(
    "SELECT * FROM admin WHERE username = ?"
  ).get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({
      error: "Usuario o contraseña incorrectos"
    });
  }

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Error de sesión" });

    req.session.admin = user.username;
    res.json({ success: true });
  });
});

app.get("/api/me", (req, res) => {
  res.json({
    authenticated: Boolean(req.session.admin),
    username: req.session.admin || null
  });
});

app.post("/api/logout", adminOnly, (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Error al cerrar sesión" });
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// PRODUCTOS PUBLICOS

app.get("/api/products", (req, res) => {
  const products = db.prepare(`
    SELECT id, name, description, category, price,
           stock, image, discount
    FROM products
    WHERE active = 1
    ORDER BY id DESC
  `).all();

  res.json(products);
});

// ADMIN: CREAR PRODUCTO

app.post("/api/products", adminOnly, (req, res) => {
  const { name, description, category, price, stock, image, discount } = req.body;

  if (typeof name !== "string" || !name.trim() ||
      !categories.includes(category) ||
      typeof description !== "string" ||
      !Number.isFinite(price) || price < 0 ||
      !Number.isSafeInteger(stock) || stock < 0 ||
      !Number.isFinite(discount) || discount < 0 || discount > 100 ||
      typeof image !== "string" || image.length > 2000) {
    return res.status(400).json({ error: "Revisá los datos del producto" });
  }

  const result = db.prepare(`
    INSERT INTO products
    (name, description, category, price, stock, image, discount)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), description, category, price, stock, image, discount);

  res.json({ success: true, id: result.lastInsertRowid });
});

// ADMIN: EDITAR PRODUCTO

app.put("/api/products/:id", adminOnly, (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const { name, description, category, price, stock, image, discount } = req.body;

  if (typeof name !== "string" || !name.trim() ||
      !categories.includes(category) ||
      typeof description !== "string" ||
      !Number.isFinite(price) || price < 0 ||
      !Number.isSafeInteger(stock) || stock < 0 ||
      !Number.isFinite(discount) || discount < 0 || discount > 100 ||
      typeof image !== "string" || image.length > 2000) {
    return res.status(400).json({ error: "Datos inválidos" });
  }

  const result = db.prepare(`
    UPDATE products
    SET name=?, description=?, category=?, price=?,
        stock=?, image=?, discount=?
    WHERE id=?
  `).run(name.trim(), description, category, price, stock,
         image, discount, Number(req.params.id));

  if (!result.changes) return res.status(404).json({ error: "Producto no encontrado" });

  res.json({ success: true });
});

// ADMIN: ELIMINAR PRODUCTO (DESACTIVAR)

app.delete("/api/products/:id", adminOnly, (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const result = db.prepare(`
    UPDATE products SET active=0 WHERE id=?
  `).run(Number(req.params.id));

  if (!result.changes) return res.status(404).json({ error: "No encontrado" });

  res.json({ success: true });
});

// REGISTRAR VENTA

const createSale = db.transaction((items, received) => {
  let subtotal = 0;
  let total = 0;
  const details = [];

  for (const item of items) {
    if (!validId(item.id) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 || item.quantity > 1000) {
      throw new Error("Producto o cantidad inválida");
    }

    const product = db.prepare(`
      SELECT * FROM products WHERE id=? AND active=1
    `).get(item.id);

    if (!product || product.stock < item.quantity) {
      throw new Error("Producto sin stock suficiente: " + (product?.name || item.id));
    }

    const unitPrice = product.price;
    const discount = product.discount;
    const finalPrice = Math.round(unitPrice * (1 - discount / 100) * 100) / 100;
    const lineSubtotal = unitPrice * item.quantity;
    const lineTotal = Math.round(finalPrice * item.quantity * 100) / 100;

    subtotal += lineSubtotal;
    total += lineTotal;

    details.push({
      product,
      quantity: item.quantity,
      unitPrice,
      discount,
      lineTotal
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;
  total = Math.round(total * 100) / 100;

  const discountTotal = Math.round((subtotal - total) * 100) / 100;

  if (!Number.isFinite(received) || received < total || received > 100000000) {
    throw new Error("El dinero recibido es insuficiente o inválido");
  }

  const change = Math.round((received - total) * 100) / 100;

  const sale = db.prepare(`
    INSERT INTO sales (subtotal, discount, total, received, change_amount)
    VALUES (?, ?, ?, ?, ?)
  `).run(subtotal, discountTotal, total, received, change);

  const insertItem = db.prepare(`
    INSERT INTO sale_items
    (sale_id, product_id, product_name, quantity,
     unit_price, discount, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStock = db.prepare(`
    UPDATE products SET stock = stock - ? WHERE id = ?
  `);

  for (const d of details) {
    insertItem.run(
      sale.lastInsertRowid,
      d.product.id,
      d.product.name,
      d.quantity,
      d.unitPrice,
      d.discount,
      d.lineTotal
    );

    updateStock.run(d.quantity, d.product.id);
  }

  return {
    id: sale.lastInsertRowid,
    subtotal,
    discount: discountTotal,
    total,
    received,
    change,
    items: details.map(d => ({
      name: d.product.name,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      discount: d.discount,
      lineTotal: d.lineTotal
    }))
  };
});

app.post("/api/sales", (req, res) => {
  try {
    const { items, received } = req.body;

    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      return res.status(400).json({ error: "Carrito inválido" });
    }

    const receipt = createSale(items, received);
    res.json({ success: true, receipt });

  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// HISTORIAL DE VENTAS

app.get("/api/sales", adminOnly, (req, res) => {
  const sales = db.prepare(`
    SELECT * FROM sales ORDER BY id DESC LIMIT 500
  `).all();

  res.json(sales);
});

app.get("/api/sales/:id", adminOnly, (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const sale = db.prepare(
    "SELECT * FROM sales WHERE id=?"
  ).get(Number(req.params.id));

  if (!sale) return res.status(404).json({ error: "Venta no encontrada" });

  const items = db.prepare(
    "SELECT * FROM sale_items WHERE sale_id=?"
  ).all(sale.id);

  res.json({ ...sale, items });
});

// ESTADISTICAS

app.get("/api/stats", adminOnly, (req, res) => {
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS salesCount,
      COALESCE(SUM(total), 0) AS revenue,
      COALESCE(SUM(discount), 0) AS discounts,
      COALESCE(AVG(total), 0) AS averageSale
    FROM sales
  `).get();

  const products = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(stock), 0) AS stock
    FROM products WHERE active=1
  `).get();

  const daily = db.prepare(`
    SELECT date(created_at) AS day,
           COUNT(*) AS sales,
           SUM(total) AS revenue
    FROM sales
    GROUP BY date(created_at)
    ORDER BY day DESC
    LIMIT 7
  `).all();

  const cost = { cost: 0 };

res.json({
  ...summary,
  ...products,
  cost: cost.cost,
  estimatedProfit: null,
  daily
});

// INICIAR SERVIDOR

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Glow Skin funcionando en http://localhost:${3000}`);
});
