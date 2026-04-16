<p align="center">
  <img src="https://img.shields.io/badge/Electron-28-47848F?style=for-the-badge&logo=electron" />
  <img src="https://img.shields.io/badge/SQLite-WAL_Mode-003B57?style=for-the-badge&logo=sqlite" />
  <img src="https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js" />
  <img src="https://img.shields.io/badge/Platform-Windows-0078D4?style=for-the-badge&logo=windows" />
  <img src="https://img.shields.io/badge/CI/CD-GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions" />
  <img src="https://img.shields.io/badge/Status-Production-brightgreen?style=for-the-badge" />
</p>

<h1 align="center">Bloom Cafe POS</h1>
<p align="center"><strong>Production-grade offline-first point-of-sale system — running daily in a real café</strong></p>

---

## About

Bloom Cafe POS is a desktop point-of-sale application built for and delivered to a real café client. It runs offline-first on Windows, handles the full billing workflow for a multi-table café, and has been in daily production use since delivery.

This is not a demo or toy project — it processes real orders at a real business.

---

## Features

### Table Management
- 6 simultaneous table sessions
- Visual table status — open, occupied, billed
- Transfer items between tables

### Order Management
- Add items with **add-ons** (extra cheese, extra shot, etc.)
- **Half / Full variants** per item — different prices per variant
- Item quantity adjustment and removal
- Per-order **discounts** (flat or percentage)
- Running total updates in real time

### Billing
- Generate itemized bill for any table
- **Thermal receipt printing** — formatted for standard 80mm receipt printers
- Bill history — view past transactions

### Reliability
- **Offline-first** — zero internet required after install
- SQLite with **WAL mode** — atomic transactions, zero data loss on power failure
- Auto-recovery on unexpected shutdown

### Installer & Updates
- **One-click Windows installer** built via GitHub Actions CI (NSIS)
- Schema migration system — database upgrades without data loss

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop shell | Electron 28 |
| Backend logic | Node.js |
| Database | SQLite (WAL mode) |
| UI | HTML/CSS/JavaScript |
| Installer | NSIS via GitHub Actions |
| Testing | Jest |

---

## Architecture

```
┌─────────────────────────────────────┐
│           Electron Main Process      │
│  ┌─────────────────────────────────┐│
│  │   IPC Handlers (ipcMain)        ││
│  │   - orders: create, update, bill││
│  │   - tables: open, close, status ││
│  │   - print: receipt              ││
│  └──────────────┬──────────────────┘│
│                 │                    │
│  ┌──────────────▼──────────────────┐│
│  │   SQLite Database (WAL mode)    ││
│  │   - tables                      ││
│  │   - orders + order_items        ││
│  │   - menu_items                  ││
│  │   - transactions                ││
│  └─────────────────────────────────┘│
└────────────────┬────────────────────┘
                 │ contextBridge
┌────────────────▼────────────────────┐
│         Renderer Process (UI)        │
│   Table grid → Order form → Bill     │
└─────────────────────────────────────┘
```

---

## Database Schema

```sql
-- Core tables
CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  price_full REAL NOT NULL,
  price_half REAL,
  available INTEGER DEFAULT 1
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  table_number INTEGER NOT NULL,
  status TEXT DEFAULT 'open',  -- open | billed | closed
  discount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  menu_item_id INTEGER REFERENCES menu_items(id),
  variant TEXT DEFAULT 'full',  -- full | half
  quantity INTEGER DEFAULT 1,
  addons TEXT,                  -- JSON array of selected add-ons
  unit_price REAL NOT NULL
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  total REAL NOT NULL,
  discount REAL DEFAULT 0,
  paid_at TEXT DEFAULT (datetime('now'))
);
```

---

## Local Setup (Development)

### Prerequisites
- Node.js 18+
- Windows (for full printer support) or macOS/Linux (for development)

### Install and run

```bash
git clone https://github.com/ww2d2vjh8c-lab/POS-BASIC-BILLING.git
cd POS-BASIC-BILLING
npm install
npm start
```

### Run tests

```bash
npm test
```

### Build Windows installer

```bash
npm run build
# Output: dist/BloomCafePOS-Setup.exe
```

Or let GitHub Actions build it automatically — every push to `main` produces a release artifact.

---

## CI/CD Pipeline

```
Push to main
     │
     ▼
GitHub Actions
  ├── npm test (Jest suite)
  ├── npm run build (Electron + NSIS)
  └── Upload installer artifact
```

The `.exe` installer is available as a GitHub Actions artifact on every successful build.

---

## Deployment (Client Delivery)

1. Download `BloomCafePOS-Setup.exe` from GitHub Actions artifacts
2. Run installer on client's Windows machine — one-click, no dependencies
3. App auto-creates the SQLite database on first launch
4. Configure menu items through the admin panel

---

## Why SQLite WAL Mode?

WAL (Write-Ahead Logging) mode means:
- **Reads don't block writes** — UI stays responsive while billing
- **Atomic transactions** — a power failure mid-write won't corrupt the database
- **Crash recovery** — WAL log is replayed automatically on next open

Critical for a café environment where power cuts and abrupt shutdowns are common.

---

## License

MIT — see [LICENSE](LICENSE)

---

<p align="center">Built by <a href="https://github.com/ww2d2vjh8c-lab">Ayush Kaushik</a> · Delivered to and running at Bloom Cafe</p>
