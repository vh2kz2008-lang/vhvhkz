const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'inventory.sqlite');
const [idArg, qtyArg] = process.argv.slice(2);
const id = Number(idArg), quantity = Number(qtyArg);
if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 0) {
  console.error('Cách dùng: npm run stock -- <mã_sản_phẩm> <số_lượng_không_âm>');
  process.exit(1);
}
const db = new DatabaseSync(dbPath);
const result = db.prepare('UPDATE products SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?').run(quantity, id);
if (!result.changes) {
  console.error(`Không tìm thấy sản phẩm mã ${id}.`);
  process.exitCode = 1;
} else {
  const product = db.prepare('SELECT product_name, quantity FROM products WHERE product_id = ?').get(id);
  console.log(`Đã cập nhật: ${product.product_name} — ${product.quantity === 0 ? 'HẾT HÀNG' : `còn ${product.quantity}`}.`);
}
db.close();
