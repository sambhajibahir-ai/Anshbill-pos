// Shared GST / billing math used by both the API (authoritative) and the UI (live preview).
// All money values are integer paise to avoid floating point drift.

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];

export const STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory',
};

const round = (n) => Math.round(n);

/**
 * Compute one invoice line.
 * @param {{price:number, qty:number, discountPct?:number, gstRate:number, taxInclusive?:boolean}} l
 *   price in paise per unit; qty may be fractional (loose items, kg).
 */
export function calcLine({ price, qty, discountPct = 0, gstRate, taxInclusive = true }) {
  const gross = round(price * qty);
  const discount = round((gross * discountPct) / 100);
  const net = gross - discount;
  let taxable, tax;
  if (taxInclusive) {
    taxable = round((net * 100) / (100 + gstRate));
    tax = net - taxable;
  } else {
    taxable = net;
    tax = round((taxable * gstRate) / 100);
  }
  return { gross, discount, taxable, tax, total: taxable + tax };
}

/**
 * Compute a full bill.
 * @param {Array} items  lines accepted by calcLine plus any extra fields (kept as-is)
 * @param {{interState?:boolean}} opts  inter-state supply => IGST, else CGST+SGST
 */
export function calcInvoice(items, { interState = false } = {}) {
  const lines = items.map((it) => {
    const c = calcLine(it);
    const cgst = interState ? 0 : Math.floor(c.tax / 2);
    const sgst = interState ? 0 : c.tax - cgst;
    const igst = interState ? c.tax : 0;
    return { ...it, ...c, cgst, sgst, igst };
  });
  const sum = (k) => lines.reduce((s, l) => s + l[k], 0);
  const subtotal = sum('total');
  const grandTotal = Math.round(subtotal / 100) * 100; // round to nearest rupee
  return {
    lines,
    totals: {
      gross: sum('gross'),
      discount: sum('discount'),
      taxable: sum('taxable'),
      cgst: sum('cgst'),
      sgst: sum('sgst'),
      igst: sum('igst'),
      tax: sum('tax'),
      subtotal,
      roundOff: grandTotal - subtotal,
      grandTotal,
    },
  };
}

/** HSN/SAC-wise tax summary, as printed at the bottom of a GST invoice. */
export function hsnSummary(lines) {
  const map = new Map();
  for (const l of lines) {
    const key = `${l.hsn || '-'}|${l.gstRate}`;
    const row = map.get(key) || { hsn: l.hsn || '-', gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += l.taxable; row.cgst += l.cgst; row.sgst += l.sgst; row.igst += l.igst;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.gstRate - b.gstRate || a.hsn.localeCompare(b.hsn));
}

// ---------- GSTIN validation (format + mod-36 check digit) ----------
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CODE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function gstinCheckDigit(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CODE.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CODE[(36 - (sum % 36)) % 36];
}

export function isValidGstin(gstin) {
  if (!gstin) return false;
  const g = gstin.toUpperCase();
  return GSTIN_RE.test(g) && STATES[g.slice(0, 2)] !== undefined && gstinCheckDigit(g.slice(0, 14)) === g[14];
}

// ---------- EAN-13 helpers (for in-store generated barcodes) ----------
export function ean13CheckDigit(first12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(first12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}

export function isValidEan13(code) {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];
}

// ---------- Formatting ----------
export function formatINR(paise, { symbol = true } = {}) {
  const v = (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `₹${v}` : v;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

function intToWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${intToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (n) parts.push(twoDigits(n));
  return parts.join(' ');
}

/** 123456 paise -> "Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only" */
export function amountInWords(paise) {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  return `Rupees ${intToWords(rupees)}${p ? ` and ${twoDigits(p)} Paise` : ''} Only`;
}

/** Indian financial year label for a date, e.g. 2026-09-26 -> "26-27" */
export function financialYear(date = new Date()) {
  const y = date.getFullYear() % 100;
  const start = date.getMonth() >= 3 ? y : y - 1;
  return `${String(start).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}
