'use strict';

const { computeAnalytics } = require('../../src/main/services/analytics.service');

const sampleMenu = {
  categories: [
    {
      name: 'Coffee',
      products: [
        { name: 'Espresso', price: 80 },
        { name: 'Latte', price: 150 },
      ],
    },
    {
      name: 'Food',
      products: [
        { name: 'Sandwich', price: 120 },
      ],
    },
  ],
  addons: [],
};

const makeBill = (overrides = {}) => ({
  orderId: 'Table 1',
  paymentMode: 'Cash',
  total: 230,
  time: '2024-01-15T10:30:00.000Z',
  items: [
    { name: 'Espresso', price: 80, quantity: 1, addons: [] },
    { name: 'Latte', price: 150, quantity: 1, addons: [] },
  ],
  ...overrides,
});

// ── Empty / null input ────────────────────────────────────────────────────────
describe('computeAnalytics — empty input', () => {
  test('returns zeroed analytics for empty bills array', () => {
    const result = computeAnalytics([], sampleMenu);
    expect(result.topSellingProducts).toEqual([]);
    expect(result.salesByCategory).toEqual([]);
    expect(result.paymentModeDistribution).toEqual({});
    expect(result.orderTypeDistribution).toEqual({ 'Dine-In': 0, 'Delivery': 0, 'Direct Bill': 0 });
    expect(result.salesByHour).toHaveLength(24);
    expect(result.salesByHour.every(v => v === 0)).toBe(true);
  });

  test('returns zeroed analytics when bills is not an array', () => {
    const result = computeAnalytics(null, sampleMenu);
    expect(result.topSellingProducts).toEqual([]);
  });
});

// ── Payment mode distribution ─────────────────────────────────────────────────
describe('computeAnalytics — paymentModeDistribution', () => {
  test('counts each payment mode', () => {
    const bills = [
      makeBill({ paymentMode: 'Cash' }),
      makeBill({ paymentMode: 'UPI' }),
      makeBill({ paymentMode: 'Cash' }),
    ];
    const result = computeAnalytics(bills, sampleMenu);
    expect(result.paymentModeDistribution).toEqual({ Cash: 2, UPI: 1 });
  });

  test('ignores bills without paymentMode', () => {
    const bills = [makeBill({ paymentMode: undefined })];
    const result = computeAnalytics(bills, sampleMenu);
    expect(Object.keys(result.paymentModeDistribution)).toHaveLength(0);
  });
});

// ── Order type distribution ───────────────────────────────────────────────────
describe('computeAnalytics — orderTypeDistribution', () => {
  test('classifies Dine-In by Table prefix', () => {
    const bills = [makeBill({ orderId: 'Table 3' }), makeBill({ orderId: 'Table 7' })];
    const result = computeAnalytics(bills, sampleMenu);
    expect(result.orderTypeDistribution['Dine-In']).toBe(2);
  });

  test('classifies Delivery', () => {
    const bills = [makeBill({ orderId: 'Delivery' })];
    const result = computeAnalytics(bills, sampleMenu);
    expect(result.orderTypeDistribution['Delivery']).toBe(1);
  });

  test('classifies Direct Bill', () => {
    const bills = [makeBill({ orderId: 'Direct Bill' })];
    const result = computeAnalytics(bills, sampleMenu);
    expect(result.orderTypeDistribution['Direct Bill']).toBe(1);
  });
});

// ── Sales by hour ─────────────────────────────────────────────────────────────
describe('computeAnalytics — salesByHour', () => {
  test('buckets total into the correct hour', () => {
    // '2024-01-15T10:30:00.000Z' → hour 10 in UTC
    const bill = makeBill({ time: '2024-01-15T10:00:00.000Z', total: 500 });
    const result = computeAnalytics([bill], sampleMenu);
    const hour = new Date('2024-01-15T10:00:00.000Z').getHours();
    expect(result.salesByHour[hour]).toBe(500);
  });

  test('accumulates multiple bills in the same hour', () => {
    const bills = [
      makeBill({ time: '2024-01-15T14:00:00.000Z', total: 100 }),
      makeBill({ time: '2024-01-15T14:45:00.000Z', total: 200 }),
    ];
    const result = computeAnalytics(bills, sampleMenu);
    const hour = new Date('2024-01-15T14:00:00.000Z').getHours();
    expect(result.salesByHour[hour]).toBe(300);
  });
});

// ── Top selling products ──────────────────────────────────────────────────────
describe('computeAnalytics — topSellingProducts', () => {
  test('sorts by quantity descending', () => {
    const bills = [
      makeBill({ items: [{ name: 'Espresso', price: 80, quantity: 5, addons: [] }] }),
      makeBill({ items: [{ name: 'Latte', price: 150, quantity: 3, addons: [] }] }),
    ];
    const result = computeAnalytics(bills, sampleMenu);
    expect(result.topSellingProducts[0].name).toBe('Espresso');
    expect(result.topSellingProducts[0].quantity).toBe(5);
    expect(result.topSellingProducts[1].name).toBe('Latte');
  });

  test('limits to 5 products', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({
      name, price: 10, quantity: 6 - i, addons: [],
    }));
    const bills = [makeBill({ items })];
    const result = computeAnalytics(bills, sampleMenu);
    expect(result.topSellingProducts).toHaveLength(5);
  });
});

// ── Sales by category ─────────────────────────────────────────────────────────
describe('computeAnalytics — salesByCategory', () => {
  test('aggregates revenue per category', () => {
    const bills = [
      makeBill({ items: [{ name: 'Espresso', price: 80, quantity: 2, addons: [] }] }),
    ];
    const result = computeAnalytics(bills, sampleMenu);
    const coffee = result.salesByCategory.find(c => c.name === 'Coffee');
    expect(coffee).toBeDefined();
    expect(coffee.revenue).toBe(160);
  });

  test('includes addon price in category revenue', () => {
    const bills = [
      makeBill({
        items: [{
          name: 'Espresso',
          price: 80,
          quantity: 1,
          addons: [{ name: 'Extra Shot', price: 30 }],
        }],
      }),
    ];
    const result = computeAnalytics(bills, sampleMenu);
    const coffee = result.salesByCategory.find(c => c.name === 'Coffee');
    expect(coffee.revenue).toBe(110); // (80 + 30) * 1
  });

  test('ignores items not in the menu', () => {
    const bills = [
      makeBill({ items: [{ name: 'Mystery Item', price: 999, quantity: 1, addons: [] }] }),
    ];
    const result = computeAnalytics(bills, sampleMenu);
    expect(result.salesByCategory).toHaveLength(0);
  });

  test('rounds revenue to 2 decimal places', () => {
    const bills = [
      makeBill({ items: [{ name: 'Espresso', price: 0.1, quantity: 3, addons: [] }] }),
    ];
    const result = computeAnalytics(bills, sampleMenu);
    const coffee = result.salesByCategory.find(c => c.name === 'Coffee');
    expect(coffee.revenue).toBe(0.30);
    expect(String(coffee.revenue)).not.toMatch(/\d{4,}/);
  });
});
