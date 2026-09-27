import { neon, Pool } from '@neondatabase/serverless';
import { hashPassword } from './auth.js';

const DEFAULT_SETTINGS = {
  shop_name: 'AnshBill Retail Store',
  shop_address: 'Shop No. 1, Main Road, Pune',
  shop_phone: '',
  shop_email: '',
  shop_gstin: '',
  shop_state_code: '27',
  invoice_prefix: 'AB',
  invoice_footer: 'Thank you for shopping with us! Goods once sold will not be taken back.',
  allow_negative_stock: '0',
};

export function openDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is required');
  return neon(process.env.DATABASE_URL);
}

export async function initDb(sql) {
  await sql`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','cashier')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'))`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (LOWER(username))`;
  await sql`CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, name TEXT NOT NULL, barcode TEXT UNIQUE, sku TEXT, hsn TEXT, unit TEXT NOT NULL DEFAULT 'pcs', price INTEGER NOT NULL CHECK (price >= 0), cost INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0), gst_rate REAL NOT NULL DEFAULT 0, tax_inclusive INTEGER NOT NULL DEFAULT 1, stock REAL NOT NULL DEFAULT 0, reorder_level REAL NOT NULL DEFAULT 0, category TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'), updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'))`;
  await sql`CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)`;
  await sql`CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE, gstin TEXT, state_code TEXT, address TEXT, created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'))`;
  await sql`CREATE TABLE IF NOT EXISTS invoices (id SERIAL PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE, fy TEXT NOT NULL, seq INTEGER NOT NULL, bill_date TEXT NOT NULL, created_at TEXT NOT NULL, customer_id INTEGER REFERENCES customers(id), customer_name TEXT, customer_phone TEXT, customer_gstin TEXT, place_of_supply TEXT NOT NULL, inter_state INTEGER NOT NULL DEFAULT 0, gross INTEGER NOT NULL, discount INTEGER NOT NULL, taxable INTEGER NOT NULL, cgst INTEGER NOT NULL, sgst INTEGER NOT NULL, igst INTEGER NOT NULL, round_off INTEGER NOT NULL, grand_total INTEGER NOT NULL, payment_mode TEXT NOT NULL CHECK (payment_mode IN ('cash','upi','card','credit')), amount_tendered INTEGER, status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','cancelled')), cancel_reason TEXT, user_id INTEGER NOT NULL REFERENCES users(id), UNIQUE (fy, seq))`;
  await sql`CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(bill_date)`;
  await sql`CREATE TABLE IF NOT EXISTS invoice_items (id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, product_id INTEGER REFERENCES products(id), name TEXT NOT NULL, hsn TEXT, unit TEXT, qty REAL NOT NULL, price INTEGER NOT NULL, discount_pct REAL NOT NULL DEFAULT 0, gst_rate REAL NOT NULL, tax_inclusive INTEGER NOT NULL, gross INTEGER NOT NULL, discount INTEGER NOT NULL, taxable INTEGER NOT NULL, cgst INTEGER NOT NULL, sgst INTEGER NOT NULL, igst INTEGER NOT NULL, total INTEGER NOT NULL, cost INTEGER NOT NULL DEFAULT 0)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id)`;
  await sql`CREATE TABLE IF NOT EXISTS stock_movements (id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), change REAL NOT NULL, reason TEXT NOT NULL CHECK (reason IN ('sale','purchase','adjustment','cancel','opening')), ref TEXT, note TEXT, user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'))`;
  await sql`CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_movements(product_id)`;

  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await sql`INSERT INTO settings (key, value) VALUES (${k}, ${v}) ON CONFLICT (key) DO NOTHING`;
  }

  const users = await sql`SELECT 1 FROM users LIMIT 1`;
  if (users.length === 0) {
    const pw = hashPassword(process.env.ADMIN_PASSWORD || 'admin123');
    await sql`INSERT INTO users (username, name, password_hash, role) VALUES ('admin', 'Administrator', ${pw}, 'admin')`;
  }
}

/** Run fn inside a Postgres transaction using a pool client. */
export async function tx(ignoredDb, fn) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

/** Helper: run a parameterized query on a pool client, returns rows array. */
export function q(client, sqlStr, params = []) {
  return client.query(sqlStr, params).then((r) => r.rows);
}

export async function getSettings(sql) {
  const rows = await sql`SELECT key, value FROM settings`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Local-time timestamp helpers (server TZ, defaults to Asia/Kolkata). */
export function nowLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { date, datetime: `${date} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` };
}
