# AnshBill POS

Retail billing with GST invoices, barcode scanning, stock alerts and daily sales reports.
Built with **Node.js (Express + built-in SQLite)** and **React (Vite)**.

## Features

| Area | What you get |
|---|---|
| **Billing (POS)** | Fast scan-to-bill screen. USB/Bluetooth barcode scanners work out of the box, camera scanning works on phones and tablets, and you can search by name. Type `3*<barcode>` to set quantity. Loose items take fractional quantities (kg/L). Per-line discount, cash/UPI/card/credit, change calculation, and the cart survives a page refresh. Keyboard: **F1** new bill, **F2** scan box, **F4** cash received, **F9** complete sale. |
| **GST invoices** | GST-compliant tax invoice (A4) and 80 mm thermal receipt. Sequential numbering per financial year (`AB/26-27/00001`). Automatic CGST+SGST vs IGST from place of supply, tax-inclusive (MRP) or tax-exclusive pricing, HSN-wise tax summary, round-off, amount in words, and GSTIN validation with check digit. Invoices are cancelled, never deleted, and cancelling returns the stock. |
| **Products & stock** | Product master with HSN, GST slab, unit, cost and reorder level. Auto-generated in-store EAN-13 barcodes, printable barcode labels, stock-in (purchase) and adjustments with a full movement history, and CSV export. |
| **Stock alerts** | Out-of-stock and below-reorder products, with a badge in the nav, a suggested reorder quantity, and a downloadable reorder list. |
| **Reports** | Daily and date-range reports: net sales, taxable value, GST collected, estimated gross margin, payment-mode split, GST by rate, HSN summary (for GSTR-1), top products, sales by hour, by cashier and day-wise. CSV export and print. |
| **Users** | Admin (full access) and Cashier (billing and viewing) roles, JWT sessions, scrypt password hashing, and a rate-limited login. |

## Quick start

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm install
npm run seed      # optional: loads 20 demo products
npm run dev       # API on :4000, UI on http://localhost:5173
```

Log in with **admin / admin123**, then:
1. **Settings**: enter your shop name, address and **GSTIN** (this sets your home state for CGST/SGST), and change the admin password.
2. **Products**: add products, or scan their existing barcodes into the Barcode field.
3. **New bill (F1)**: scan and bill.

## Production

```bash
npm run build                       # builds the React app into client/dist
JWT_SECRET=<long-random> npm start  # serves UI + API on :4000
```

The database lives at `server/data/anshbill.db`. Back up that file (plus `-wal`/`-shm` if present) regularly.
Camera scanning needs HTTPS (or localhost), so put the app behind a reverse proxy with TLS if tills connect over the LAN.

## Project layout

```
shared/gst.js          GST math, GSTIN/EAN validation, INR formatting (used by API and UI)
server/src/
  app.js               Express app, error handling, static hosting
  db.js                SQLite schema, settings, transactions
  routes/              auth, products, customers, invoices, reports, settings
server/test/           API integration tests
client/src/pages/      Billing, Invoices, InvoiceView (print), Products, Labels, StockAlerts, Reports, Settings
```

## Notes on money & tax

* All amounts are stored as **integer paise**, so there are no floating-point rounding errors.
* Prices on an invoice always come from the database. The client sends only product IDs, quantities and discounts.
* Tax is calculated per line and rounded to the paisa. CGST and SGST split the line tax exactly (the odd paisa goes to SGST). The grand total is rounded to the nearest rupee and the difference is shown as round-off.
* The place of supply comes from the customer's GSTIN, or the state you select. It defaults to the shop's state (B2C local sale).

## Tests

```bash
npm test
```
