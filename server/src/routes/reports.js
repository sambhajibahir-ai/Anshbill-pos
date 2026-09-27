import { Router } from 'express';
import { z } from 'zod';
import { nowLocal } from '../db.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

export default function reportRoutes(db) {
  const r = Router();

  const summary = (from, to) => db`SELECT
      COUNT(*) AS invoices,
      COALESCE(SUM(gross), 0) AS gross, COALESCE(SUM(discount), 0) AS discount,
      COALESCE(SUM(taxable), 0) AS taxable, COALESCE(SUM(cgst), 0) AS cgst,
      COALESCE(SUM(sgst), 0) AS sgst, COALESCE(SUM(igst), 0) AS igst,
      COALESCE(SUM(round_off), 0) AS roundoff, COALESCE(SUM(grand_total), 0) AS total,
      COALESCE(ROUND(AVG(grand_total)), 0) AS avgbill
    FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ${from} AND ${to}`;

  const cogs = (from, to) => db`SELECT COALESCE(SUM(ROUND((it.cost * it.qty)::numeric)), 0) AS cost,
      COALESCE(SUM(it.qty), 0) AS units
    FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
    WHERE i.status = 'paid' AND i.bill_date BETWEEN ${from} AND ${to}`;

  async function fullReport(from, to) {
    const [s] = await summary(from, to);
    const [c] = await cogs(from, to);
    const [cancelled] = await db`SELECT COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
      FROM invoices WHERE status = 'cancelled' AND bill_date BETWEEN ${from} AND ${to}`;
    const byPayment = await db`SELECT payment_mode AS mode, COUNT(*) AS count, SUM(grand_total) AS total
      FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ${from} AND ${to} GROUP BY payment_mode ORDER BY total DESC`;
    const gstByRate = await db`SELECT it.gst_rate AS rate, SUM(it.taxable) AS taxable, SUM(it.cgst) AS cgst,
        SUM(it.sgst) AS sgst, SUM(it.igst) AS igst, SUM(it.total) AS total
      FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
      WHERE i.status = 'paid' AND i.bill_date BETWEEN ${from} AND ${to} GROUP BY it.gst_rate ORDER BY it.gst_rate`;
    const hsn = await db`SELECT COALESCE(it.hsn, '-') AS hsn, it.gst_rate AS rate, SUM(it.qty) AS qty,
        SUM(it.taxable) AS taxable, SUM(it.cgst) AS cgst, SUM(it.sgst) AS sgst, SUM(it.igst) AS igst
      FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
      WHERE i.status = 'paid' AND i.bill_date BETWEEN ${from} AND ${to} GROUP BY 1, 2 ORDER BY 1, 2`;
    const topProducts = await db`SELECT it.product_id AS productid, it.name, it.unit, SUM(it.qty) AS qty,
        SUM(it.total) AS total
      FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
      WHERE i.status = 'paid' AND i.bill_date BETWEEN ${from} AND ${to}
      GROUP BY it.product_id, it.name, it.unit ORDER BY total DESC LIMIT 10`;
    const hourly = await db`SELECT SUBSTRING(created_at, 12, 2)::integer AS hour, COUNT(*) AS count,
        SUM(grand_total) AS total
      FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ${from} AND ${to} GROUP BY 1 ORDER BY 1`;
    const byCashier = await db`SELECT u.name, COUNT(*) AS count, SUM(i.grand_total) AS total
      FROM invoices i JOIN users u ON u.id = i.user_id
      WHERE i.status = 'paid' AND i.bill_date BETWEEN ${from} AND ${to} GROUP BY u.id, u.name ORDER BY total DESC`;
    return {
      from, to,
      summary: {
        invoices: Number(s.invoices), gross: Number(s.gross), discount: Number(s.discount),
        taxable: Number(s.taxable), cgst: Number(s.cgst), sgst: Number(s.sgst), igst: Number(s.igst),
        roundOff: Number(s.roundoff), total: Number(s.total), avgBill: Number(s.avgbill),
        tax: Number(s.cgst) + Number(s.sgst) + Number(s.igst),
        cost: Number(c.cost), unitsSold: Number(c.units),
        grossMargin: Number(s.taxable) - Number(c.cost),
      },
      cancelled: { count: Number(cancelled.count), total: Number(cancelled.total) },
      byPayment: byPayment.map((x) => ({ mode: x.mode, count: Number(x.count), total: Number(x.total) })),
      gstByRate, hsn,
      topProducts: topProducts.map((x) => ({ ...x, qty: Number(x.qty), total: Number(x.total) })),
      hourly: hourly.map((x) => ({ hour: Number(x.hour), count: Number(x.count), total: Number(x.total) })),
      byCashier: byCashier.map((x) => ({ name: x.name, count: Number(x.count), total: Number(x.total) })),
    };
  }

  r.get('/daily', async (req, res) => {
    const date = dateStr.parse(req.query.date || nowLocal().date);
    res.json(await fullReport(date, date));
  });

  r.get('/range', async (req, res) => {
    const from = dateStr.parse(req.query.from);
    const to = dateStr.parse(req.query.to);
    const days = await db`SELECT bill_date AS date, COUNT(*) AS invoices, SUM(taxable) AS taxable,
        SUM(cgst + sgst + igst) AS tax, SUM(grand_total) AS total
      FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ${from} AND ${to} GROUP BY bill_date ORDER BY bill_date`;
    res.json({ ...await fullReport(from, to), days });
  });

  r.get('/dashboard', async (req, res) => {
    const today = nowLocal().date;
    const d = new Date();
    d.setDate(d.getDate() - 6);
    const weekStart = nowLocal(d).date;
    const days = await db`SELECT bill_date AS date, COUNT(*) AS invoices, SUM(grand_total) AS total
      FROM invoices WHERE status = 'paid' AND bill_date BETWEEN ${weekStart} AND ${today} GROUP BY bill_date`;
    const map = Object.fromEntries(days.map((x) => [x.date, x]));
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(); dd.setDate(dd.getDate() - 6 + i);
      const k = nowLocal(dd).date;
      return map[k] || { date: k, invoices: 0, total: 0 };
    });
    const [stock] = await db`SELECT
        SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) AS outofstock,
        SUM(CASE WHEN stock > 0 AND stock <= reorder_level THEN 1 ELSE 0 END) AS lowstock,
        COUNT(*) AS products, COALESCE(SUM(ROUND(GREATEST(stock, 0) * cost)), 0) AS stockvalue
      FROM products WHERE active = 1`;
    const recent = await db`SELECT id, invoice_no AS invoiceno, created_at AS createdat, customer_name AS customername,
        grand_total AS grandtotal, payment_mode AS paymentmode, status
      FROM invoices ORDER BY id DESC LIMIT 8`;
    const [todaySummary] = await summary(today, today);
    res.json({
      today: todaySummary,
      last7,
      stock: {
        outOfStock: Number(stock.outofstock),
        lowStock: Number(stock.lowstock),
        products: Number(stock.products),
        stockValue: Number(stock.stockvalue),
      },
      recent: recent.map((x) => ({
        id: x.id, invoiceNo: x.invoiceno, createdAt: x.createdat, customerName: x.customername,
        grandTotal: x.grandtotal, paymentMode: x.paymentmode, status: x.status,
      })),
    });
  });

  return r;
}
