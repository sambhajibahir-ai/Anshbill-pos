# ATB Software POS - Desktop Application Architecture & Operations Guide

## 1. Overview & Architecture Design
The desktop edition is located in [`desktop-app/`](file:///d:/Development/anshbill-pos/desktop-app). It transforms the ATB POS system into a completely standalone, offline-first native Windows application (`.exe`) while preserving the cloud web version intact.

```
desktop-app/
├── package.json              # Electron & electron-builder packaging config
├── src/
│   ├── main.cjs             # Electron Main Process (Lifecycle, IPC, Auto-updater)
│   └── preload.cjs          # Secure contextBridge preload script
├── server/                  # Embedded Local Offline API Server
│   └── src/
│       ├── db.js            # Embedded SQLite Engine (Node.js 22+ node:sqlite DatabaseSync)
│       ├── app.js           # Express App (CORS, Helmet, Error Handlers)
│       ├── auth.js          # Password hashing (scrypt) & Local JWT sessions
│       └── routes/          # Products, Invoices, Customers, Reports, Settings
└── build/
    ├── default-config.json  # Multi-tenant / client-specific configuration
    └── icon.ico             # Desktop app icon
```

---

## 2. Senior Engineering Decisions Addressing Your 8 Requirements

### Requirement 1: Database Option for Desktop Application
* **Recommendation**: **Embedded SQLite (via Node's built-in `node:sqlite` with WAL mode)**.
* **Why not plain JSON or Excel?**
  * **JSON files** risk corruption if the cashier's computer loses power while writing, do not support atomic multi-table transactions (invoice + invoice items + stock decrement), and degrade severely in performance once invoices exceed several thousands.
  * **Excel sheets** are not database engines; they lock on writes, do not enforce foreign keys or unique sequential invoice numbers (`AB/26-27/00001`), and cause race conditions.
  * **SQLite with WAL mode (`PRAGMA journal_mode = WAL`)**: 
    - 100% offline, zero-configuration, single-file storage per store.
    - Full ACID transaction safety (`tx()` rolls back on crash).
    - Can export to **CSV/Excel** anytime on demand (already supported via UI).
    - Backup is simply copying one file (`atbsoftware.db`).

### Requirement 2: User Credentials & Authentication Management
* **Storage**: Passwords hashed using cryptographically secure **scrypt** with random per-user salt:
  `scrypt$<saltHex>$<hashHex>`
* **Session**: Local signed JSON Web Tokens (JWT) bound to loopback interfaces.
* **Roles**:
  - `admin`: Full configuration, adding products, inventory adjustment, user creation, cancellations.
  - `cashier`: Fast scan-to-bill POS screen and view-only access.
* **First-run Provisioning**: If the database file is newly created, the system seeds an initial `admin` account (`admin` / `admin123`) and enforces/prompts password reset under Settings.

### Requirement 3: Auto Updates (electron-updater + GitHub Releases)
* Configured in [`desktop-app/src/main.cjs`](file:///d:/Development/anshbill-pos/desktop-app/src/main.cjs) and `desktop-app/package.json`:
  ```json
  "publish": [
    {
      "provider": "github",
      "owner": "sambhajibahir-ai",
      "repo": "Anshbill-pos",
      "releaseType": "release"
    }
  ]
  ```
* **Workflow**:
  1. Push a tagged release on GitHub: `git tag v1.0.1 && git push origin v1.0.1`.
  2. The GitHub action or build script compiles the Windows installer and uploads `.exe` + `latest.yml` to GitHub Releases.
  3. The desktop client checks GitHub silently in the background 10 seconds after launch.
  4. If an update is detected, it downloads in the background and applies seamlessly on app restart.

### Requirement 4: Packaging and Installation Experience
* **Packager**: `electron-builder` with custom **NSIS installer**:
  - Lets the user choose the installation directory or install silently.
  - Automatically creates Desktop and Start Menu shortcuts.
  - Clean uninstall experience that protects user database files from accidental deletion during upgrades.
  - Generates both an installer (`.exe`) and portable standalone executable.

### Requirement 5: Offline Handling & Resilient Error States
* **Zero Network Dependency**: The Express server boots locally inside the Electron process on `127.0.0.1`.
* **Dynamic Ephemeral Port**: Automatically acquires a free localhost port to avoid conflicts with other installed software or antivirus firewalls.
* **Bridge**: [`client/src/api.js`](file:///d:/Development/anshbill-pos/client/src/api.js) automatically senses if running inside Desktop and routes requests directly to the internal loopback server.
* **Hardware Interruption Protection**:
  - In-progress billing carts are preserved in `localStorage` (`atbsoftware.draft`).
  - Database writes use `BEGIN IMMEDIATE` transactions.

### Requirement 6: Client-Specific Configuration & Multi-Tenancy
* **Multi-Store / Tenant Profiles**:
  - In `desktop-app/src/main.cjs`, databases are compartmentalized by profile:
    `%APPDATA%/ATB Software POS/profiles/<profile_name>/atbsoftware.db`
  - A franchise or store owner running multiple branches or billing counters on the same workstation can switch profiles easily without data collisions.
* **Client Settings Template**:
  - [`desktop-app/build/default-config.json`](file:///d:/Development/anshbill-pos/desktop-app/build/default-config.json) allows pre-configuring shop GSTIN, address, receipt printer width (80mm / 58mm), and barcode scanner prefixes per client deployment.

### Requirement 7: Code Signing & Windows SmartScreen
When distributing a Windows desktop application, Windows Defender SmartScreen blocks unsigned executables with an *"Unknown Publisher / Windows protected your PC"* banner.
* **Professional Solution**:
  1. Obtain a **Code Signing Certificate** (OV or EV from DigiCert, Sectigo, or SSL.com).
  2. Set environment variables on the build machine:
     ```bash
     $env:CSC_LINK = "path/to/certificate.pfx"
     $env:CSC_KEY_PASSWORD = "your-certificate-password"
     ```
  3. `electron-builder` automatically signs the executable and the NSIS installer during `npm run dist:win`.
* **Budget / Open-Source Alternative**:
  - If deploying internally without purchasing an EV cert, you can generate a self-signed root authority certificate and install it in the client machine's **Trusted Root Certification Authorities** store using PowerShell:
    ```powershell
    Import-Certificate -FilePath "cert.cer" -CertStoreLocation "Cert:\LocalMachine\Root"
    ```

### Requirement 8: Operational Requirements & Build Instructions
* **Development Launch**:
  ```bash
  # In desktop-app directory
  cd desktop-app
  npm install
  npm start
  ```
* **Production Packaging**:
  ```bash
  # From root directory:
  npm run desktop:dist
  ```
  The resulting Windows installer `ATB Software POS Setup 1.0.0.exe` will be located in [`dist-electron/`](file:///d:/Development/anshbill-pos/dist-electron).
