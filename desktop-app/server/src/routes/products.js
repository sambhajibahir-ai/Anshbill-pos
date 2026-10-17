import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { tx } from '../db.js';
import { GST_RATES, ean13CheckDigit } from '../../../shared/gst.js';

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  barcode: z.string().trim().max(32).regex(/^[0-9A-Za-z\-.]*$/, 'invalid characters').optional().nullable(),
  sku: z.string().trim().max(40).optional().nullable(),
  hsn: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/, 'must be 4, 6 or 8 digits').optional().nullable(),
  unit: z.string().trim().min(1).max(10).default('pcs'),
  price: z.number().int().nonnegative(),
  cost: z.number().int().nonnegative().default(0),
  gstRate: z.number().refine((r) => GST_RATES.includes(r), 'not a valid GST slab'),
  taxInclusive: z.boolean().default(true),
  reorderLevel: z.number().nonnegative().default(0),
  category: z.string().trim().max(60).optional().nullable(),
  active: z.boolean().default(true),
});

export const toProduct = (p) => p && ({
  id: p.id, name: p.name, barcode: p.barcode, sku: p.sku, hsn: p.hsn, unit: p.unit,
  price: p.price, cost: p.cost, gstRate: p.gst_rate, taxInclusive: !!p.tax_inclusive,
  stock: p.stock, reorderLevel: p.reorder_level, category: p.category, active: !!p.active,
  lowStock: p.stock <= p.reorder_level,
});

/** In-store EAN-13 in the GS1 restricted-circulation range (prefix 200). */
const internalBarcode = (id) => {
  const first12 = `200${String(id).padStart(9, '0')}`;
  return first12 + ean13CheckDigit(first12);
};

export default function productRoutes(db) {
  const r = Router();
  const byId = db.prepare('SELECT * FROM products WHERE id = ?');

  r.get('/', (req, res) => {
    const q = String(req.query.q || '').trim();
    const where = ['1=1'];
    const params = {};
    if (!req.query.includeInactive) where.push('active = 1');
    if (req.query.lowStock) where.push('stock <= reorder_level');
    if (req.query.category) { where.push('category = $category'); params.category = String(req.query.category); }
    if (q) {
      where.push('(name LIKE $like OR barcode = $q OR sku = $q OR hsn = $q)');
      Object.assign(params, { like: `%${q}%`, q });
    }
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const rows = db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name LIMIT ${limit}`).all(params);
    res.json(rows.map(toProduct));
  });

  r.get('/alerts', (req, res) => {
    const rows = db.prepare(`SELECT * FROM products WHERE active = 1 AND stock <= reorder_level
      ORDER BY (stock <= 0) DESC, stock - reorder_level, name`).all();
    res.json(rows.map(toProduct));
  });

  r.get('/categories', (req, res) => {
    res.json(db.prepare(`SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> ''
      ORDER BY category`).all().map((c) => c.category));
  });

  r.get('/barcode/:code', (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE barcode = ? AND active = 1').get(req.params.code.trim());
    if (!p) throw new HttpError(404, `No product with barcode ${req.params.code}`);
    res.json(toProduct(p));
  });

  r.get('/:id', (req, res) => {
    const p = byId.get(Number(req.params.id));
    if (!p) throw new HttpError(404, 'Product not found');
    res.json(toProduct(p));
  });

  r.get('/:id/movements', (req, res) => {
    res.json(db.prepare(`SELECT m.*, u.name AS user_name FROM stock_movements m
      LEFT JOIN users u ON u.id = m.user_id WHERE product_id = ? ORDER BY m.id DESC LIMIT 200`).all(Number(req.params.id)));
  });

  r.post('/', requireAdmin, (req, res) => {
    const b = productSchema.extend({ openingStock: z.number().nonnegative().default(0) }).parse(req.body);
    const id = tx(db, () => {
      const { lastInsertRowid: id } = db.prepare(`INSERT INTO products
        (name, barcode, sku, hsn, unit, price, cost, gst_rate, tax_inclusive, stock, reorder_level, category, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        b.name, b.barcode || null, b.sku || null, b.hsn || null, b.unit, b.price, b.cost, b.gstRate,
        Number(b.taxInclusive), b.openingStock, b.reorderLevel, b.category || null, Number(b.active));
      if (!b.barcode) db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(internalBarcode(id), id);
      if (b.openingStock) {
        db.prepare(`INSERT INTO stock_movements (product_id, change, reason, user_id) VALUES (?, ?, 'opening', ?)`)
          .run(id, b.openingStock, req.user.id);
      }
      return id;
    });
    res.status(201).json(toProduct(byId.get(id)));
  });

  r.put('/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!byId.get(id)) throw new HttpError(404, 'Product not found');
    const b = productSchema.parse(req.body);
    db.prepare(`UPDATE products SET name=?, barcode=?, sku=?, hsn=?, unit=?, price=?, cost=?, gst_rate=?,
      tax_inclusive=?, reorder_level=?, category=?, active=?, updated_at=datetime('now','localtime') WHERE id=?`).run(
      b.name, b.barcode || internalBarcode(id), b.sku || null, b.hsn || null, b.unit, b.price, b.cost, b.gstRate,
      Number(b.taxInclusive), b.reorderLevel, b.category || null, Number(b.active), id);
    res.json(toProduct(byId.get(id)));
  });

  // Soft delete: products referenced by invoices must be kept for history.
  r.delete('/:id', requireAdmin, (req, res) => {
    const { changes } = db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(Number(req.params.id));
    if (!changes) throw new HttpError(404, 'Product not found');
    res.json({ ok: true });
  });

  // Stock in (purchase) or manual adjustment (+/-).
  r.post('/:id/stock', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const b = z.object({
      change: z.number().refine((n) => n !== 0, 'cannot be zero'),
      reason: z.enum(['purchase', 'adjustment']),
      note: z.string().max(200).optional(),
      cost: z.number().int().nonnegative().optional(),
    }).parse(req.body);
    if (b.reason === 'purchase' && b.change < 0) throw new HttpError(400, 'Purchase quantity must be positive');
    tx(db, () => {
      const p = byId.get(id);
      if (!p) throw new HttpError(404, 'Product not found');
      if (p.stock + b.change < 0) throw new HttpError(400, `Stock cannot go below zero (current ${p.stock})`);
      db.prepare(`UPDATE products SET stock = ROUND(stock + ?, 3), cost = COALESCE(?, cost),
        updated_at = datetime('now','localtime') WHERE id = ?`).run(b.change, b.cost ?? null, id);
      db.prepare('INSERT INTO stock_movements (product_id, change, reason, note, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(id, b.change, b.reason, b.note || null, req.user.id);
    });
    res.json(toProduct(byId.get(id)));
  });

  return r;
}
