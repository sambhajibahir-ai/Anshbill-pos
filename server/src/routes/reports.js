import { Router } from 'express';
import { z } from 'zod';
import { nowLocal } from '../db.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

export default function reportRoutes(db) {
  const r = Router();

  const summary = (from, to) => db.prepare(`SELECT
      COUNT(*) AS invoices,
      COALESCE(SUM(gross), 0) AS gross, COALESCE(SUM(discount), 0) AS discount,
      COALESCE(SUM(taxable), 0) AS taxable, COALESCE(SUM(cgst), 0) AS cgst,
      COALESCE(SUM(sgst), 0) AS sgst, COALESCE(SUM(igst), 0) AS igst,
      COALESCE(SUM(round_off), 0) AS roundOff, COALESCE(SUM(grand_total), 0) AS total,
      COALESCE(ROUND(AVG(grand_total)), 0) AS avgBill
    FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ? AND ?`).get(from, to);

  const cogs = (from, to) => db.prepare(`SELECT COALESCE(SUM(ROUND(it.cost * it.qty)), 0) AS cost,
      COALESCE(SUM(it.qty), 0) AS units
    FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
    WHERE i.status = 'paid' AND i.bill_date BETWEEN ? AND ?`).get(from, to);

  function fullReport(from, to) {
    const s = summary(from, to);
    const c = cogs(from, to);
    const cancelled = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
      FROM invoices WHERE status = 'cancelled' AND bill_date BETWEEN ? AND ?`).get(from, to);
    const byPayment = db.prepare(`SELECT payment_mode AS mode, COUNT(*) AS count, SUM(grand_total) AS total
      FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ? AND ? GROUP BY payment_mode ORDER BY total DESC`)
      .all(from, to);
    const gstByRate = db.prepare(`SELECT it.gst_rate AS rate, SUM(it.taxable) AS taxable, SUM(it.cgst) AS cgst,
        SUM(it.sgst) AS sgst, SUM(it.igst) AS igst, SUM(it.total) AS total
      FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
      WHERE i.status = 'paid' AND i.bill_date BETWEEN ? AND ? GROUP BY it.gst_rate ORDER BY it.gst_rate`).all(from, to);
    const hsn = db.prepare(`SELECT COALESCE(it.hsn, '-') AS hsn, it.gst_rate AS rate, SUM(it.qty) AS qty,
        SUM(it.taxable) AS taxable, SUM(it.cgst) AS cgst, SUM(it.sgst) AS sgst, SUM(it.igst) AS igst
      FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
      WHERE i.status = 'paid' AND i.bill_date BETWEEN ? AND ? GROUP BY 1, 2 ORDER BY 1, 2`).all(from, to);
    const topProducts = db.prepare(`SELECT it.product_id AS productId, it.name, it.unit, SUM(it.qty) AS qty,
        SUM(it.total) AS total
      FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
      WHERE i.status = 'paid' AND i.bill_date BETWEEN ? AND ?
      GROUP BY it.product_id ORDER BY total DESC LIMIT 10`).all(from, to);
    const hourly = db.prepare(`SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS count,
        SUM(grand_total) AS total
      FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ? AND ? GROUP BY 1 ORDER BY 1`).all(from, to);
    const byCashier = db.prepare(`SELECT u.name, COUNT(*) AS count, SUM(i.grand_total) AS total
      FROM invoices i JOIN users u ON u.id = i.user_id
      WHERE i.status = 'paid' AND i.bill_date BETWEEN ? AND ? GROUP BY u.id ORDER BY total DESC`).all(from, to);
    return {
      from, to,
      summary: { ...s, tax: s.cgst + s.sgst + s.igst, cost: c.cost, unitsSold: c.units, grossMargin: s.taxable - c.cost },
      cancelled, byPayment, gstByRate, hsn, topProducts, hourly, byCashier,
    };
  }

  r.get('/daily', (req, res) => {
    const date = dateStr.parse(req.query.date || nowLocal().date);
    res.json(fullReport(date, date));
  });

  r.get('/range', (req, res) => {
    const from = dateStr.parse(req.query.from);
    const to = dateStr.parse(req.query.to);
    const days = db.prepare(`SELECT bill_date AS date, COUNT(*) AS invoices, SUM(taxable) AS taxable,
        SUM(cgst + sgst + igst) AS tax, SUM(grand_total) AS total
      FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ? AND ? GROUP BY bill_date ORDER BY bill_date`).all(from, to);
    res.json({ ...fullReport(from, to), days });
  });

  r.get('/dashboard', (req, res) => {
    const today = nowLocal().date;
    const d = new Date();
    d.setDate(d.getDate() - 6);
    const weekStart = nowLocal(d).date;
    const days = db.prepare(`SELECT bill_date AS date, COUNT(*) AS invoices, SUM(grand_total) AS total
      FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ? AND ? GROUP BY bill_date`).all(weekStart, today);
    const map = Object.fromEntries(days.map((x) => [x.date, x]));
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(); dd.setDate(dd.getDate() - 6 + i);
      const k = nowLocal(dd).date;
      return map[k] || { date: k, invoices: 0, total: 0 };
    });
    const stock = db.prepare(`SELECT
        SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) AS outOfStock,
        SUM(CASE WHEN stock > 0 AND stock <= reorder_level THEN 1 ELSE 0 END) AS lowStock,
        COUNT(*) AS products, COALESCE(SUM(ROUND(MAX(stock, 0) * cost)), 0) AS stockValue
      FROM products WHERE active = 1`).get();
    const recent = db.prepare(`SELECT id, invoice_no AS invoiceNo, created_at AS createdAt, customer_name AS customerName,
        grand_total AS grandTotal, payment_mode AS paymentMode, status
      FROM invoices ORDER BY id DESC LIMIT 8`).all();
    res.json({ today: summary(today, today), last7, stock, recent });
  });

  return r;
}
