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

// A product name that would break naive HTML / inline-JS building.
const TRICKY = `Chef's "Special" <b>Thali</b>`;

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
  page.on('dialog', d => { errors.push(`unexpected native dialog: ${d.message()}`); d.accept(); });
  const step = async (name, fn) => {
    process.stdout.write(`• ${name} ... `);
    try { await fn(); console.log('ok'); }
    catch (e) { await page.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/\W+/g, '_')}.png`) }); throw e; }
  };
  const visible = sel => page.locator(sel).isVisible().catch(() => false);
  const cartNames = () => page.$$eval('#cart-items .cart-item-name', els => els.map(e => e.textContent));
  const cartCount = async () => parseInt(await page.textContent('#cartCount'), 10);

  try {
    await step('welcome screen → enter POS', async () => {
      await page.click('#enter-btn');
      await page.waitForSelector('#tableGrid .table-item');
      assert.ok(await page.locator('#tableGrid .table-item').count() >= 8);
      assert.strictEqual(await page.locator('#tableGrid .table-item.in-use').count(), 0, 'a table is occupied on a fresh install');
    });

    await step('menu manager: add a product with quotes and <tags> in its name', async () => {
      await page.click('#navMenu');
      await page.waitForSelector('#menuModal', { state: 'visible' });
      await page.click('#menuModal button.tab-btn:has-text("Products")');
      await page.fill('#newProductName', TRICKY);
      await page.fill('#newProductPrice', '99');
      await page.click('#menuProductsTab button:has-text("Add")');
      await page.waitForFunction(name =>
        Array.from(document.querySelectorAll('#products .product-card-name')).some(e => e.textContent === name), TRICKY);
      assert.strictEqual(await page.locator('#products b').count(), 0, 'product name was rendered as HTML');
      await page.click('#menuModal .modal-close-btn');
      await page.waitForSelector('#menuModal', { state: 'hidden' });
    });

    await step('inventory: restock that product with the + button, Esc closes', async () => {
      await page.click('#navInventory');
      await page.waitForSelector('#inventoryModal', { state: 'visible' });
      const row = page.locator('#invCategoryGroups .inv-item-row').filter({ hasText: TRICKY });
      await row.waitFor();
      for (let i = 0; i < 3; i++) await row.locator('button[data-delta="1"]').click();
      await page.waitForFunction(name => {
        const r = Array.from(document.querySelectorAll('#invCategoryGroups .inv-item-row')).find(el => el.dataset.name === name);
        return r && r.querySelector('.inv-stock-number')?.textContent.trim() === '3';
      }, TRICKY);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#inventoryModal', { state: 'hidden' });
    });

    await step('open Table 1 and add products by tapping', async () => {
      await page.click('#order-Table\\ 1');
      await page.waitForSelector('.product-card');
      const cards = page.locator('.product-card:not(.unavailable-product)');
      for (let i = 0; i < 2; i++) {
        await cards.nth(i).click();
        // Handle half/full size and add-on popups like a human would.
        for (let k = 0; k < 3; k++) {
          await page.waitForTimeout(250);
          if (await visible('#sizeModal .full-btn')) { await page.click('#sizeModal .full-btn'); continue; }
          if (await visible('#addonConfirmBtn')) { await page.click('#addonConfirmBtn'); continue; }
          break;
        }
      }
      await page.waitForFunction(() => document.querySelectorAll('.cart-item').length >= 2);
      await page.locator('.product-card').filter({ hasText: TRICKY }).click();
      await page.waitForFunction(name =>
        Array.from(document.querySelectorAll('#cart-items .cart-item-name')).some(e => e.textContent === name), TRICKY);
      assert.strictEqual(await page.locator('#cart-items b').count(), 0, 'cart rendered the product name as HTML');
    });

    await step('search: type and press Enter adds the first match', async () => {
      await page.fill('#productSearch', 'mango');
      await page.waitForSelector('#products .product-card:has-text("Mango Shake")');
      await page.press('#productSearch', 'Enter');
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('#cart-items .cart-item-name')).some(e => e.textContent === 'Mango Shake'));
    });

    await step('size picker: Esc cancels, "2" picks Full', async () => {
      const before = await cartCount();
      await page.fill('#productSearch', 'pakoda');
      await page.waitForSelector('#products .product-card:has-text("Pakoda")');
      await page.press('#productSearch', 'Enter');
      await page.waitForSelector('#sizeModal', { state: 'visible' });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#sizeModal', { state: 'hidden' });
      await page.waitForTimeout(200);
      assert.strictEqual(await cartCount(), before, 'Esc on the size picker still added an item');

      await page.focus('#productSearch');
      await page.press('#productSearch', 'Enter');
      await page.waitForSelector('#sizeModal', { state: 'visible' });
      await page.keyboard.press('2');
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('#cart-items .cart-item-name')).some(e => e.textContent === 'Pakoda (Full)'));
      await page.click('#clearSearchBtn');
      await page.screenshot({ path: path.join(SHOTS, 'order.png') });
    });

    await step('table tile shows the running order', async () => {
      await page.click('button:has-text("Back to Tables")');
      await page.waitForSelector('#tableView', { state: 'visible' });
      const tile = page.locator('#order-Table\\ 1');
      await page.waitForFunction(() => document.getElementById('order-Table 1').classList.contains('in-use'));
      const text = await tile.textContent();
      assert.ok(/items?/.test(text) && text.includes('₹'), `tile does not show items/total: ${text}`);
      await page.screenshot({ path: path.join(SHOTS, 'tables.png') });
      await tile.click();
      await page.waitForSelector('#orderView', { state: 'visible' });
    });

    await step('F1 opens the bill; discount and change are calculated', async () => {
      await page.waitForFunction(() => document.querySelectorAll('.cart-item').length >= 4);
      // Two of an item with an add-on, so the receipt has to multiply both.
      await page.evaluate(async () => {
        const item = { name: 'Cappuccino', price: 60, addons: [{ name: 'Oat Milk', price: 20 }] };
        await window.electronAPI.addToOrder(currentOrderId, item);
        await window.electronAPI.addToOrder(currentOrderId, item);
        await renderCart();
      });
      await page.keyboard.press('F1');
      await page.waitForSelector('#billModal', { state: 'visible' });
      await page.check('input[name="paymentMode"][value="Cash"]');

      const receipt = await page.textContent('#billContent .receipt-pre');
      const tooLong = receipt.split('\n').filter(l => l.length > 32);
      assert.deepStrictEqual(tooLong, [], 'receipt lines wider than 32 characters');
      // Every amount printed in the item section must add up to the subtotal,
      // so no add-on looks like it was charged twice.
      const sections = receipt.split(/\n-{32}\n/);
      const itemLines = sections[sections.findIndex(s => /#\. ITEM/.test(s)) + 1].split('\n');
      const amounts = itemLines.map(l => parseFloat((l.match(/₹([\d,]+\.\d{2})\s*$/) || [])[1]?.replace(/,/g, '') || '0'));
      const printedSum = Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
      assert.ok(receipt.includes('+Oat Milk'), 'add-on line missing from receipt');
      assert.strictEqual(printedSum, await page.evaluate(() => _activeBillTotal), 'receipt line amounts do not add up to the subtotal');
      // 14-char name column: first 12 characters + ".."
      assert.ok(receipt.includes(`Chef's "Spec..`), 'tricky product missing from receipt');
      assert.strictEqual(await page.locator('#billContent b').count(), 0, 'receipt rendered HTML from a product name');

      const subtotal = await page.evaluate(() => _activeBillTotal);
      await page.click('.discount-btn[data-discount="10"]');
      const expected = subtotal - Math.round(subtotal * 0.1);
      const grand = await page.textContent('#billGrandTotal');
      assert.strictEqual(parseFloat(grand.replace(/[^\d.]/g, '')), expected, `grand total ${grand} != ${expected}`);
      assert.ok((await page.textContent('#billContent .receipt-pre')).includes('Discount:'), 'preview ignores the discount');

      if (await visible('#cashReceivedInput')) await page.fill('#cashReceivedInput', '5000');
      const change = await page.textContent('#changeDisplay');
      const changeValue = parseFloat(change.replace(/[^\d.]/g, ''));
      assert.strictEqual(changeValue, 5000 - expected, `change ${change} ignores the discount`);
      await page.screenshot({ path: path.join(SHOTS, 'bill-preview.png') });
    });

    await step('finalize bill and print receipt', async () => {
      await page.click('#finalizeBillBtn');
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
      await page.waitForFunction(() => !document.getElementById('order-Table 1').classList.contains('in-use'));
    });

    await step('dashboard shows the sale and its discount', async () => {
      await page.click('#navDashboard');
      await page.waitForSelector('#dashboardModal', { state: 'visible' });
      await page.waitForTimeout(800);
      const today = await page.evaluate(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      const sales = await page.evaluate(d => window.electronAPI.getSalesData(d), today);
      assert.strictEqual(sales.data.bills.length, 1);
      assert.ok(sales.data.totalDiscount > 0, 'discount was not stored');
      await page.waitForSelector('#dashMoneySummary', { state: 'visible' });
      assert.ok((await page.textContent('#dashMoneySummary')).includes('Discounts'));
      await page.screenshot({ path: path.join(SHOTS, 'dashboard.png') });
    });

    await step('dashboard: number of tables + / − redraws the grid and is saved', async () => {
      const before = await page.locator('#tableGrid .table-item').count();
      await page.click('#dashTablePlus');
      await page.waitForFunction(n => document.querySelectorAll('#tableGrid .table-item').length === n + 1, before);
      let settings = await page.evaluate(() => window.electronAPI.getSettings());
      assert.strictEqual(settings.data.numberOfTables, 7);
      await page.click('#dashTableMinus');
      await page.waitForFunction(n => document.querySelectorAll('#tableGrid .table-item').length === n, before);
      settings = await page.evaluate(() => window.electronAPI.getSettings());
      assert.strictEqual(settings.data.numberOfTables, 6);
    });

    await step('backups list opens; restore asks first and can be cancelled', async () => {
      await page.click('#openBackupsBtn');
      await page.waitForSelector('#backupModal', { state: 'visible' });
      await page.waitForFunction(() =>
        document.querySelectorAll('#backupList .manage-item').length > 0 ||
        document.getElementById('backupEmpty').style.display === 'block');
      const rows = await page.locator('#backupList .manage-item').count();
      if (rows > 0) {
        await page.locator('#backupList button:has-text("Restore")').first().click();
        await page.waitForSelector('#confirmModal', { state: 'visible' });
        assert.ok((await page.textContent('#confirmMessage')).includes('restart'));
        await page.click('#confirmNoBtn');
        await page.waitForSelector('#confirmModal', { state: 'hidden' });
        assert.ok(await visible('#backupModal'), 'cancelling the restore closed the backups list');
        assert.ok(!(await visible('#restartOverlay')), 'restore started although it was cancelled');
      }
      await page.screenshot({ path: path.join(SHOTS, 'backups.png') });
      await page.keyboard.press('Escape');   // closes only the top dialog
      await page.waitForSelector('#backupModal', { state: 'hidden' });
      assert.ok(await visible('#dashboardModal'), 'Esc closed more than the top dialog');
      await page.click('.modal-close-btn >> visible=true');
      await page.waitForSelector('#dashboardModal', { state: 'hidden' });
    });

    await step('inventory and menu managers open and close', async () => {
      await page.click('#navInventory');
      await page.waitForSelector('#inventoryModal', { state: 'visible' });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#inventoryModal', { state: 'hidden' });
      await page.click('#navMenu');
      await page.waitForSelector('#menuModal', { state: 'visible' });
      await page.click('#menuModal .modal-close-btn');
      await page.waitForSelector('#menuModal', { state: 'hidden' });
    });

    await step('printer settings auto-detect runs', async () => {
      await page.click('#navPrinter');
      await page.waitForSelector('#printerModal', { state: 'visible' });
      await page.waitForFunction(() => {
        const t = document.getElementById('printerDetectStatus').textContent;
        return t && !/Detecting/.test(t);
      });
      const status = await page.textContent('#printerDetectStatus');
      assert.ok(status && status.length > 0, 'no printer detection status shown');
      await page.screenshot({ path: path.join(SHOTS, 'printer-settings.png') });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#printerModal', { state: 'hidden' });
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
