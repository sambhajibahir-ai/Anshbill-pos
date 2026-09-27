import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { tx, getSettings, nowLocal } from '../db.js';
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

function loadInvoice(db, id) {
  const inv = db.prepare(`SELECT i.*, u.name AS cashier FROM invoices i JOIN users u ON u.id = i.user_id
    WHERE i.id = ?`).get(id);
  if (!inv) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(id).map((it) => ({
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

  r.post('/', (req, res) => {
    const b = createSchema.parse(req.body);
    const settings = getSettings(db);

    // Merge repeated scans of the same product (at the same discount) into one line.
    const merged = new Map();
    for (const it of b.items) {
      const key = `${it.productId}:${it.discountPct}`;
      if (merged.has(key)) merged.get(key).qty += it.qty;
      else merged.set(key, { ...it });
    }

    const id = tx(db, () => {
      const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
      const need = new Map();
      const lines = [...merged.values()].map((it) => {
        const p = getProduct.get(it.productId);
        if (!p || !p.active) throw new HttpError(400, `Product #${it.productId} is not available`);
        const qty = Math.round(it.qty * 1000) / 1000;
        need.set(p.id, (need.get(p.id) || 0) + qty);
        // Prices always come from the database, never the client.
        return {
          productId: p.id, name: p.name, hsn: p.hsn, unit: p.unit, qty, price: p.price, cost: p.cost,
          discountPct: it.discountPct, gstRate: p.gst_rate, taxInclusive: !!p.tax_inclusive, stock: p.stock,
        };
      });

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
        const existing = db.prepare('SELECT * FROM customers WHERE phone = ?').get(c.phone);
        if (existing) {
          customerId = existing.id;
          db.prepare('UPDATE customers SET name = COALESCE(NULLIF(?, \'\'), name), gstin = COALESCE(NULLIF(?, \'\'), gstin), state_code = ? WHERE id = ?')
            .run(c.name, c.gstin, pos, existing.id);
        } else {
          customerId = Number(db.prepare('INSERT INTO customers (name, phone, gstin, state_code) VALUES (?, ?, ?, ?)')
            .run(c.name || 'Customer', c.phone, c.gstin || null, pos).lastInsertRowid);
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
      const seq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM invoices WHERE fy = ?').get(fy).n;
      const invoiceNo = `${settings.invoice_prefix}/${fy}/${String(seq).padStart(5, '0')}`;

      const { lastInsertRowid } = db.prepare(`INSERT INTO invoices
        (invoice_no, fy, seq, bill_date, created_at, customer_id, customer_name, customer_phone, customer_gstin,
         place_of_supply, inter_state, gross, discount, taxable, cgst, sgst, igst, round_off, grand_total,
         payment_mode, amount_tendered, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        invoiceNo, fy, seq, date, datetime, customerId, c.name || null, c.phone || null, c.gstin || null,
        pos, Number(interState), totals.gross, totals.discount, totals.taxable, totals.cgst, totals.sgst, totals.igst,
        totals.roundOff, totals.grandTotal, b.paymentMode, b.amountTendered ?? null, req.user.id);
      const invoiceId = Number(lastInsertRowid);

      const insItem = db.prepare(`INSERT INTO invoice_items
        (invoice_id, product_id, name, hsn, unit, qty, price, discount_pct, gst_rate, tax_inclusive,
         gross, discount, taxable, cgst, sgst, igst, total, cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const decStock = db.prepare(`UPDATE products SET stock = ROUND(stock - ?, 3) WHERE id = ?`);
      const insMove = db.prepare(`INSERT INTO stock_movements (product_id, change, reason, ref, user_id)
        VALUES (?, ?, 'sale', ?, ?)`);
      for (const l of calc) {
        insItem.run(invoiceId, l.productId, l.name, l.hsn, l.unit, l.qty, l.price, l.discountPct, l.gstRate,
          Number(l.taxInclusive), l.gross, l.discount, l.taxable, l.cgst, l.sgst, l.igst, l.total, l.cost);
        decStock.run(l.qty, l.productId);
        insMove.run(l.productId, -l.qty, invoiceNo, req.user.id);
      }
      return invoiceId;
    });

    res.status(201).json(loadInvoice(db, id));
  });

  r.get('/', (req, res) => {
    const where = ['1=1'];
    const p = {};
    if (req.query.from) { where.push('bill_date >= $from'); p.from = String(req.query.from); }
    if (req.query.to) { where.push('bill_date <= $to'); p.to = String(req.query.to); }
    if (req.query.status) { where.push('status = $status'); p.status = String(req.query.status); }
    if (req.query.paymentMode) { where.push('payment_mode = $pm'); p.pm = String(req.query.paymentMode); }
    if (req.query.q) {
      where.push('(invoice_no LIKE $q OR customer_name LIKE $q OR customer_phone LIKE $q)');
      p.q = `%${String(req.query.q).trim()}%`;
    }
    const rows = db.prepare(`SELECT i.id, invoice_no, bill_date, created_at, customer_name, customer_phone,
      grand_total, payment_mode, status, u.name AS cashier,
      (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) AS item_count
      FROM invoices i JOIN users u ON u.id = i.user_id
      WHERE ${where.join(' AND ')} ORDER BY i.id DESC LIMIT 500`).all(p);
    res.json(rows.map((x) => ({
      id: x.id, invoiceNo: x.invoice_no, billDate: x.bill_date, createdAt: x.created_at,
      customerName: x.customer_name, customerPhone: x.customer_phone, grandTotal: x.grand_total,
      paymentMode: x.payment_mode, status: x.status, cashier: x.cashier, itemCount: x.item_count,
    })));
  });

  r.get('/:id', (req, res) => {
    const inv = loadInvoice(db, Number(req.params.id));
    if (!inv) throw new HttpError(404, 'Invoice not found');
    res.json(inv);
  });

  // Invoices are never deleted (GST record keeping) - they are cancelled and stock is returned.
  r.post('/:id/cancel', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3, 'please give a reason') }).parse(req.body);
    tx(db, () => {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      if (!inv) throw new HttpError(404, 'Invoice not found');
      if (inv.status === 'cancelled') throw new HttpError(400, 'Invoice is already cancelled');
      db.prepare(`UPDATE invoices SET status = 'cancelled', cancel_reason = ? WHERE id = ?`).run(reason, id);
      const items = db.prepare('SELECT product_id, qty FROM invoice_items WHERE invoice_id = ?').all(id);
      for (const it of items) {
        db.prepare('UPDATE products SET stock = ROUND(stock + ?, 3) WHERE id = ?').run(it.qty, it.product_id);
        db.prepare(`INSERT INTO stock_movements (product_id, change, reason, ref, user_id) VALUES (?, ?, 'cancel', ?, ?)`)
          .run(it.product_id, it.qty, inv.invoice_no, req.user.id);
      }
    });
    res.json(loadInvoice(db, id));
  });

  return r;
}
