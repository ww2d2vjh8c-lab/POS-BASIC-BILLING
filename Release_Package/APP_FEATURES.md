# Bloom Cafe POS — Complete Feature List
**Version 1.1.0**

---

## 🏠 Order Management

- **Table-based ordering** — Visual table layout; tap a table to open or resume its order
- **Configurable table count** — Set 1–20 tables to match your floor layout
- **Multi-item orders** — Add any number of items to an active table
- **Item quantities** — Increase/decrease individual item quantities directly in the cart
- **Remove items** — Remove individual items before billing
- **Item variants** — Half / Full size selection for supported menu items (different prices)
- **Add-ons** — Optional add-ons per item (e.g. Extra Sugar, Extra Shot) with individual prices
- **Order persistence** — Open orders are saved; switching tables preserves all cart data
- **Live table status** — Active tables are visually highlighted on the home screen
- **Clear order** — Cancel and clear an entire table's order in one tap

---

## 💰 Billing & Payments

- **Auto-numbered bills** — Sequential bill numbers per day (BC-001, BC-002, BC-003…)
- **Three payment modes** — Cash, UPI, and Card (keyboard shortcuts: C / U / P)
- **Bill preview** — Review the full itemised bill before finalising (F1 shortcut)
- **One-tap finalise** — Confirm and close a bill with a single action (Enter shortcut)
- **Receipt printing** — Print thermal receipts or standard printer bills immediately
- **Reprint bills** — Reprint any past bill from the dashboard at any time
- **Delete bills** — Remove incorrect bills (automatically restores inventory stock)
- **Idempotency protection** — Prevents accidental duplicate bills on double-tap

---

## 🖨️ Printing

- **Thermal printer support** — Optimised layout for 80mm thermal receipt printers
- **Standard printer support** — Works with any Windows-compatible printer
- **Printer configuration** — Select printer by name from installed system printers
- **Custom receipt layout** — Café name, bill number, items, totals, payment mode, timestamp
- **Reprint from dashboard** — Reprint historical bills without re-entering data

---

## 📊 Dashboard & Analytics

- **Daily overview** — Total revenue, bills generated, average bill value, items sold
- **vs-Yesterday deltas** — Each stat card shows increase/decrease compared to the previous day
- **Date navigation** — Browse any past date with ← / → buttons or date picker
- **"Today" quick-jump** — Return to today's stats in one click
- **Live table strip** — Shows how many tables are currently active (today only)
- **7-day revenue chart** — Bar chart of the last 7 days, today highlighted
- **Hourly sales chart** — Toggle to see revenue by hour of day (identifies peak hours)
- **Payment breakdown** — Visual bars showing Cash vs UPI vs Card split with percentages
- **Top 6 selling items** — Medal-ranked items by quantity sold with revenue figures
- **Category revenue** — Revenue breakdown by menu category
- **Inventory health panel** — Low-stock and out-of-stock items visible directly on dashboard
- **Out-of-stock stat card** — 5th card shows number of items currently out of stock
- **Recent bills list** — All bills for the selected date, most recent first
- **Export: Sales CSV** — Download a full sales report for any date
- **Export: Inventory snapshot** — Download current stock levels as CSV
- **Export: Combined report** — Items sold + remaining stock in one export

---

## 📦 Inventory Management

- **Stock tracking** — Track quantity on hand for any menu item
- **Low-stock alerts** — Set a threshold; items are flagged yellow when stock falls below it
- **Out-of-stock blocking** — Items with zero stock cannot be added to a cart (when enabled)
- **Auto-deduction** — Stock is automatically reduced when a bill is finalised
- **Auto-restore** — Stock is restored if a bill is deleted
- **Manual adjustments** — Increase or decrease stock directly from the inventory manager
- **Bulk restock mode** — Update multiple stock levels at once ("morning restock" workflow)
- **Add/remove tracked items** — Manually add any item to track, remove when no longer needed
- **Inventory on/off toggle** — Enable or disable inventory tracking globally from settings
- **Status indicators** — Green (in stock), Yellow (low), Red (out of stock) per item
- **Category grouping** — Inventory items grouped by menu category, collapsible sections
- **Menu Sync tab** — See which products are linked to inventory, which are missing, and sync in one click
- **History tab** — Audit log of every stock change: sold, restocked, adjusted, archived
- **Soft archive** — Deleted inventory items are archived, not permanently removed

---

## 🍽️ Menu Management

- **Categories** — Create, rename, and reorder menu categories
- **Products** — Add, edit, and delete products with full price and half-price support
- **Variants** — Enable half/full size variants per product with separate pricing
- **Add-ons** — Create add-ons and assign them to any product
- **Availability toggle** — Mark any item as unavailable without deleting it (shown greyed-out on menu)
- **Live menu refresh** — Changes to the menu reflect immediately without restarting the app

---

## ⚙️ Settings

- **Table count** — Configure the number of tables shown on the home screen
- **Inventory tracking** — Toggle stock deduction on/off globally
- **Printer selection** — Choose the printer and receipt style
- **Thermal / standard toggle** — Switch between thermal and standard print layout

---

## 🔐 Reliability & Data Safety

- **Local SQLite database** — All data stored on your computer, no internet required
- **WAL mode** — Database write-ahead logging for crash safety
- **Auto-migration** — Database schema updates automatically when the app updates
- **Audit log** — Every significant action is logged for traceability
- **Graceful error handling** — User-friendly error messages, no technical crashes shown
- **Keyboard shortcuts** — F1 (bill preview), C/U/P (payment modes), Enter (finalise), Escape (close modal)

---

## 💻 Technical Specifications

| Item | Detail |
|---|---|
| Platform | Windows 10/11 (64-bit) |
| Technology | Electron + SQLite (better-sqlite3) |
| Database | Local SQLite file (no server needed) |
| Offline | Fully offline, no internet dependency |
| Version | 1.1.0 |
| Developer | Ayush Kaushik |
