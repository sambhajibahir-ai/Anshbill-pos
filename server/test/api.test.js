process.env.TZ = 'Asia/Kolkata';
process.env.DB_PATH = ':memory:';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { openDb } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');

let server, base, token;

async function api(method, path, body, auth = token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && { Authorization: `Bearer ${auth}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  server = createApp(openDb(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' }, null);
  assert.equal(login.status, 200);
  token = login.body.token;
});

after(() => server.close());

test('rejects unauthenticated and bad logins', async () => {
  assert.equal((await api('GET', '/products', null, null)).status, 401);
  assert.equal((await api('POST', '/auth/login', { username: 'admin', password: 'nope' }, null)).status, 401);
});

let soap, rice;

test('creates products and auto-generates a barcode', async () => {
  const a = await api('POST', '/products', {
    name: 'Soap', hsn: '3401', price: 5900, cost: 4000, gstRate: 18, openingStock: 10, reorderLevel: 3,
  });
  assert.equal(a.status, 201);
  assert.match(a.body.barcode, /^200\d{10}$/);
  soap = a.body;
  const b = await api('POST', '/products', {
    name: 'Rice', barcode: '8901000000019', unit: 'kg', hsn: '1006', price: 10000, gstRate: 5, openingStock: 5,
  });
  rice = b.body;
  assert.equal((await api('GET', `/products/barcode/${rice.barcode}`)).body.id, rice.id);
  assert.equal((await api('POST', '/products', { name: 'X', barcode: rice.barcode, price: 1, gstRate: 0 })).status, 409);
  assert.equal((await api('POST', '/products', { name: 'X', price: 1, gstRate: 7 })).status, 400);
});

let invoice;

test('bills an intra-state invoice, merges repeat scans and deducts stock', async () => {
  const r = await api('POST', '/invoices', {
    items: [{ productId: soap.id, qty: 1 }, { productId: soap.id, qty: 1 }, { productId: rice.id, qty: 1.5 }],
    paymentMode: 'cash', amountTendered: 30000,
    customer: { name: 'Ravi', phone: '9876543210' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  invoice = r.body;
  assert.match(invoice.invoiceNo, /^AB\/\d{2}-\d{2}\/00001$/);
  assert.equal(invoice.items.length, 2);
  assert.equal(invoice.items[0].qty, 2);
  assert.equal(invoice.interState, false);
  assert.equal(invoice.totals.igst, 0);
  // 2 x 59 + 1.5 x 100 = 268
  assert.equal(invoice.totals.grandTotal, 26800);
  assert.equal(invoice.change, 3200);
  assert.equal((await api('GET', `/products/${soap.id}`)).body.stock, 8);
  assert.equal((await api('GET', `/products/${rice.id}`)).body.stock, 3.5);
});

test('customer from another state gets IGST', async () => {
  const r = await api('POST', '/invoices', {
    items: [{ productId: soap.id, qty: 1 }], paymentMode: 'upi',
    customer: { name: 'Acme', gstin: '29AAPFU0939F1ZX'.slice(0, 14) + 'X' },
  });
  assert.equal(r.status, 400); // invalid check digit
  const ok = await api('POST', '/invoices', {
    items: [{ productId: soap.id, qty: 1 }], paymentMode: 'upi', customer: { name: 'Acme', stateCode: '29' },
  });
  assert.equal(ok.body.interState, true);
  assert.equal(ok.body.totals.cgst, 0);
  assert.ok(ok.body.totals.igst > 0);
  assert.match(ok.body.invoiceNo, /00002$/);
});

test('blocks overselling and flags low stock', async () => {
  const r = await api('POST', '/invoices', { items: [{ productId: rice.id, qty: 10 }], paymentMode: 'cash' });
  assert.equal(r.status, 409);
  await api('POST', '/invoices', { items: [{ productId: soap.id, qty: 5 }], paymentMode: 'card' });
  const alerts = (await api('GET', '/products/alerts')).body;
  assert.ok(alerts.some((p) => p.id === soap.id && p.stock === 2));
});

test('ignores client-supplied prices', async () => {
  const r = await api('POST', '/invoices', {
    items: [{ productId: soap.id, qty: 1, price: 1 }], paymentMode: 'cash',
  });
  assert.equal(r.body.items[0].price, 5900);
});

test('cancelling an invoice restores stock and excludes it from reports', async () => {
  const before = (await api('GET', '/reports/daily')).body.summary;
  const c = await api('POST', `/invoices/${invoice.id}/cancel`, { reason: 'Customer returned' });
  assert.equal(c.body.status, 'cancelled');
  assert.equal((await api('GET', `/products/${rice.id}`)).body.stock, 5);
  assert.equal((await api('POST', `/invoices/${invoice.id}/cancel`, { reason: 'again' })).status, 400);
  const after = (await api('GET', '/reports/daily')).body;
  assert.equal(after.summary.invoices, before.invoices - 1);
  assert.equal(after.summary.total, before.total - invoice.totals.grandTotal);
  assert.equal(after.cancelled.count, 1);
  const rateSum = after.gstByRate.reduce((s, r) => s + r.taxable, 0);
  assert.equal(rateSum, after.summary.taxable);
});

test('cashiers cannot manage products or cancel invoices', async () => {
  await api('POST', '/auth/users', { username: 'cash1', name: 'Cashier', password: 'secret1', role: 'cashier' });
  const t = (await api('POST', '/auth/login', { username: 'cash1', password: 'secret1' }, null)).body.token;
  assert.equal((await api('POST', '/products', { name: 'Y', price: 1, gstRate: 0 }, t)).status, 403);
  assert.equal((await api('POST', `/invoices/${invoice.id}/cancel`, { reason: 'test' }, t)).status, 403);
  assert.equal((await api('GET', '/products', null, t)).status, 200);
});
