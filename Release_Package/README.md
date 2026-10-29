# Bloom Cafe POS — v1.3.0

**A professional Point of Sale system built for cafés, coffee shops, and small restaurants.**

---

## What is Bloom Cafe POS?

Bloom Cafe POS is a desktop billing and management application that runs entirely on your Windows computer — no internet required, no monthly fees, no cloud dependency. Your data stays on your machine, always.

It replaces handwritten bills and manual order tracking with a fast, reliable digital system designed for real café workflows.

---

## What Problems It Solves

| Problem | How Bloom Cafe POS Helps |
|---|---|
| Slow, error-prone handwritten bills | Tap items → instant digital bill in seconds |
| No record of daily sales | Full sales history with date navigation |
| Forgetting what's running low | Inventory tracking with low-stock alerts |
| Manually calculating totals | Automatic totals, taxes, and payment tracking |
| No overview of business performance | Dashboard with revenue, top items, and weekly charts |
| Lost bills and reprint requests | Every bill stored and reprinted on demand |

---

## System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| **OS** | Windows 10 (64-bit) | Windows 11 (64-bit) |
| **RAM** | 2 GB | 4 GB |
| **Storage** | 200 MB free | 500 MB free |
| **Display** | 1280 × 720 | 1366 × 768 or higher |
| **Printer** | Any Windows printer | 80mm Thermal receipt printer |

> No internet connection is required to run the application.

---

## Quick Overview

**Order Screen** — Select tables, add items from the menu, choose sizes and add-ons, and confirm orders in seconds.

**Billing** — Generate a numbered bill (BC-001, BC-002…), choose Cash / UPI / Card, and print or save.

**Dashboard** — See today's revenue, total bills, average bill value, items sold, and a 7-day revenue chart at a glance.

**Inventory** — Track stock levels, set low-stock alerts, and get warned before items run out.

**Menu Manager** — Add categories, products, prices, half/full variants, and add-ons without any technical knowledge.

---

## First-Time Setup

1. Double-click `Bloom-Cafe-POS-Setup-1.3.0.exe`
   (if Windows says "Windows protected your PC", click **More info**, then **Run anyway** —
   the installer is not code-signed)
2. Follow the installation wizard — "Only for me" is the right choice and needs no administrator
3. Bloom Cafe POS opens at the end; later, use the **Bloom Cafe POS** icon on the Desktop or in the Start menu
4. Go to **Menu Manager** and add your menu items
5. Go to **Inventory** and set your starting stock levels
6. Print a test bill — the receipt printer is detected automatically
   (if you change printers later, open **Printer Settings** to pick it up again)
7. Start taking orders

---

## Updating and Your Data

- To update, run the newer `Bloom-Cafe-POS-Setup-<version>.exe` (or double-click `UPDATE.bat` on a laptop
  that was set up from GitHub). Bloom Cafe POS is closed automatically first; open tables are kept.
- Sales, menu and settings are stored in `%APPDATA%\bloom-cafe-pos`. Updating or uninstalling the app
  never deletes that folder.
- `BACKUP-DATA.bat` copies that folder to **Desktop › Bloom Cafe POS Backups** (it also runs
  automatically before every `INSTALL.bat` / `UPDATE.bat` install).

---

## Support

For issues or questions, contact the developer:
**Ayush Kaushik** — coc123.1607@gmail.com

---

*Bloom Cafe POS — Built by Ayush Kaushik for Bloom Cafe.*
