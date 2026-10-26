'use strict';

/**
 * analytics.service.js
 *
 * Pure business-logic function for computing dashboard analytics.
 * Extracted from the get-dashboard-analytics IPC handler so it can
 * be unit-tested without running an Electron process.
 *
 * @param {Array}  bills  - Array of bill objects from readSalesData()
 * @param {Object} menu   - Normalized menu from normalizeMenuForRenderer()
 * @returns {Object} analytics payload
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function lineRevenue(item) {
  const addonsTotal = Array.isArray(item.addons)
    ? item.addons.reduce((a, ad) => a + (ad.price || 0), 0)
    : 0;
  return ((item.price || 0) + addonsTotal) * (item.quantity || 0);
}

function computeAnalytics(bills, menu) {
  const analytics = {
    topSellingProducts:      [],
    salesByCategory:         [],
    paymentModeDistribution: {},
    orderTypeDistribution:   { 'Dine-In': 0, 'Delivery': 0, 'Direct Bill': 0 },
    salesByHour:             Array(24).fill(0),
    totalDiscount:           0,
    grossRevenue:            0,
  };

  if (!Array.isArray(bills) || bills.length === 0) return analytics;

  // product name → category name, built once (first category wins, as before)
  const categoryOf = new Map();
  for (const c of (menu && Array.isArray(menu.categories) ? menu.categories : [])) {
    for (const p of (Array.isArray(c.products) ? c.products : [])) {
      if (!categoryOf.has(p.name)) categoryOf.set(p.name, c.name);
    }
  }

  const productSales  = {};
  const categorySales = {};
  let totalDiscount = 0;
  let grossRevenue  = 0;

  for (const bill of bills) {
    // ── Sales by hour ────────────────────────────────────────────────────────
    if (bill.time) {
      const hour = new Date(bill.time).getHours();
      if (hour >= 0 && hour < 24) analytics.salesByHour[hour] += bill.total || 0;
    }

    // ── Payment mode distribution ────────────────────────────────────────────
    if (bill.paymentMode) {
      analytics.paymentModeDistribution[bill.paymentMode] =
        (analytics.paymentModeDistribution[bill.paymentMode] || 0) + 1;
    }

    // ── Order type distribution ──────────────────────────────────────────────
    if (bill.orderId) {
      if (bill.orderId.startsWith('Table'))            analytics.orderTypeDistribution['Dine-In']++;
      else if (bill.orderId === 'Delivery')            analytics.orderTypeDistribution['Delivery']++;
      else if (bill.orderId === 'Direct Bill')         analytics.orderTypeDistribution['Direct Bill']++;
    }

    // ── Discounts ────────────────────────────────────────────────────────────
    const discount = Number(bill.discountAmount) || 0;
    totalDiscount += discount;
    grossRevenue  += (Number(bill.total) || 0) + discount;

    // ── Per-item aggregation ─────────────────────────────────────────────────
    if (Array.isArray(bill.items)) {
      // A discount is spread over the bill's items in proportion to their
      // value, so category revenue adds up to what was actually collected.
      const itemsValue = bill.items.reduce((s, item) => s + lineRevenue(item), 0);
      const paid       = Number.isFinite(bill.total) ? bill.total : itemsValue;
      const netShare   = itemsValue > 0 ? Math.min(1, Math.max(0, paid / itemsValue)) : 1;

      for (const item of bill.items) {
        // Top selling products — by quantity
        productSales[item.name] = (productSales[item.name] || 0) + (item.quantity || 0);

        // Sales by category — by revenue
        const category = categoryOf.get(item.name);
        if (category) {
          categorySales[category] = (categorySales[category] || 0) + lineRevenue(item) * netShare;
        }
      }
    }
  }

  analytics.topSellingProducts = Object.entries(productSales)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, quantity]) => ({ name, quantity }));

  analytics.salesByCategory = Object.entries(categorySales)
    .map(([name, revenue]) => ({ name, revenue: round2(revenue) }));

  analytics.salesByHour   = analytics.salesByHour.map(round2);
  analytics.totalDiscount = round2(totalDiscount);
  analytics.grossRevenue  = round2(grossRevenue);

  return analytics;
}

module.exports = { computeAnalytics };
