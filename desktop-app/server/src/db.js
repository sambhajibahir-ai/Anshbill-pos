import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','cashier')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  barcode       TEXT UNIQUE,
  sku           TEXT,
  hsn           TEXT,
  unit          TEXT NOT NULL DEFAULT 'pcs',
  price         INTEGER NOT NULL CHECK (price >= 0),
  cost          INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
  gst_rate      REAL NOT NULL DEFAULT 0,
  tax_inclusive INTEGER NOT NULL DEFAULT 1,
  stock         REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  category      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT UNIQUE,
  gstin      TEXT,
  state_code TEXT,
  address    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no      TEXT NOT NULL UNIQUE,
  fy              TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  bill_date       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  customer_id     INTEGER REFERENCES customers(id),
  customer_name   TEXT,
  customer_phone  TEXT,
  customer_gstin  TEXT,
  place_of_supply TEXT NOT NULL,
  inter_state     INTEGER NOT NULL DEFAULT 0,
  gross           INTEGER NOT NULL,
  discount        INTEGER NOT NULL,
  taxable         INTEGER NOT NULL,
  cgst            INTEGER NOT NULL,
  sgst            INTEGER NOT NULL,
  igst            INTEGER NOT NULL,
  round_off       INTEGER NOT NULL,
  grand_total     INTEGER NOT NULL,
  payment_mode    TEXT NOT NULL CHECK (payment_mode IN ('cash','upi','card','credit')),
  amount_tendered INTEGER,
  status          TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','cancelled')),
  cancel_reason   TEXT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  UNIQUE (fy, seq)
);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(bill_date);

CREATE TABLE IF NOT EXISTS invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id    INTEGER REFERENCES products(id),
  name          TEXT NOT NULL,
  hsn           TEXT,
  unit          TEXT,
  qty           REAL NOT NULL,
  price         INTEGER NOT NULL,
  discount_pct  REAL NOT NULL DEFAULT 0,
  gst_rate      REAL NOT NULL,
  tax_inclusive INTEGER NOT NULL,
  gross         INTEGER NOT NULL,
  discount      INTEGER NOT NULL,
  taxable       INTEGER NOT NULL,
  cgst          INTEGER NOT NULL,
  sgst          INTEGER NOT NULL,
  igst          INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  cost          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  change     REAL NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('sale','purchase','adjustment','cancel','opening')),
  ref        TEXT,
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_movements(product_id);
`;

const DEFAULT_SETTINGS = {
  shop_name: 'ATB Software Retail Store',
  shop_address: 'Shop No. 1, Main Road, Pune',
  shop_phone: '',
  shop_email: '',
  shop_gstin: '',
  shop_state_code: '27',
  invoice_prefix: 'AB',
  invoice_footer: 'Thank you for shopping with us! Goods once sold will not be taken back.',
  allow_negative_stock: '0',
};

class SqliteDatabaseWrapper {
  constructor(rawDb, filePath) {
    this.rawDb = rawDb;
    this.filePath = filePath;
  }

  save() {
    if (this.filePath && this.filePath !== ':memory:') {
      try {
        const data = this.rawDb.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.filePath, buffer);
      } catch (err) {
        console.error('Failed to write database file:', err);
      }
    }
  }

  exec(sql) {
    this.rawDb.run(sql);
    this.save();
  }

  prepare(sql) {
    const self = this;
    return {
      run(...args) {
        let params = args;
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          params = args[0];
        }
        self.rawDb.run(sql, params);
        const lastIdRes = self.rawDb.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowid = lastIdRes.length && lastIdRes[0].values.length ? lastIdRes[0].values[0][0] : 0;
        const changesRes = self.rawDb.exec('SELECT changes() AS c');
        const changes = changesRes.length && changesRes[0].values.length ? changesRes[0].values[0][0] : 0;
        self.save();
        return { lastInsertRowid, changes };
      },

      get(...args) {
        let params = args;
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          params = args[0];
        }
        const stmt = self.rawDb.prepare(sql);
        try {
          if (params !== undefined) stmt.bind(params);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return null;
        } finally {
          stmt.free();
        }
      },

      all(...args) {
        let params = args;
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          params = args[0];
        }
        const stmt = self.rawDb.prepare(sql);
        const rows = [];
        try {
          if (params !== undefined) stmt.bind(params);
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      },
    };
  }
}

export async function openDb(file = process.env.DB_PATH) {
  const dbFile = file || path.resolve(import.meta.dirname, '../../data/atbsoftware.db');
  if (dbFile !== ':memory:') {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  }

  const SQL = await initSqlJs();
  let rawDb;
  if (dbFile !== ':memory:' && fs.existsSync(dbFile)) {
    const fileBuffer = fs.readFileSync(dbFile);
    rawDb = new SQL.Database(fileBuffer);
  } else {
    rawDb = new SQL.Database();
  }

  const db = new SqliteDatabaseWrapper(rawDb, dbFile);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('admin', 'Administrator', hashPassword(process.env.ADMIN_PASSWORD || 'admin123'), 'admin');
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function nowLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { date, datetime: `${date} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` };
}
