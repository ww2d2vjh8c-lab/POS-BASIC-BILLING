<div align="center">

<h1>☕ Bloom Cafe POS</h1>

<p><strong>A professional, fully offline Point of Sale system built for cafés and small restaurants.</strong></p>

<p>
  <img src="https://img.shields.io/badge/version-1.1.0-brown?style=flat-square" />
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-blue?style=flat-square&logo=windows" />
  <img src="https://img.shields.io/badge/electron-28-47848F?style=flat-square&logo=electron" />
  <img src="https://img.shields.io/badge/sqlite-better--sqlite3-003B57?style=flat-square&logo=sqlite" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
</p>

<p><em>Built by <a href="mailto:coc123.1607@gmail.com">Ayush Kaushik</a> — delivered to Bloom Cafe</em></p>

</div>

---

## ✨ What is this?

Bloom Cafe POS is a desktop billing and management application that runs **entirely on your Windows machine** — no internet, no subscriptions, no cloud. Every rupee of data stays on your device.

It replaces handwritten bills and manual calculations with a fast, clean digital system purpose-built for the café environment.

---

## 🖼️ Key Features

| Module | What it does |
|---|---|
| 🏠 **Order Management** | Visual table layout, multi-item carts, Half/Full variants, add-ons |
| 💰 **Billing** | Auto-numbered bills (BC-001…), Cash/UPI/Card, instant finalization |
| 🖨️ **Printing** | Thermal receipt support (80mm), standard printer fallback, reprint any bill |
| 📊 **Dashboard** | Daily stats, vs-yesterday deltas, 7-day chart, hourly view, category split |
| 📦 **Inventory** | Stock tracking, low-stock alerts, auto-deduct on checkout, bulk restock mode |
| 🍽️ **Menu Manager** | Categories, products, half/full pricing, add-ons, availability toggles |
| ⚙️ **Settings** | Table count, inventory on/off, printer selection |

---

## 🚀 Getting Started

### Prerequisites

- Windows 10 or 11 (64-bit)
- Node.js 18+ (for development only)

### Development setup

```bash
git clone https://github.com/ayushkaushik/bloom-cafe-pos.git
cd bloom-cafe-pos
npm install
npm start
```

### Production build (Windows installer)

```bash
npm run build:win
# Output: dist/Bloom Cafe POS Setup 1.1.0.exe
```

---

## 🗂️ Project Structure

```
bloom-cafe-pos/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── db/                  # SQLite schema, queries, migrations, seed data
│   │   ├── ipc/                 # IPC handlers (billing, orders, inventory, menu…)
│   │   ├── services/            # Analytics, health checks, file utilities
│   │   ├── logger.js            # Structured logging
│   │   ├── validator.js         # Input validation
│   │   └── main.js              # Entry point
│   └── renderer/                # Frontend (HTML + vanilla JS + CSS)
│       ├── js/                  # app, order, cart, bill, dashboard, inventory…
│       ├── styles/              # Per-module CSS files
│       └── index.html           # Single-page app shell
├── config/
│   └── app.config.js            # Tunable constants (intervals, thresholds)
├── tests/                       # Jest unit tests
├── assets/                      # Icons
├── Release_Package/             # Client delivery bundle (docs + installer)
└── package.json
```

---

## 🧪 Tests

```bash
npm test                  # run all tests
npm run test:coverage     # with coverage report
```

---

## 📐 Architecture

| Layer | Technology |
|---|---|
| Desktop shell | [Electron](https://electronjs.org/) v28 |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (local SQLite file) |
| IPC | Electron contextBridge — strict preload isolation |
| Frontend | Vanilla JS, CSS custom properties — zero runtime dependencies |
| Build | [electron-builder](https://electron.build/) → NSIS installer |
| Tests | [Jest](https://jestjs.io/) |

**Data location (runtime):**
```
Windows: %APPDATA%\Bloom Cafe POS\bloom-cafe.db
```

---

## 📦 Release Package

The `Release_Package/` folder is the client delivery bundle:

```
Release_Package/
├── Bloom_Cafe_POS_Setup.exe    ← Windows installer (built separately)
├── README.md
├── USER_MANUAL.pdf             ← 10-chapter end-user guide
├── INSTALLATION_GUIDE.pdf      ← Step-by-step setup for non-technical users
├── APP_FEATURES.md
├── LICENSE.txt
└── assets/
```

---

## 📋 Changelog

See [CHANGELOG.md](./CHANGELOG.md)

---

## 📄 License

MIT © 2025 [Ayush Kaushik](mailto:coc123.1607@gmail.com)

> The client (Bloom Cafe / Sarthak Adwani) holds a perpetual license to use this software.

---

<div align="center">
  <sub>Built with ☕ by Ayush Kaushik &nbsp;|&nbsp; coc123.1607@gmail.com</sub>
</div>
