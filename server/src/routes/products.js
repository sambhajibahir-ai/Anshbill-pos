import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { tx, q } from '../db.js';
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

  r.get('/', async (req, res) => {
    const qs = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    let rows;
    if (qs) {
      rows = req.query.includeInactive
        ? await db`SELECT * FROM products WHERE (name ILIKE ${'%' + qs + '%'} OR barcode = ${qs} OR sku = ${qs} OR hsn = ${qs}) ORDER BY name LIMIT ${limit}`
        : await db`SELECT * FROM products WHERE active = 1 AND (name ILIKE ${'%' + qs + '%'} OR barcode = ${qs} OR sku = ${qs} OR hsn = ${qs}) ORDER BY name LIMIT ${limit}`;
    } else if (req.query.lowStock) {
      rows = await db`SELECT * FROM products WHERE active = 1 AND stock <= reorder_level ORDER BY name LIMIT ${limit}`;
    } else if (req.query.category) {
      rows = req.query.includeInactive
        ? await db`SELECT * FROM products WHERE category = ${String(req.query.category)} ORDER BY name LIMIT ${limit}`
        : await db`SELECT * FROM products WHERE active = 1 AND category = ${String(req.query.category)} ORDER BY name LIMIT ${limit}`;
    } else {
      rows = req.query.includeInactive
        ? await db`SELECT * FROM products ORDER BY name LIMIT ${limit}`
        : await db`SELECT * FROM products WHERE active = 1 ORDER BY name LIMIT ${limit}`;
    }
    res.json(rows.map(toProduct));
  });

  r.get('/alerts', async (req, res) => {
    const rows = await db`SELECT * FROM products WHERE active = 1 AND stock <= reorder_level
      ORDER BY (stock <= 0) DESC, stock - reorder_level, name`;
    res.json(rows.map(toProduct));
  });

  r.get('/categories', async (req, res) => {
    const rows = await db`SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> '' ORDER BY category`;
    res.json(rows.map((c) => c.category));
  });

  r.get('/barcode/:code', async (req, res) => {
    const rows = await db`SELECT * FROM products WHERE barcode = ${req.params.code.trim()} AND active = 1`;
    if (!rows[0]) throw new HttpError(404, `No product with barcode ${req.params.code}`);
    res.json(toProduct(rows[0]));
  });

  r.get('/:id', async (req, res) => {
    const rows = await db`SELECT * FROM products WHERE id = ${Number(req.params.id)}`;
    if (!rows[0]) throw new HttpError(404, 'Product not found');
    res.json(toProduct(rows[0]));
  });

  r.get('/:id/movements', async (req, res) => {
    const rows = await db`SELECT m.*, u.name AS user_name FROM stock_movements m
      LEFT JOIN users u ON u.id = m.user_id WHERE product_id = ${Number(req.params.id)} ORDER BY m.id DESC LIMIT 200`;
    res.json(rows);
  });

  r.post('/', requireAdmin, async (req, res) => {
    const b = productSchema.extend({ openingStock: z.number().nonnegative().default(0) }).parse(req.body);
    const id = await tx(db, async (client) => {
      const inserted = await q(client,
        `INSERT INTO products (name, barcode, sku, hsn, unit, price, cost, gst_rate, tax_inclusive, stock, reorder_level, category, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [b.name, b.barcode || null, b.sku || null, b.hsn || null, b.unit, b.price, b.cost, b.gstRate,
         Number(b.taxInclusive), b.openingStock, b.reorderLevel, b.category || null, Number(b.active)]);
      const newId = inserted[0].id;
      if (!b.barcode) {
        await q(client, 'UPDATE products SET barcode = $1 WHERE id = $2', [internalBarcode(newId), newId]);
      }
      if (b.openingStock) {
        await q(client, `INSERT INTO stock_movements (product_id, change, reason, user_id) VALUES ($1, $2, 'opening', $3)`,
          [newId, b.openingStock, req.user.id]);
      }
      return newId;
    });
    const rows = await db`SELECT * FROM products WHERE id = ${id}`;
    res.status(201).json(toProduct(rows[0]));
  });

  r.put('/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db`SELECT id FROM products WHERE id = ${id}`;
    if (!existing[0]) throw new HttpError(404, 'Product not found');
    const b = productSchema.parse(req.body);
    await db`UPDATE products SET name=${b.name}, barcode=${b.barcode || internalBarcode(id)}, sku=${b.sku || null}, hsn=${b.hsn || null}, unit=${b.unit}, price=${b.price}, cost=${b.cost}, gst_rate=${b.gstRate}, tax_inclusive=${Number(b.taxInclusive)}, reorder_level=${b.reorderLevel}, category=${b.category || null}, active=${Number(b.active)}, updated_at=TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') WHERE id=${id}`;
    const rows = await db`SELECT * FROM products WHERE id = ${id}`;
    res.json(toProduct(rows[0]));
  });

  // Soft delete: products referenced by invoices must be kept for history.
  r.delete('/:id', requireAdmin, async (req, res) => {
    const result = await db`UPDATE products SET active = 0 WHERE id = ${Number(req.params.id)} RETURNING id`;
    if (!result.length) throw new HttpError(404, 'Product not found');
    res.json({ ok: true });
  });

  // Stock in (purchase) or manual adjustment (+/-).
  r.post('/:id/stock', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const b = z.object({
      change: z.number().refine((n) => n !== 0, 'cannot be zero'),
      reason: z.enum(['purchase', 'adjustment']),
      note: z.string().max(200).optional(),
      cost: z.number().int().nonnegative().optional(),
    }).parse(req.body);
    if (b.reason === 'purchase' && b.change < 0) throw new HttpError(400, 'Purchase quantity must be positive');
    await tx(db, async (client) => {
      const prod = await q(client, 'SELECT * FROM products WHERE id = $1', [id]);
      if (!prod[0]) throw new HttpError(404, 'Product not found');
      if (prod[0].stock + b.change < 0) throw new HttpError(400, `Stock cannot go below zero (current ${prod[0].stock})`);
      await q(client,
        `UPDATE products SET stock = ROUND((stock + $1)::numeric, 3), cost = COALESCE($2, cost),
          updated_at = TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $3`,
        [b.change, b.cost ?? null, id]);
      await q(client,
        `INSERT INTO stock_movements (product_id, change, reason, note, user_id) VALUES ($1, $2, $3, $4, $5)`,
        [id, b.change, b.reason, b.note || null, req.user.id]);
    });
    const rows = await db`SELECT * FROM products WHERE id = ${id}`;
    res.json(toProduct(rows[0]));
  });

  return r;
}
