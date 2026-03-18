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
function computeAnalytics(bills, menu) {
  const analytics = {
    topSellingProducts:      [],
    salesByCategory:         [],
    paymentModeDistribution: {},
    orderTypeDistribution:   { 'Dine-In': 0, 'Delivery': 0, 'Direct Bill': 0 },
    salesByHour:             Array(24).fill(0),
  };

  if (!Array.isArray(bills) || bills.length === 0) return analytics;

  const productSales  = {};
  const categorySales = {};

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

    // ── Per-item aggregation ─────────────────────────────────────────────────
    if (Array.isArray(bill.items)) {
      for (const item of bill.items) {
        // Top selling products — by quantity
        productSales[item.name] = (productSales[item.name] || 0) + (item.quantity || 0);

        // Sales by category — by revenue
        const category = Array.isArray(menu.categories)
          ? menu.categories.find(c => Array.isArray(c.products) && c.products.some(p => p.name === item.name))
          : null;
        if (category) {
          const addonsTotal = Array.isArray(item.addons)
            ? item.addons.reduce((a, ad) => a + (ad.price || 0), 0)
            : 0;
          const itemRevenue = ((item.price || 0) + addonsTotal) * (item.quantity || 0);
          categorySales[category.name] = (categorySales[category.name] || 0) + itemRevenue;
        }
      }
    }
  }

  analytics.topSellingProducts = Object.entries(productSales)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, quantity]) => ({ name, quantity }));

  analytics.salesByCategory = Object.entries(categorySales)
    .map(([name, revenue]) => ({ name, revenue: parseFloat(revenue.toFixed(2)) }));

  return analytics;
}

module.exports = { computeAnalytics };
