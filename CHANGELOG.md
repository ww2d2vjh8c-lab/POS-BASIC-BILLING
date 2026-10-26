# Bloom Cafe POS — Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.3.0] — October 26, 2026

### Added
- **Receipt printer auto-detect** — every print uses the saved printer, otherwise a thermal printer, the Windows default or the first physical printer (never PDF/XPS/Fax). The choice is remembered, and the print dialog only appears when no printer exists
- **One-click install and update** — `INSTALL.bat` installs Node.js when needed, builds the app, closes the running app, backs up the data, installs silently, checks the new version really is installed and opens it. `UPDATE.bat` downloads the latest version and runs it. Both write a log (`install.log`, `update.log`) for support
- **`BACKUP-DATA.bat`** — copies all sales data to a dated folder on the Desktop, with restore instructions; runs automatically before every install/update
- **Oversold tracking** — selling more than the recorded stock keeps stock at 0, records an "oversold" entry linked to the bill and warns the cashier
- **GitHub Releases** — pushing a tag like `v1.3.0` publishes the installer and its SHA-256 checksum as a GitHub Release
- **Automated testing** — unit, real-SQLite integration and click-through end-to-end tests run before every build; CI also installs, updates, upgrades-while-running and uninstalls the app on Windows

### Fixed
- **Bill preview** — the bill window no longer stays open over the table view after printing
- **Local dates** — weekly revenue and session dates use the café's local business date instead of UTC
- **Atomic bill delete** — deleting a bill and restoring its stock now happen in one transaction; deleting an oversold bill only restores the units really taken from stock
- **Crash resilience** — an unexpected error is logged instead of closing the till mid-service
- **App and installer icon** — the app, installer, shortcuts and Add/Remove Programs show the Bloom Cafe logo instead of a plain orange square
- **INSTALL.bat** — now finds the installed app (it looked in the wrong folder before), so it really opens it at the end

### Changed
- **UI redesign** — refreshed look and layout across the app
- **Backend hardening** — stricter validation and safer database handling in the main process
- **Installer** — versioned file name (`Bloom-Cafe-POS-Setup-1.3.0.exe`), license page, logo icons, the Desktop shortcut is restored on every update, a running Bloom Cafe POS is closed automatically before upgrading, and app data is explicitly kept on uninstall. About 10 MB of unused database-driver source files are no longer installed
- **CI** — Node.js 22 and current (Node 24-based) GitHub Actions; the build never publishes on its own

---

## [1.2.0] — March 19, 2026

### Fixed
- **Cash received on UPI/Card receipts** — "Received" and "Change" lines now only appear on Cash receipts; UPI and Card receipts are clean
- **Cash received not saved to DB** — `cash_received` is now persisted in the bills table; reprints from the Dashboard show the correct amount
- **Short-payment allowed** — Finalization is now blocked when entered cash is less than the bill total, with a clear error toast

### Added
- **Migration v4** — Adds `cash_received REAL` column to bills table (runs automatically on next launch, fully idempotent)
- **System pipeline diagram** — Interactive visual in `docs/pipeline-visual.html` showing all 4 system pipelines: order flow, tech architecture, inventory deduction, and migration history

### Improved
- `readSalesData()` now returns `cashReceived` from the DB for correct dashboard reprint behavior
- `finalizeBill()` in the renderer reads cash input once and passes it through IPC to the DB in a single clean flow

---

## [1.1.0] — March 15, 2026

### ✅ Production Ready Features

**Core Functionality**
- Complete order taking and management system
- Real-time inventory tracking with automatic deduction
- Professional billing with unique bill numbers
- Multi-table support with session persistence

**Thermal Printer Support**
- Optimized for 58mm thermal printers (EC58B compatible)
- Screen preview matches printed receipt exactly
- Word-wrapping for long item names
- Proper paper width formatting

**Dashboard & Analytics**
- Daily sales reporting with payment mode breakdown
- Weekly revenue charts
- Real-time inventory alerts
- Export functionality for sales data

**Data Safety & Performance**
- Automatic database corruption recovery
- Transaction rollback protection
- Performance optimized (menu loads in <1ms)
- Comprehensive audit logging

**Windows Compatibility**
- NSIS installer with custom install options
- Desktop and Start Menu shortcuts
- Native module support for better-sqlite3
- Cross-platform path handling

### 🔧 Technical Improvements

- Fixed timezone bugs (now uses local time consistently)
- Implemented WAL checkpoint for database recovery
- Enhanced XSS protection across all UI components
- Optimized receipt rendering for thermal printers
- Added comprehensive error handling

### 📊 Certification Results

**52/53 tests passed (98.1% success rate)**
- All critical business functions verified
- Performance benchmarks met
- Windows compatibility confirmed
- Security validation completed

### 🚀 Ready for Production

This version has passed comprehensive testing and is certified for production deployment on Windows systems with 58mm thermal printers.

---

*For installation instructions, see README.md*
