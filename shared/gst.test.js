import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcLine, calcInvoice, hsnSummary, isValidGstin, gstinCheckDigit, isValidEan13, ean13CheckDigit,
  amountInWords, financialYear,
} from './gst.js';

test('tax-inclusive line back-calculates taxable value', () => {
  // ₹118 incl. 18% => taxable ₹100, tax ₹18
  assert.deepEqual(calcLine({ price: 11800, qty: 1, gstRate: 18 }),
    { gross: 11800, discount: 0, taxable: 10000, tax: 1800, total: 11800 });
});

test('tax-exclusive line adds GST on top', () => {
  assert.deepEqual(calcLine({ price: 10000, qty: 2, gstRate: 12, taxInclusive: false }),
    { gross: 20000, discount: 0, taxable: 20000, tax: 2400, total: 22400 });
});

test('discount is applied before tax', () => {
  const l = calcLine({ price: 10000, qty: 1, discountPct: 10, gstRate: 5, taxInclusive: false });
  assert.equal(l.discount, 1000);
  assert.equal(l.taxable, 9000);
  assert.equal(l.tax, 450);
});

test('fractional quantities (loose items) are supported', () => {
  const l = calcLine({ price: 11000, qty: 1.25, gstRate: 0 });
  assert.equal(l.total, 13750);
});

test('intra-state splits CGST/SGST exactly, inter-state uses IGST', () => {
  const items = [{ price: 5800, qty: 1, gstRate: 12 }]; // taxable 5179, tax 621 (odd)
  const intra = calcInvoice(items).lines[0];
  assert.equal(intra.cgst + intra.sgst, intra.tax);
  assert.equal(intra.igst, 0);
  const inter = calcInvoice(items, { interState: true }).lines[0];
  assert.equal(inter.igst, inter.tax);
  assert.equal(inter.cgst + inter.sgst, 0);
});

test('grand total rounds to the nearest rupee with a round-off entry', () => {
  const { totals } = calcInvoice([{ price: 1050, qty: 3, gstRate: 5, taxInclusive: false }]);
  assert.equal(totals.subtotal, 3308);
  assert.equal(totals.grandTotal, 3300);
  assert.equal(totals.roundOff, -8);
  assert.equal(totals.taxable + totals.tax + totals.roundOff, totals.grandTotal);
});

test('HSN summary groups by HSN and rate', () => {
  const { lines } = calcInvoice([
    { hsn: '1905', price: 2500, qty: 2, gstRate: 18 },
    { hsn: '1905', price: 2500, qty: 1, gstRate: 18 },
    { hsn: '0401', price: 2800, qty: 1, gstRate: 0 },
  ]);
  const s = hsnSummary(lines);
  assert.equal(s.length, 2);
  assert.equal(s[1].hsn, '1905');
  assert.equal(s[1].taxable, lines[0].taxable + lines[1].taxable);
});

test('GSTIN validation checks format, state and check digit', () => {
  assert.equal(isValidGstin('27AAPFU0939F1ZV'), true);
  assert.equal(isValidGstin('27aapfu0939f1zv'), true);
  assert.equal(isValidGstin('27AAPFU0939F1ZX'), false); // wrong check digit
  assert.equal(isValidGstin('99AAPFU0939F1ZV'), false); // unknown state
  assert.equal(isValidGstin('27AAPFU0939F1Z'), false);
  assert.equal(gstinCheckDigit('27AAPFU0939F1Z'), 'V');
});

test('EAN-13 check digit', () => {
  assert.equal(ean13CheckDigit('890100000001'), '9');
  assert.equal(isValidEan13('8901000000019'), true);
  assert.equal(isValidEan13('8901000000011'), false);
  assert.equal(isValidEan13('4006381333931'), true); // canonical GS1 example
});

test('amount in words uses Indian numbering', () => {
  assert.equal(amountInWords(12345678900),
    'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only');
  assert.equal(amountInWords(105050), 'Rupees One Thousand Fifty and Fifty Paise Only');
  assert.equal(amountInWords(0), 'Rupees Zero Only');
});

test('financial year runs April to March', () => {
  assert.equal(financialYear(new Date(2026, 2, 31)), '25-26');
  assert.equal(financialYear(new Date(2026, 3, 1)), '26-27');
  assert.equal(financialYear(new Date(2099, 11, 1)), '99-00');
});
