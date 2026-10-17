# ATB Software POS

Retail billing system with GST invoices, barcode scanning, stock alerts, daily sales reports, and dual-deployment capabilities (**Web / Cloud on Vercel with Neon PostgreSQL** & **Standalone Desktop .exe with Embedded SQLite & Auto-Updates**).

Built with **React (Vite)**, **Node.js (Express)**, **PostgreSQL (Neon)** for web/cloud, and **Embedded SQLite + Electron** for desktop.

---

## Features

| Area | What you get |
|---|---|
| **Billing (POS)** | Fast scan-to-bill screen. USB/Bluetooth barcode scanners work out of the box, camera scanning works on phones and tablets, and you can search by name. Type `3*<barcode>` to set quantity. Loose items take fractional quantities (kg/L). Per-line discount, cash/UPI/card/credit, change calculation, and the cart survives a page refresh. Keyboard: **F1** new bill, **F2** scan box, **F4** cash received, **F9** complete sale. |
| **GST invoices** | GST-compliant tax invoice (A4) and 80 mm thermal receipt. Sequential numbering per financial year (`AB/26-27/00001`). Automatic CGST+SGST vs IGST from place of supply, tax-inclusive (MRP) or tax-exclusive pricing, HSN-wise tax summary, round-off, amount in words, and GSTIN validation with check digit. Invoices are cancelled, never deleted, and cancelling returns the stock. |
| **Products & stock** | Product master with HSN, GST slab, unit, cost and reorder level. Auto-generated in-store EAN-13 barcodes, printable barcode labels, stock-in (purchase) and adjustments with a full movement history, and CSV export. |
| **Stock alerts** | Out-of-stock and below-reorder products, with a badge in the nav, a suggested reorder quantity, and a downloadable reorder list. |
| **Reports** | Daily and date-range reports: net sales, taxable value, GST collected, estimated gross margin, payment-mode split, GST by rate, HSN summary (for GSTR-1), top products, sales by hour, by cashier and day-wise. CSV export and print. |
| **Users** | Admin (full access) and Cashier (billing and viewing) roles, JWT sessions, scrypt password hashing, and rate-limited login. |
| **Dual Deployment** | Web application hosted on **Vercel** with **Neon Postgres** AND Standalone **Desktop application (.exe)** with **embedded SQLite** and **auto-updates**. |

---

## 1. Web / Cloud Application (Vercel + Neon)

### Quick Start
Requires **Node.js 22.13+**.

```bash
npm install
npm run seed      # optional: loads 20 demo products into your database
npm run dev       # Starts API server on :4000 and UI on http://localhost:5173
```

Log in with **admin / admin123**, then:
1. **Settings**: enter your shop name, address, and **GSTIN** (this sets your home state for CGST/SGST), and change the admin password.
2. **Products**: add products, or scan existing barcodes.
3. **New bill (F1)**: scan and bill.

### Cloud Deployment (Vercel)
The root repository is configured for direct deployment to Vercel:
- **Build Command**: `npm run build --prefix client`
- **Output Directory**: `client/dist`
- **Functions**: `api/index.js` (Express wrapped as a serverless function)
- **Environment Variables**:
  - `DATABASE_URL`: Your Neon PostgreSQL connection string
  - `JWT_SECRET`: Random 32+ character secret
  - `TZ`: `Asia/Kolkata`
  - `NODE_ENV`: `production`

---

## 2. Desktop Application (`desktop-app/`)

The [`desktop-app/`](file:///d:/Development/anshbill-pos/desktop-app) subfolder packages the POS as a **100% offline-first Windows desktop executable (.exe)** with an installer, embedded database, and GitHub auto-updates.

### Desktop Architecture & Key Decisions

#### 1. Database: Embedded SQLite with WAL Mode
* **Engine**: Node.js built-in `node:sqlite` (`DatabaseSync`) with `PRAGMA journal_mode = WAL`.
* **Why not JSON or Excel?**
  * **JSON files** risk corruption if the cashier workstation experiences a power cut or crash while writing, lack atomic transaction safety, and degrade rapidly in performance once invoices scale.
  * **Excel sheets** lock files on save and cannot handle rapid barcode scanning or atomic sequential numbering (`AB/26-27/00001`).
  * **SQLite with WAL Mode** guarantees full ACID transaction durability (`BEGIN IMMEDIATE`), sub-millisecond local reads, single-file backup (`atbsoftware.db`), and zero native driver compilation issues. Users can still export tables to CSV/Excel anytime directly from the UI.

#### 2. User Credentials & Access Management
* **Hashing**: Passwords hashed with salted **scrypt** cryptographic functions (`scrypt$<saltHex>$<hashHex>`).
* **Session**: Signed JSON Web Tokens (JWT) verified locally on internal loopback interfaces.
* **Roles**:
  - `admin`: Complete authority (store GSTIN, stock additions, price updates, cashier account creation, invoice cancellation).
  - `cashier`: Fast scan-to-bill POS view, bill generation, and receipt printing.
* **Initial Provisioning**: First run seeds an initial `admin` account (`admin` / `admin123`) and prompts for password reset under Settings.

#### 3. Auto-Updates (`electron-updater` + GitHub Releases)
* Pre-configured in `desktop-app/package.json` and `desktop-app/src/main.cjs` to target GitHub Releases (`sambhajibahir-ai/Anshbill-pos`).
* **Workflow**:
  1. Tag a release on GitHub (e.g. `v1.0.1`).
  2. Build and upload `ATB Software POS Setup 1.0.1.exe` and `latest.yml` to GitHub Releases.
  3. The desktop app automatically checks for updates 10 seconds after launch.
  4. If an update is detected, it downloads silently and prompts the user or applies upon restart.

#### 4. Packaging & Installation Experience (NSIS)
* Configured using `electron-builder` with custom **NSIS installer**:
  - Lets users select the installation folder.
  - Automatically generates Desktop and Start Menu shortcuts.
  - Uninstallation is safe: preserves store databases in `%APPDATA%` to prevent accidental data loss during version upgrades.

#### 5. Offline Handling & Resilient Error States
* **Zero Internet Requirement**: Boots an internal Express server on `127.0.0.1` on an ephemeral port.
* **Auto-Discovery Bridge**: `client/src/api.js` automatically detects if running inside Desktop Electron or Web and connects to the active backend.
* **Crash Resilience**: In-progress billing carts are persisted in `localStorage` (`atbsoftware.draft`).

#### 6. Client-Specific Configuration & Multi-Tenancy
* **Profile Partitioning**:
  Databases are isolated per profile: `%APPDATA%/ATB Software POS/profiles/<profile_name>/atbsoftware.db`. Multiple counters or branches can run independently without data cross-contamination.
* **Configuration Template**: `desktop-app/build/default-config.json` allows pre-configuring store defaults (printer paper width, auto-print preferences, GST mode) per client deployment.

#### 7. Code Signing & Windows SmartScreen
To prevent the Windows Defender *"Unknown Publisher / Windows protected your PC"* prompt:
* Provide a Code Signing Certificate (PFX) to `electron-builder`:
  ```powershell
  $env:CSC_LINK = "path/to/certificate.pfx"
  $env:CSC_KEY_PASSWORD = "your_cert_password"
  ```
  Running `npm run dist:win` will automatically sign both the executable and the NSIS installer.

### Building & Running the Desktop Application

```bash
# Install desktop dependencies
cd desktop-app
npm install

# Run desktop app locally in development
npm start

# Build the production Windows Setup Installer (.exe)
npm run dist:win
```

The compiled installer `ATB Software POS Setup 1.0.0.exe` will be located in the `dist-electron/` folder.

---

## Project Layout

```
shared/
  gst.js                   # GST math, GSTIN/EAN validation, INR formatting (shared by API and UI)
server/                    # Cloud/Web backend (Express + Neon PostgreSQL)
  src/
    app.js                 # Express app & route middleware
    db.js                  # Neon Postgres schema, connection & transactions
    routes/                # auth, products, customers, invoices, reports, settings
client/                    # Frontend (React 19, Vite, React Router 7)
  src/
    api.js                 # Dual-mode API client (supports both Cloud /api and Desktop loopback)
    pages/                 # Billing, Invoices, Products, Labels, StockAlerts, Reports, Settings
desktop-app/               # Standalone Offline Desktop Application (Electron)
  src/
    main.cjs               # Electron main process (lifecycle, server bootstrap, updater, IPC)
    preload.cjs            # Secure contextBridge IPC bridge
  server/                  # Local embedded offline server
    src/
      db.js                # Embedded SQLite engine (node:sqlite DatabaseSync with WAL)
      app.js               # Local Express server
      routes/              # Local SQLite route handlers
  build/
    default-config.json    # Store & client configuration template
```

---

## Notes on Money & Tax

* All amounts are stored as **integer paise** (₹1.00 = 100 paise) to prevent floating-point rounding errors.
* Tax is calculated per line and rounded to the paisa. CGST and SGST split the line tax exactly (the odd paisa goes to SGST). The grand total is rounded to the nearest rupee and the difference is shown as round-off.
* The place of supply comes from the customer's GSTIN, or the state you select. It defaults to the shop's state (B2C local sale).

---

## Tests

```bash
npm test
```
