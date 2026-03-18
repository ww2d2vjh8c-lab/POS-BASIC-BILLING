'use strict';

// file.service.js uses `require('electron')` for `app.getPath`.
// In a Node/Jest context there is no Electron, so we mock it.
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-userData'),
    isPackaged: false,
  },
}));

const {
  normalizeInventoryName,
  normalizeMenuForRenderer,
} = require('../../src/main/services/file.service');

// ── normalizeInventoryName ────────────────────────────────────────────────────
describe('normalizeInventoryName', () => {
  test('lowercases the name', () => {
    expect(normalizeInventoryName('Chai')).toBe('chai');
  });

  test('strips "(Half)" suffix', () => {
    expect(normalizeInventoryName('Dosa (Half)')).toBe('dosa');
  });

  test('strips "(Full)" suffix case-insensitively', () => {
    expect(normalizeInventoryName('Biryani (full)')).toBe('biryani');
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeInventoryName('  Milk Tea  ')).toBe('milk tea');
  });

  test('handles null/undefined gracefully', () => {
    expect(normalizeInventoryName(null)).toBe('');
    expect(normalizeInventoryName(undefined)).toBe('');
  });

  test('handles names without suffixes unchanged (except lowercase)', () => {
    expect(normalizeInventoryName('Espresso')).toBe('espresso');
  });
});

// ── normalizeMenuForRenderer ──────────────────────────────────────────────────
describe('normalizeMenuForRenderer', () => {
  test('returns valid structure for empty menu', () => {
    const result = normalizeMenuForRenderer();
    expect(result).toEqual({ categories: [], addons: [] });
  });

  test('adds unavailable=true when available is false', () => {
    const menu = {
      categories: [{
        name: 'Drinks',
        products: [
          { name: 'Cola', available: false },
        ],
      }],
      addons: [],
    };
    const result = normalizeMenuForRenderer(menu);
    expect(result.categories[0].products[0].unavailable).toBe(true);
  });

  test('adds unavailable=false when available is true', () => {
    const menu = {
      categories: [{
        name: 'Drinks',
        products: [{ name: 'Water', available: true }],
      }],
      addons: [],
    };
    const result = normalizeMenuForRenderer(menu);
    expect(result.categories[0].products[0].unavailable).toBe(false);
  });

  test('ensures products.addons defaults to empty array', () => {
    const menu = {
      categories: [{
        name: 'Food',
        products: [{ name: 'Sandwich', available: true }],
      }],
      addons: [],
    };
    const result = normalizeMenuForRenderer(menu);
    expect(result.categories[0].products[0].addons).toEqual([]);
  });

  test('preserves existing addons array on product', () => {
    const menu = {
      categories: [{
        name: 'Coffee',
        products: [{
          name: 'Latte',
          available: true,
          addons: [{ name: 'Syrup', price: 20 }],
        }],
      }],
      addons: [],
    };
    const result = normalizeMenuForRenderer(menu);
    expect(result.categories[0].products[0].addons).toHaveLength(1);
  });

  test('passes top-level addons through unchanged', () => {
    const menu = {
      categories: [],
      addons: [{ name: 'Extra Sugar', price: 5 }],
    };
    const result = normalizeMenuForRenderer(menu);
    expect(result.addons).toEqual([{ name: 'Extra Sugar', price: 5 }]);
  });

  test('handles non-array categories gracefully', () => {
    const result = normalizeMenuForRenderer({ categories: null, addons: [] });
    expect(result.categories).toEqual([]);
  });

  test('handles non-array products in a category gracefully', () => {
    const result = normalizeMenuForRenderer({
      categories: [{ name: 'Misc', products: null }],
      addons: [],
    });
    expect(result.categories[0].products).toEqual([]);
  });
});
