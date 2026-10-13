'use strict';

/**
 * Human-style end-to-end test: launches the real Electron app and clicks
 * through it the way a cashier would. Run with `npm run test:e2e`
 * (on Linux CI: `xvfb-run npm run test:e2e`).
 *
 * Needs better-sqlite3 built for Electron (`npm run rebuild`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'test-results');

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-e2e-'));
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];

  const app = await electron.launch({
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, POS_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  // Never block on a real print dialog in tests.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.print = (_opts, cb) => { global.__printed = (global.__printed || 0) + 1; cb(true); };
    }
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  const step = async (name, fn) => {
    process.stdout.write(`• ${name} ... `);
    try { await fn(); console.log('ok'); }
    catch (e) { await page.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/\W+/g, '_')}.png`) }); throw e; }
  };

  try {
    await step('welcome screen → enter POS', async () => {
      await page.click('#enter-btn');
      await page.waitForSelector('#tableGrid .table-item');
      assert.ok(await page.locator('#tableGrid .table-item').count() >= 8);
    });

    await step('open Table 1 and add two products', async () => {
      await page.click('#order-Table\\ 1');
      await page.waitForSelector('.product-card');
      const cards = page.locator('.product-card:not(.unavailable-product)');
      for (let i = 0; i < 2; i++) {
        await cards.nth(i).click();
        // Handle half/full size and add-on popups like a human would.
        for (let k = 0; k < 3; k++) {
          await page.waitForTimeout(250);
          if (await page.locator('.full-btn').isVisible().catch(() => false)) { await page.click('.full-btn'); continue; }
          const addBtn = page.locator('button:has-text("Add to Cart")');
          if (await addBtn.isVisible().catch(() => false)) { await addBtn.click(); continue; }
          break;
        }
      }
      await page.waitForFunction(() => document.querySelectorAll('.cart-item').length >= 2);
    });

    await step('open bill preview and pay by cash', async () => {
      await page.click('button:has-text("View Bill")');
      await page.waitForSelector('#billModal', { state: 'visible' });
      await page.check('input[name="paymentMode"][value="Cash"]');
      if (await page.locator('#cashReceivedInput').isVisible()) await page.fill('#cashReceivedInput', '5000');
      await page.screenshot({ path: path.join(SHOTS, 'bill-preview.png') });
    });

    await step('finalize bill and print receipt', async () => {
      await page.click('button:has-text("Checkout & Finalize Bill")');
      const printBtn = page.locator('#printReceiptBtn');
      await printBtn.waitFor({ timeout: 5000 }).catch(() => {});
      if (await printBtn.isVisible().catch(() => false)) await printBtn.click();
      await page.waitForTimeout(800);
      const printed = await app.evaluate(() => global.__printed || 0);
      assert.ok(printed >= 1, 'receipt was not sent to printer');
      assert.ok(!(await page.locator('#billModal').isVisible()), 'bill preview left open after printing');
    });

    await step('table is free again after billing', async () => {
      const back = page.locator('button:has-text("Back to Tables")');
      if (await back.isVisible().catch(() => false)) await back.click();
      await page.waitForSelector('#tableView', { state: 'visible' });
      const res = await page.evaluate(() => window.electronAPI.getActiveOrders());
      assert.strictEqual(res.data['Table 1'], undefined);
    });

    await step('dashboard shows the sale', async () => {
      await page.click('button:has-text("Dashboard")');
      await page.waitForTimeout(800);
      const today = await page.evaluate(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      const sales = await page.evaluate(d => window.electronAPI.getSalesData(d), today);
      assert.strictEqual(sales.data.bills.length, 1);
      await page.screenshot({ path: path.join(SHOTS, 'dashboard.png') });
      await page.click('.modal-close-btn >> visible=true');
    });

    await step('inventory and menu managers open', async () => {
      await page.click('button:has-text("Inventory")');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; }); });
      await page.click('button:has-text("Menu")');
      await page.waitForTimeout(500);
      await page.evaluate(() => { document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; }); });
    });

    await step('printer settings auto-detect runs', async () => {
      await page.click('button:has-text("Printer")');
      await page.waitForTimeout(800);
      const status = await page.textContent('#printerDetectStatus');
      assert.ok(status && status.length > 0, 'no printer detection status shown');
      await page.screenshot({ path: path.join(SHOTS, 'printer-settings.png') });
    });

    const real = errors.filter(e => !/Autofill|DevTools|favicon/i.test(e));
    assert.deepStrictEqual(real, [], 'renderer errors:\n' + real.join('\n'));
    console.log('\nE2E PASSED');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(e => { console.error('\nE2E FAILED:', e.message); process.exit(1); });
