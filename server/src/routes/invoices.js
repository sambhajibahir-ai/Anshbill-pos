import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { tx, q, getSettings, nowLocal } from '../db.js';
import { calcInvoice, hsnSummary, financialYear, amountInWords, isValidGstin, STATES } from '../../../shared/gst.js';

const createSchema = z.object({
  items: z.array(z.object({
    productId: z.number().int().positive(),
    qty: z.number().positive().max(100000),
    discountPct: z.number().min(0).max(100).default(0),
  })).min(1, 'add at least one item'),
  customer: z.object({
    name: z.string().trim().max(100).optional().default(''),
    phone: z.string().trim().regex(/^([6-9]\d{9})?$/, 'must be a 10-digit mobile number').optional().default(''),
    gstin: z.string().trim().toUpperCase().refine((g) => !g || isValidGstin(g), 'invalid GSTIN').optional().default(''),
    stateCode: z.string().refine((s) => !s || STATES[s], 'unknown state code').optional().default(''),
  }).optional(),
  paymentMode: z.enum(['cash', 'upi', 'card', 'credit']),
  amountTendered: z.number().int().nonnegative().optional(),
});

async function loadInvoice(db, id) {
  const rows = await db`SELECT i.*, u.name AS cashier FROM invoices i JOIN users u ON u.id = i.user_id WHERE i.id = ${id}`;
  const inv = rows[0];
  if (!inv) return null;
  const itemRows = await db`SELECT * FROM invoice_items WHERE invoice_id = ${id} ORDER BY id`;
  const items = itemRows.map((it) => ({
    productId: it.product_id, name: it.name, hsn: it.hsn, unit: it.unit, qty: it.qty, price: it.price,
    discountPct: it.discount_pct, gstRate: it.gst_rate, taxInclusive: !!it.tax_inclusive, gross: it.gross,
    discount: it.discount, taxable: it.taxable, cgst: it.cgst, sgst: it.sgst, igst: it.igst, total: it.total,
  }));
  return {
    id: inv.id, invoiceNo: inv.invoice_no, billDate: inv.bill_date, createdAt: inv.created_at,
    customer: { id: inv.customer_id, name: inv.customer_name, phone: inv.customer_phone, gstin: inv.customer_gstin },
    placeOfSupply: inv.place_of_supply, placeOfSupplyName: STATES[inv.place_of_supply], interState: !!inv.inter_state,
    totals: {
      gross: inv.gross, discount: inv.discount, taxable: inv.taxable, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst,
      tax: inv.cgst + inv.sgst + inv.igst, roundOff: inv.round_off, grandTotal: inv.grand_total,
    },
    amountInWords: amountInWords(inv.grand_total),
    paymentMode: inv.payment_mode, amountTendered: inv.amount_tendered,
    change: inv.amount_tendered != null ? Math.max(0, inv.amount_tendered - inv.grand_total) : null,
    status: inv.status, cancelReason: inv.cancel_reason, cashier: inv.cashier,
    items, hsnSummary: hsnSummary(items),
  };
}

export default function invoiceRoutes(db) {
  const r = Router();

  r.post('/', async (req, res) => {
    const b = createSchema.parse(req.body);
    const settings = await getSettings(db);

    // Merge repeated scans of the same product (at the same discount) into one line.
    const merged = new Map();
    for (const it of b.items) {
      const key = `${it.productId}:${it.discountPct}`;
      if (merged.has(key)) merged.get(key).qty += it.qty;
      else merged.set(key, { ...it });
    }

    const id = await tx(db, async (client) => {
      // Load products and build lines
      const need = new Map();
      const lines = [];
      for (const it of merged.values()) {
        const prods = await q(client, 'SELECT * FROM products WHERE id = $1', [it.productId]);
        const p = prods[0];
        if (!p || !p.active) throw new HttpError(400, `Product #${it.productId} is not available`);
        const qty = Math.round(it.qty * 1000) / 1000;
        need.set(p.id, (need.get(p.id) || 0) + qty);
        // Prices always come from the database, never the client.
        lines.push({
          productId: p.id, name: p.name, hsn: p.hsn, unit: p.unit, qty, price: p.price, cost: p.cost,
          discountPct: it.discountPct, gstRate: p.gst_rate, taxInclusive: !!p.tax_inclusive, stock: p.stock,
        });
      }

      if (settings.allow_negative_stock !== '1') {
        for (const l of lines) {
          if (need.get(l.productId) > l.stock) {
            throw new HttpError(409, `Insufficient stock for "${l.name}" (available ${l.stock} ${l.unit})`);
          }
        }
      }

      // Customer & place of supply
      const c = b.customer || {};
      const shopState = settings.shop_state_code;
      const pos = c.gstin ? c.gstin.slice(0, 2) : c.stateCode || shopState;
      const interState = pos !== shopState;
      let customerId = null;
      if (c.phone) {
        const existing = await q(client, 'SELECT * FROM customers WHERE phone = $1', [c.phone]);
        if (existing[0]) {
          customerId = existing[0].id;
          await q(client,
            `UPDATE customers SET name = COALESCE(NULLIF($1, ''), name), gstin = COALESCE(NULLIF($2, ''), gstin), state_code = $3 WHERE id = $4`,
            [c.name, c.gstin, pos, existing[0].id]);
        } else {
          const ins = await q(client,
            `INSERT INTO customers (name, phone, gstin, state_code) VALUES ($1, $2, $3, $4) RETURNING id`,
            [c.name || 'Customer', c.phone, c.gstin || null, pos]);
          customerId = ins[0].id;
        }
      }

      const { lines: calc, totals } = calcInvoice(lines, { interState });
      if (b.paymentMode === 'cash' && b.amountTendered != null && b.amountTendered < totals.grandTotal) {
        throw new HttpError(400, 'Amount tendered is less than the bill total');
      }
      if (b.paymentMode === 'credit' && !customerId) {
        throw new HttpError(400, 'Credit sales need a customer mobile number');
      }

      // Sequential number per financial year, e.g. AB/26-27/00042 (<= 16 chars as required by GST rules)
      const now = new Date();
      const { date, datetime } = nowLocal(now);
      const fy = financialYear(now);
      const seqRows = await q(client, `SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM invoices WHERE fy = $1`, [fy]);
      const seq = seqRows[0].n;
      const invoiceNo = `${settings.invoice_prefix}/${fy}/${String(seq).padStart(5, '0')}`;

      const invRows = await q(client,
        `INSERT INTO invoices
          (invoice_no, fy, seq, bill_date, created_at, customer_id, customer_name, customer_phone, customer_gstin,
           place_of_supply, inter_state, gross, discount, taxable, cgst, sgst, igst, round_off, grand_total,
           payment_mode, amount_tendered, user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          RETURNING id`,
        [invoiceNo, fy, seq, date, datetime, customerId, c.name || null, c.phone || null, c.gstin || null,
         pos, Number(interState), totals.gross, totals.discount, totals.taxable, totals.cgst, totals.sgst, totals.igst,
         totals.roundOff, totals.grandTotal, b.paymentMode, b.amountTendered ?? null, req.user.id]);
      const invoiceId = invRows[0].id;

      for (const l of calc) {
        await q(client,
          `INSERT INTO invoice_items
            (invoice_id, product_id, name, hsn, unit, qty, price, discount_pct, gst_rate, tax_inclusive,
             gross, discount, taxable, cgst, sgst, igst, total, cost)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [invoiceId, l.productId, l.name, l.hsn, l.unit, l.qty, l.price, l.discountPct, l.gstRate,
           Number(l.taxInclusive), l.gross, l.discount, l.taxable, l.cgst, l.sgst, l.igst, l.total, l.cost]);
        await q(client,
          `UPDATE products SET stock = ROUND((stock - $1)::numeric, 3) WHERE id = $2`,
          [l.qty, l.productId]);
        await q(client,
          `INSERT INTO stock_movements (product_id, change, reason, ref, user_id) VALUES ($1, $2, 'sale', $3, $4)`,
          [l.productId, -l.qty, invoiceNo, req.user.id]);
      }
      return invoiceId;
    });

    res.status(201).json(await loadInvoice(db, id));
  });

  r.get('/', async (req, res) => {
    const conditions = [];
    const params = [];
    let pi = 1;
    if (req.query.from) { conditions.push(`bill_date >= $${pi++}`); params.push(String(req.query.from)); }
    if (req.query.to) { conditions.push(`bill_date <= $${pi++}`); params.push(String(req.query.to)); }
    if (req.query.status) { conditions.push(`status = $${pi++}`); params.push(String(req.query.status)); }
    if (req.query.paymentMode) { conditions.push(`payment_mode = $${pi++}`); params.push(String(req.query.paymentMode)); }
    if (req.query.q) {
      conditions.push(`(invoice_no ILIKE $${pi} OR customer_name ILIKE $${pi} OR customer_phone ILIKE $${pi})`);
      params.push(`%${String(req.query.q).trim()}%`); pi++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const result = await pool.query(
      `SELECT i.id, invoice_no, bill_date, created_at, customer_name, customer_phone,
        grand_total, payment_mode, status, u.name AS cashier,
        (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) AS item_count
        FROM invoices i JOIN users u ON u.id = i.user_id
        ${where} ORDER BY i.id DESC LIMIT 500`,
      params);
    await pool.end();
    res.json(result.rows.map((x) => ({
      id: x.id, invoiceNo: x.invoice_no, billDate: x.bill_date, createdAt: x.created_at,
      customerName: x.customer_name, customerPhone: x.customer_phone, grandTotal: x.grand_total,
      paymentMode: x.payment_mode, status: x.status, cashier: x.cashier, itemCount: x.item_count,
    })));
  });

  r.get('/:id', async (req, res) => {
    const inv = await loadInvoice(db, Number(req.params.id));
    if (!inv) throw new HttpError(404, 'Invoice not found');
    res.json(inv);
  });

  // Invoices are never deleted (GST record keeping) - they are cancelled and stock is returned.
  r.post('/:id/cancel', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3, 'please give a reason') }).parse(req.body);
    await tx(db, async (client) => {
      const rows = await q(client, 'SELECT * FROM invoices WHERE id = $1', [id]);
      const inv = rows[0];
      if (!inv) throw new HttpError(404, 'Invoice not found');
      if (inv.status === 'cancelled') throw new HttpError(400, 'Invoice is already cancelled');
      await q(client, `UPDATE invoices SET status = 'cancelled', cancel_reason = $1 WHERE id = $2`, [reason, id]);
      const items = await q(client, 'SELECT product_id, qty FROM invoice_items WHERE invoice_id = $1', [id]);
      for (const it of items) {
        await q(client, `UPDATE products SET stock = ROUND((stock + $1)::numeric, 3) WHERE id = $2`, [it.qty, it.product_id]);
        await q(client,
          `INSERT INTO stock_movements (product_id, change, reason, ref, user_id) VALUES ($1, $2, 'cancel', $3, $4)`,
          [it.product_id, it.qty, inv.invoice_no, req.user.id]);
      }
    });
    res.json(await loadInvoice(db, id));
  });

  return r;
}
