<div align="center">

```
╔══════════════════════════════════════════════════════╗
║          ☕  BLOOM CAFE POS  ☕                       ║
║   Fast · Offline · Built for real café life           ║
╚══════════════════════════════════════════════════════╝
```

<p>
  <img src="https://img.shields.io/badge/version-1.2.0-brown?style=for-the-badge" />
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4?style=for-the-badge&logo=windows&logoColor=white" />
  <img src="https://img.shields.io/badge/Electron-28-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img src="https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white" />
  <img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge" />
</p>

<p>
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/better--sqlite3-native-FF6B35?style=flat-square" />
  <img src="https://img.shields.io/badge/Jest-tested-C21325?style=flat-square&logo=jest" />
  <img src="https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white" />
  <img src="https://img.shields.io/badge/printer-58mm%20thermal-8B5CF6?style=flat-square" />
</p>

**A professional, fully offline Point of Sale system — built for Bloom Cafe.**
Zero cloud. Zero subscriptions. Every rupee of data lives on your machine.

*Developed by [Ayush Kaushik](mailto:coc123.1607@gmail.com) · Delivered to Bloom Cafe, Sarthak Adwani*

</div>

---

## 📌 Table of Contents

- [What this is](#-what-this-is)
- [Features](#-features)
- [System Pipeline](#-system-pipeline)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Database Migrations](#-database-migrations)
- [Testing](#-testing)
- [CI / CD](#-ci--cd)
- [Release Package](#-release-package)
- [Changelog](#-changelog)
- [License](#-license)

---

## 💡 What this is

Bloom Cafe POS is a **desktop billing and café management system** that runs entirely on Windows — no internet, no monthly fees, no data going anywhere.

It handles everything from the moment a customer sits down to the moment the receipt prints:

- Take orders at up to 6 tables simultaneously
- Supports item add-ons, half/full variants, and discounts
- Finalizes bills with Cash, UPI, or Card
- Prints to 58mm thermal printers automatically
- Tracks inventory, deducting stock on every sale
- Shows daily revenue, 7-day trends, and payment breakdowns on the dashboard

Built on **Electron + SQLite** — proven desktop-grade tech used by companies like Slack and VS Code.

---

## ✨ Features

| Module | Capability |
|---|---|
| 🪑 **Tables** | Visual 6-table layout, simultaneous sessions, live status indicators |
| 🛒 **Orders** | Add items, add-ons, Half/Full variants; edit cart before billing |
| 💰 **Billing** | Auto-numbered bills (`BC-YYYYMMDD-N`), Cash / UPI / Card payment modes |
| 💵 **Cash Handling** | Enter received amount → live change calculation → blocks short payment |
| 🖨️ **Thermal Print** | Optimized for EC-58 58mm, bold dark print, 32-char monospace layout |
| 📊 **Dashboard** | Date navigation, vs-yesterday deltas, 7-day bar chart, top items, CSV export |
| 📦 **Inventory** | Product-linked stock, auto-deduct on checkout, low-stock alerts, bulk restock |
| 🍽️ **Menu Manager** | Categories, products, pricing, add-ons, availability toggles |
| 🔖 **Discounts** | None / 10% / 20% / Custom — applied before finalization |
| ⚙️ **Settings** | Table count, inventory on/off, printer selection, auto-print toggle |
| 🔁 **Reprint** | Reprint any past bill from the dashboard with correct cash amounts |
| 📋 **Audit Log** | Full trail of every bill, edit, and inventory change |

---

## 🔁 System Pipeline

> A full visual breakdown of how data flows through every layer of the system.

**[→ View Interactive Pipeline Diagram](./docs/pipeline-visual.html)**

```
  ORDER FLOW
  ──────────
  Table Selected
      │
      ▼
  Add Items to Cart ──────────────────┐
      │                               │
      ▼                               ▼
  Save Session (orders table)    Edit / Remove items
      │
      ▼
  Open Bill Preview
      │
      ├─── Cash ──→ Enter Amount → Validate ≥ Total
      ├─── UPI  ──→ (no cash field)
      └─── Card ──→ (no cash field)
      │
      ▼
  ⚡ Atomic DB Transaction
      ├── Deduct inventory (per item sold)
      ├── Generate bill number (BC-YYYYMMDD-N)
      ├── INSERT into bills (with cash_received)
      ├── Write audit log
      └── Mark order complete
      │
      ▼
  Receipt Rendered → Print / Skip

  ARCHITECTURE
  ────────────
  Renderer (HTML/JS/CSS)
      │  window.electronAPI.*
      ▼
  Preload (contextBridge)
      │  ipcRenderer.invoke
      ▼
  Main Process (IPC handlers)
      │  better-sqlite3
      ▼
  SQLite Database (WAL mode)
```

---

## 🏗️ Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Desktop shell** | Electron 28 | Native OS integration, window management, printer access |
| **Database** | better-sqlite3 (SQLite) | Synchronous, zero-config, 100% offline, WAL mode for durability |
| **IPC** | contextBridge + ipcRenderer | Strict security isolation between renderer and main |
| **Frontend** | Vanilla JS + CSS | Zero runtime dependencies, instant load, full control |
| **Build** | electron-builder → NSIS | One-click Windows installer with shortcuts |
| **CI/CD** | GitHub Actions (windows-latest) | Automated Windows builds on every push to main |
| **Testing** | Jest | Unit + integration coverage |
| **Logging** | Custom structured logger | Persistent log files with rotation |

---

## 🗂️ Project Structure

```
bloom-cafe-pos/
│
├── src/
│   ├── main/                        # ⚙️  Electron main process (Node.js)
│   │   ├── db/
│   │   │   ├── database.js          # DB init, schema creation, WAL setup
│   │   │   ├── migrate.js           # Migration runner (v1 → v4)
│   │   │   ├── queries.js           # All SQL queries — single source of truth
│   │   │   └── seed-data.js         # Default menu for fresh installs
│   │   ├── ipc/
│   │   │   ├── billing.ipc.js       # finalize-bill, delete-bill, mark-printed
│   │   │   ├── inventory.ipc.js     # stock CRUD, sync, bulk restock
│   │   │   ├── menu.ipc.js          # categories, products, add-ons
│   │   │   ├── orders.ipc.js        # active session management
│   │   │   ├── dashboard.ipc.js     # sales data, weekly chart
│   │   │   ├── printer.ipc.js       # webContents.print() wrapper
│   │   │   ├── settings.ipc.js      # read/write app settings
│   │   │   └── system.ipc.js        # integrity checks, health
│   │   ├── services/
│   │   │   ├── session.service.js   # In-memory order state
│   │   │   ├── analytics.service.js # Revenue aggregation helpers
│   │   │   ├── backup.service.js    # DB backup utility
│   │   │   ├── file.service.js      # Date helpers, path utils
│   │   │   └── health.service.js    # DB integrity verification
│   │   ├── logger.js                # Structured event logger
│   │   ├── validator.js             # Payload validation
│   │   ├── preload.js               # contextBridge API surface
│   │   └── main.js                  # App entry point
│   │
│   └── renderer/                    # 🖥️  Frontend (HTML + vanilla JS + CSS)
│       ├── index.html               # Single-page app shell
│       ├── js/
│       │   ├── app.js               # Boot, routing, settings loader
│       │   ├── order.js             # Table UI, menu rendering
│       │   ├── cart.js              # Cart state management
│       │   ├── bill.js              # Receipt render, finalization, print
│       │   ├── dashboard.js         # Stats cards, charts, bills list
│       │   ├── inventory.js         # Stock management UI
│       │   ├── menu-manager.js      # Menu edit UI
│       │   ├── store.js             # Shared state
│       │   └── utils.js             # Helpers, toast, modals
│       └── styles/
│           ├── base.css             # Reset, variables, typography
│           ├── layout.css           # App shell, sidebar, panels
│           ├── components.css       # Buttons, modals, cards
│           ├── dashboard.css        # Dashboard-specific styles
│           ├── inventory.css        # Inventory-specific styles
│           ├── utilities.css        # Helper classes
│           └── print.css            # @media print — thermal receipt
│
├── tests/
│   ├── unit/
│   │   ├── validator.test.js        # Input validation tests
│   │   ├── analytics.service.test.js
│   │   └── file.service.test.js
│   └── integration/                 # (in progress)
│
├── docs/
│   ├── pipeline-visual.html         # 🔁 Interactive system pipeline diagram
│   ├── BUSINESS_LOGIC_ANALYSIS.md
│   ├── WINDOWS_INSTALLER_BUILD.md
│   └── WINDOWS_THERMAL_PRINTER_FIX.md
│
├── config/
│   └── app.config.js                # Tunable constants
│
├── assets/
│   └── icons/                       # App icons (PNG + ICO)
│
├── Release_Package/                 # 📦 Client delivery bundle
│   ├── Bloom_Cafe_POS_Setup.exe     # Windows installer
│   ├── USER_MANUAL.pdf              # 10-chapter end-user guide
│   ├── INSTALLATION_GUIDE.pdf       # Step-by-step setup guide
│   ├── APP_FEATURES.md
│   └── LICENSE.txt
│
├── .github/
│   └── workflows/
│       └── build-windows.yml        # CI: auto-build Windows installer
│
├── CHANGELOG.md
├── package.json
└── .gitignore
```

---

## 🚀 Getting Started

### For development

```bash
# 1. Clone the repo
git clone https://github.com/ww2d2vjh8c-lab/bloom-cafe-pos.git
cd bloom-cafe-pos

# 2. Install dependencies
npm install

# 3. Start in development mode
npm start
```

### Build Windows installer locally

```bash
npm run build:win
# → dist/Bloom Cafe POS Setup 1.2.0.exe
```

> **Note:** The Windows build requires running on a Windows machine or using the GitHub Actions CI workflow below.

### System requirements

| | Minimum |
|---|---|
| OS | Windows 10 (64-bit) |
| RAM | 2 GB |
| Storage | 200 MB |
| Printer | Any thermal (58mm recommended) or standard printer |

---

## 🗃️ Database Migrations

The app uses a version-tracked migration system. Migrations run automatically on startup — they are **idempotent** (safe to run multiple times).

| Version | Name | What it does |
|---|---|---|
| v0 | Fresh install | Base schema created, seed menu inserted |
| v1 | JSON → SQLite | Migrates legacy `menu.json` and `inventory.json` into DB |
| v2 | Schema cleanup | Drops zombie tables, adds `time`, `idempotency_key`, `print_status` to bills |
| v3 | Product-linked inventory | Adds `product_id` FK + `archived` flag to inventory, enables soft-delete |
| v4 | Cash received | Adds `cash_received` column to bills — reprints now show correct cash amounts |

**DB location at runtime:**
```
Windows: %APPDATA%\Bloom Cafe POS\bloom-cafe.db
```

---

## 🧪 Testing

```bash
npm test                   # run all tests
npm run test:coverage      # with coverage report
```

Current coverage targets: `validator.js`, `analytics.service.js`, `file.service.js`

---

## ⚙️ CI / CD

Every push to `main` triggers an automated Windows build via **GitHub Actions**:

```
Push to main
    │
    ▼
windows-latest runner
    │
    ├── npm ci
    ├── npm run electron-rebuild
    └── npm run build:win
            │
            ▼
    Artifact: Bloom Cafe POS Setup *.exe
    (downloadable from Actions tab)
```

See [`.github/workflows/build-windows.yml`](./.github/workflows/build-windows.yml)

---

## 📦 Release Package

The `Release_Package/` directory is the full client delivery bundle:

```
Release_Package/
├── Bloom_Cafe_POS_Setup.exe     ← Windows NSIS installer
├── USER_MANUAL.pdf              ← 10-chapter end-user guide
├── INSTALLATION_GUIDE.pdf       ← Step-by-step for non-technical users
├── APP_FEATURES.md              ← Complete feature reference
├── LICENSE.txt                  ← MIT license
└── assets/                      ← Screenshots (coming soon)
```

> The `.exe` and `.pdf` files are excluded from git (see `.gitignore`). They are built separately and handed to the client.

---

## 📋 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for full version history.

---

## 📄 License

**MIT © 2025 Ayush Kaushik**

> The client (Bloom Cafe / Sarthak Adwani) holds a perpetual license to use and operate this software.

---

<div align="center">

```
Built with ☕ and Node.js by Ayush Kaushik
coc123.1607@gmail.com
```

*Point of Sale system delivered to Bloom Cafe, 2026*

</div>


---

## 🔍 Inspect & Debug Locally

This section covers how to run, inspect, and test Bloom Cafe POS on your Windows machine (or cross-platform in dev mode).

### 1. Clone & Run in Dev Mode

```bash
git clone https://github.com/ww2d2vjh8c-lab/POS-BASIC-BILLING
cd POS-BASIC-BILLING
npm install
npm start          # Electron window opens automatically
```

> **Note:** The app is built for Windows. Dev mode works on any OS, but thermal printer integration and the NSIS installer require Windows.

### 2. Build the Windows Installer Locally

```bash
npm run build:win
# → dist/Bloom Cafe POS Setup 1.2.0.exe
```

Requires Windows or the GitHub Actions CI workflow (which builds on `windows-latest` automatically on every push to `main`).

### 3. Open Electron DevTools

While the app is running, press **`Ctrl + Shift + I`** (or `F12`) inside the Electron window.

This opens Chromium DevTools attached to the renderer process. From here:

- **Console** — see `window.electronAPI.*` calls, IPC bridge events, and any renderer-side errors
- **Sources** — browse and set breakpoints in `src/renderer/js/*.js` files
- **Elements** — inspect the live DOM, CSS, and layout of every screen
- **Network** — not applicable (fully offline), but useful if you add any external calls

To enable DevTools programmatically (in case keyboard shortcut doesn't work), add this to `src/main/main.js`:

```js
mainWindow.webContents.openDevTools();
```

### 4. Debug the Main Process (Node.js)

The main process runs in Node.js and handles all IPC, DB, and printer logic. To debug it:

```bash
npm start -- --inspect
```

Then open **`chrome://inspect`** in Chrome → click *inspect* under Remote Target. Set breakpoints in `src/main/ipc/*.ipc.js`, `src/main/db/queries.js`, or any service file.

### 5. Inspect the SQLite Database Directly

The live database sits at:

```
Windows: %APPDATA%\Bloom Cafe POS\bloom-cafe.db
Dev mode: same path (the app always writes to AppData)
```

Use **[DB Browser for SQLite](https://sqlitebrowser.org/)** (free) to inspect it:

1. Download and install DB Browser for SQLite
2. Open `bloom-cafe.db`
3. Browse the **Browse Data** tab — key tables:

| Table | What it contains |
|-------|----------------|
| `bills` | Every finalized bill with payment method, cash received, totals |
| `orders` | Active table sessions |
| `inventory` | Stock levels, product links, restock history |
| `products` | Menu items, add-ons, pricing |
| `audit_log` | Full trail of every action (actor, action, target, timestamp) |

4. Use the **Execute SQL** tab to run queries, e.g.:

```sql
SELECT * FROM bills ORDER BY created_at DESC LIMIT 10;
SELECT * FROM audit_log WHERE action = 'finalize_bill';
SELECT p.name, i.quantity FROM inventory i JOIN products p ON i.product_id = p.id;
```

> **Tip:** The DB runs in WAL mode. In DB Browser, click **Write Changes** after the app writes to see the latest data without reopening the file.

### 6. Test the Full Order → Bill → Print Flow

1. Run `npm start` and select a table
2. Add menu items to the cart (test add-ons, Half/Full variants, and discounts)
3. Open Bill Preview → choose Cash, UPI, or Card
4. For Cash: enter received amount — the change calculator should block short payments
5. Click **Finalize Bill** — the atomic DB transaction runs: inventory deducted, bill number generated, audit log written
6. Check the **Dashboard** (left nav) — the new bill appears immediately with correct totals
7. In DB Browser: `SELECT * FROM bills ORDER BY created_at DESC LIMIT 1` — inspect every field

### 7. Test Thermal Printing Without a Printer

In **Settings → Printer**, select any available printer or use **Microsoft Print to PDF** (built into Windows) to print receipts to a PDF file instead of physical paper.

This lets you verify the 58mm receipt layout, item formatting, and cash/change display without any hardware.

### 8. View App Logs

Structured logs are written to:

```
Windows: %APPDATA%\Bloom Cafe POS\logs\
```

Tail the log file in PowerShell to watch events in real time:

```powershell
Get-Content "$env:APPDATA\Bloom Cafe POS\logs\app.log" -Wait -Tail 50
```

### 9. Run Tests

```bash
npm test                   # Jest — all unit tests
npm run test:coverage      # With coverage report
```

Current test coverage targets: `validator.js`, `analytics.service.js`, `file.service.js`
