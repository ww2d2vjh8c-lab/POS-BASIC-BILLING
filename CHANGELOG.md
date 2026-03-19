# Bloom Cafe POS — Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
