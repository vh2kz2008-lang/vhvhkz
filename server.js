const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'inventory.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    product_id INTEGER PRIMARY KEY,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    order_id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL REFERENCES orders(order_id),
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    PRIMARY KEY(order_id, product_id)
  );
`);

// Import the supplied CSV once, only when the database is empty.
const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (count === 0) {
  const csvPath = path.join(DATA_DIR, 'inventory.csv');
  if (fs.existsSync(csvPath)) {
    const lines = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const insert = db.prepare('INSERT OR REPLACE INTO products(product_id, product_name, quantity) VALUES (?, ?, ?)');
    const insertRows = () => {
      db.exec('BEGIN IMMEDIATE');
      try {
      for (const line of lines.slice(1)) {
        const [id, ...rest] = line.split(',');
        const qty = Number(rest.pop());
        const name = rest.join(',').trim();
        if (Number.isInteger(Number(id)) && name && Number.isInteger(qty) && qty >= 0) {
          insert.run(Number(id), name, qty);
        }
      }
      db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    };
    insertRows();
  }
}

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ success: true, database: 'SQLite', status: 'connected' }));
app.get('/api/inventory', (req, res) => {
  const data = db.prepare(`SELECT product_id AS MaHang, product_name AS TenHang,
    quantity AS SoLuong, CASE WHEN quantity = 0 THEN 1 ELSE 0 END AS HetHang,
    updated_at AS CapNhatLuc FROM products ORDER BY product_id`).all();
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, source: 'SQLite', data });
});

// Create an order and reduce stock atomically so two buyers cannot oversell the same item.
app.post('/api/orders', (req, res) => {
  const items = req.body && req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Giỏ hàng trống hoặc không hợp lệ.' });
  }
  const normalized = new Map();
  for (const item of items) {
    const id = Number(item.id), quantity = Number(item.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ success: false, message: 'Sản phẩm hoặc số lượng không hợp lệ.' });
    }
    normalized.set(id, (normalized.get(id) || 0) + quantity);
  }
  try {
    const createOrder = () => {
      db.exec('BEGIN IMMEDIATE');
      try {
      for (const [id, quantity] of normalized) {
        const product = db.prepare('SELECT product_name, quantity FROM products WHERE product_id = ?').get(id);
        if (!product) throw new Error(`Không tìm thấy sản phẩm mã ${id}.`);
        if (product.quantity < quantity) throw new Error(`${product.product_name} chỉ còn ${product.quantity} sản phẩm.`);
      }
      const order = db.prepare('INSERT INTO orders DEFAULT VALUES').run();
      const addItem = db.prepare('INSERT INTO order_items(order_id, product_id, quantity) VALUES (?, ?, ?)');
      const reduce = db.prepare('UPDATE products SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?');
      for (const [id, quantity] of normalized) {
        addItem.run(order.lastInsertRowid, id, quantity);
        reduce.run(quantity, id);
      }
      db.exec('COMMIT');
      return Number(order.lastInsertRowid);
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    };
    const orderId = createOrder();
    res.status(201).json({ success: true, orderId, message: 'Đặt hàng thành công.' });
  } catch (error) {
    res.status(409).json({ success: false, message: error.message });
  }
});

app.listen(PORT, () => console.log(`ElectroShop chạy tại http://localhost:${PORT}; SQLite: ${DB_PATH}`));
