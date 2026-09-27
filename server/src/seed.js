// Loads demo products so you can try billing straight away:  npm run seed
process.env.TZ ||= 'Asia/Kolkata';
const { openDb } = await import('./db.js');
const { ean13CheckDigit } = await import('../../shared/gst.js');

const db = openDb();
if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0) {
  console.log('Products already exist - skipping demo seed.');
  process.exit(0);
}

const ean = (n) => { const f = `890${String(n).padStart(9, '0')}`; return f + ean13CheckDigit(f); };

// [name, hsn, unit, price(₹), cost(₹), gst%, stock, reorder, category]
const demo = [
  ['Tata Salt 1kg', '2501', 'pcs', 28, 22, 0, 120, 20, 'Grocery'],
  ['Aashirvaad Atta 5kg', '1101', 'pcs', 285, 250, 5, 40, 10, 'Grocery'],
  ['Fortune Sunflower Oil 1L', '1512', 'pcs', 155, 138, 5, 35, 10, 'Grocery'],
  ['Basmati Rice (Loose)', '1006', 'kg', 110, 88, 5, 75.5, 15, 'Grocery'],
  ['Toor Dal (Loose)', '0713', 'kg', 160, 135, 0, 8, 10, 'Grocery'],
  ['Amul Butter 100g', '0405', 'pcs', 58, 52, 12, 3, 12, 'Dairy'],
  ['Amul Taaza Milk 500ml', '0401', 'pcs', 28, 25, 0, 48, 24, 'Dairy'],
  ['Parle-G Biscuit 250g', '1905', 'pcs', 25, 21, 18, 200, 30, 'Snacks'],
  ['Lays Classic Salted 52g', '2005', 'pcs', 20, 16, 12, 90, 20, 'Snacks'],
  ['Maggi Noodles 280g', '1902', 'pcs', 56, 48, 12, 60, 15, 'Snacks'],
  ['Coca-Cola 750ml', '2202', 'pcs', 40, 32, 40, 0, 12, 'Beverages'],
  ['Tata Tea Gold 500g', '0902', 'pcs', 310, 270, 5, 22, 6, 'Beverages'],
  ['Nescafe Classic 50g', '2101', 'pcs', 185, 160, 5, 18, 5, 'Beverages'],
  ['Colgate Strong Teeth 200g', '3306', 'pcs', 110, 92, 5, 45, 10, 'Personal Care'],
  ['Dove Soap 100g', '3401', 'pcs', 62, 52, 5, 70, 15, 'Personal Care'],
  ['Head & Shoulders 180ml', '3305', 'pcs', 199, 170, 5, 4, 6, 'Personal Care'],
  ['Surf Excel Easy Wash 1kg', '3402', 'pcs', 140, 120, 5, 30, 8, 'Household'],
  ['Vim Dishwash Bar 300g', '3405', 'pcs', 30, 25, 5, 55, 12, 'Household'],
  ['Good Knight Refill', '3808', 'pcs', 85, 70, 18, 25, 6, 'Household'],
  ['Classmate Notebook 172pg', '4820', 'pcs', 60, 45, 12, 100, 20, 'Stationery'],
];

const ins = db.prepare(`INSERT INTO products (name, barcode, hsn, unit, price, cost, gst_rate, tax_inclusive,
  stock, reorder_level, category) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`);
const mv = db.prepare(`INSERT INTO stock_movements (product_id, change, reason, user_id) VALUES (?, ?, 'opening', 1)`);
db.exec('BEGIN');
demo.forEach(([name, hsn, unit, price, cost, gst, stock, reorder, cat], i) => {
  const { lastInsertRowid } = ins.run(name, ean(i + 1), hsn, unit, price * 100, cost * 100, gst, stock, reorder, cat);
  if (stock) mv.run(lastInsertRowid, stock);
});
db.exec('COMMIT');
console.log(`Seeded ${demo.length} demo products.`);
