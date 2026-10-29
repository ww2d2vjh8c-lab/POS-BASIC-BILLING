'use strict';

const { validateString, validatePrice, validateSettings, validateBillPayload } = require('../../src/main/validator');

// ── validateString ────────────────────────────────────────────────────────────
describe('validateString', () => {
  test('returns trimmed string for valid input', () => {
    expect(validateString('  Hello  ', 'field')).toBe('Hello');
  });

  test('throws when value is null', () => {
    expect(() => validateString(null, 'field')).toThrow('field is required');
  });

  test('throws when value is undefined', () => {
    expect(() => validateString(undefined, 'field')).toThrow('field is required');
  });

  test('throws when value is not a string', () => {
    expect(() => validateString(42, 'field')).toThrow('field must be a string');
  });

  test('throws when trimmed value is empty', () => {
    expect(() => validateString('   ', 'field')).toThrow('field cannot be empty');
  });

  test('throws when value exceeds maxLength', () => {
    const long = 'a'.repeat(101);
    expect(() => validateString(long, 'field')).toThrow('field must be under 100 characters');
  });

  test('respects custom maxLength', () => {
    expect(() => validateString('hello', 'field', 3)).toThrow('field must be under 3 characters');
    expect(validateString('hi', 'field', 3)).toBe('hi');
  });
});

// ── validatePrice ─────────────────────────────────────────────────────────────
describe('validatePrice', () => {
  test('returns null for null/undefined/empty', () => {
    expect(validatePrice(null)).toBeNull();
    expect(validatePrice(undefined)).toBeNull();
    expect(validatePrice('')).toBeNull();
  });

  test('returns parsed number for valid price', () => {
    expect(validatePrice(99.5)).toBe(99.5);
    expect(validatePrice('250')).toBe(250);
  });

  test('throws for non-numeric string', () => {
    expect(() => validatePrice('abc')).toThrow('price must be a number');
  });

  test('throws for negative price', () => {
    expect(() => validatePrice(-1)).toThrow('price cannot be negative');
  });

  test('throws when price exceeds max', () => {
    expect(() => validatePrice(100001)).toThrow('price seems too high');
  });

  test('accepts 0 as a valid price', () => {
    expect(validatePrice(0)).toBe(0);
  });

  test('accepts maximum allowed price', () => {
    expect(validatePrice(100000)).toBe(100000);
  });
});

// ── validateSettings ──────────────────────────────────────────────────────────
describe('validateSettings', () => {
  test('throws for non-object input', () => {
    expect(() => validateSettings(null)).toThrow('Invalid settings object');
    expect(() => validateSettings('bad')).toThrow('Invalid settings object');
  });

  test('filters to only allowed keys', () => {
    const result = validateSettings({
      numberOfTables: 10,
      cafeName: 'Bloom Cafe',
      maliciousKey: 'DROP TABLE',
      __proto__: 'hacked',
    });
    expect(result).toEqual({ numberOfTables: 10, cafeName: 'Bloom Cafe' });
    expect(result).not.toHaveProperty('maliciousKey');
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
  });

  test('allows all defined setting keys', () => {
    const all = {
      numberOfTables: 8,
      inventoryEnabled: true,
      cafeName: 'Test',
      cafePhone: '9876543210',
      printerName: 'EPSON',
      useThermalPrinting: false,
    };
    expect(validateSettings(all)).toEqual(all);
  });

  test('returns empty object when no allowed keys present', () => {
    expect(validateSettings({ foo: 1, bar: 2 })).toEqual({});
  });
});

// ── validateBillPayload ───────────────────────────────────────────────────────
describe('validateBillPayload', () => {
  const validPayload = { orderId: 'Table 1', paymentMode: 'Cash' };

  test('returns payload for valid input', () => {
    expect(validateBillPayload(validPayload)).toBe(validPayload);
  });

  test('throws when payload is missing', () => {
    expect(() => validateBillPayload(null)).toThrow('Payload is required');
  });

  test('throws when orderId is missing', () => {
    expect(() => validateBillPayload({ paymentMode: 'Cash' })).toThrow('orderId is required');
  });

  test('throws when paymentMode is missing', () => {
    expect(() => validateBillPayload({ orderId: 'Table 1' })).toThrow('paymentMode is required');
  });

  test('accepts all valid payment modes', () => {
    ['Cash', 'UPI', 'Card'].forEach(mode => {
      expect(() => validateBillPayload({ orderId: 'Table 1', paymentMode: mode })).not.toThrow();
    });
  });

  test('throws for invalid paymentMode', () => {
    expect(() => validateBillPayload({ orderId: 'Table 1', paymentMode: 'Bitcoin' }))
      .toThrow('paymentMode must be Cash, UPI, or Card');
  });

  test('throws for empty orderId', () => {
    expect(() => validateBillPayload({ orderId: '  ', paymentMode: 'Cash' }))
      .toThrow('orderId cannot be empty');
  });
});

// ── validateSettings: values, not just keys ──────────────────────────────────
describe('validateSettings — value validation', () => {
  const { validateSettings: vs } = require('../../src/main/validator');

  test.each([
    [{ numberOfTables: 0 }],
    [{ numberOfTables: 101 }],
    [{ numberOfTables: 1e9 }],
    [{ numberOfTables: 2.5 }],
    [{ numberOfTables: 'abc' }],
    [{ numberOfTables: null }],
    [{ inventoryEnabled: 'no' }],
    [{ inventoryEnabled: 1 }],
    [{ useThermalPrinting: 'yes' }],
    [{ cafeName: 'x'.repeat(101) }],
    [{ cafeName: { evil: true } }],
    [{ cafePhone: 12345 }],
    [{ printerName: 'p'.repeat(257) }],
  ])('rejects %j', (bad) => {
    expect(() => vs(bad)).toThrow();
  });

  test('normalises string forms of numbers and booleans', () => {
    expect(vs({ numberOfTables: '8', inventoryEnabled: 'false', useThermalPrinting: 'true' }))
      .toEqual({ numberOfTables: 8, inventoryEnabled: false, useThermalPrinting: true });
  });

  test('trims text and allows clearing it', () => {
    expect(vs({ cafeName: '  Bloom  ', cafePhone: '', printerName: '' }))
      .toEqual({ cafeName: 'Bloom', cafePhone: '', printerName: '' });
  });

  test('rejects arrays', () => {
    expect(() => vs([1, 2])).toThrow('Invalid settings object');
  });
});

// ── Money helpers ─────────────────────────────────────────────────────────────
describe('roundMoney / validateMoney', () => {
  const { roundMoney, validateMoney } = require('../../src/main/validator');

  test('roundMoney removes float noise and rounds to paise', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(19.999)).toBe(20);
    expect(roundMoney(NaN)).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
  });

  test.each([NaN, Infinity, -Infinity, -0.01, '50', null, undefined, 100001])('validateMoney rejects %p', (v) => {
    expect(() => validateMoney(v, 'amount')).toThrow();
  });

  test('validateMoney accepts and rounds a valid amount', () => {
    expect(validateMoney(0, 'amount')).toBe(0);
    expect(validateMoney(49.999, 'amount')).toBe(50);
    expect(validateMoney(250000, 'cash', 10000000)).toBe(250000);
  });
});

// ── validateCount ─────────────────────────────────────────────────────────────
describe('validateCount', () => {
  const { validateCount } = require('../../src/main/validator');

  test.each([NaN, Infinity, -1, 1e21, '5', null])('rejects %p', (v) => {
    expect(() => validateCount(v, 'Stock')).toThrow();
  });

  test('floors fractions and accepts 0', () => {
    expect(validateCount(2.7, 'Stock')).toBe(2);
    expect(validateCount(0, 'Stock')).toBe(0);
  });
});

// ── validateDate ──────────────────────────────────────────────────────────────
describe('validateDate', () => {
  const { validateDate } = require('../../src/main/validator');

  test.each(['2026-02-30', '2026-13-01', '2026-1-1', '../../etc', '2026-10-26/../x', '', null, 20261026])('rejects %p', (v) => {
    expect(() => validateDate(v)).toThrow('Invalid date');
  });

  test('accepts a real calendar date', () => {
    expect(validateDate('2026-10-26')).toBe('2026-10-26');
    expect(validateDate('2024-02-29')).toBe('2024-02-29');
  });
});

// ── validateOrderId ───────────────────────────────────────────────────────────
describe('validateOrderId', () => {
  const { validateOrderId } = require('../../src/main/validator');

  test('accepts table ids unchanged', () => {
    expect(validateOrderId('Table 1')).toBe('Table 1');
    expect(validateOrderId('Direct Bill')).toBe('Direct Bill');
  });

  test.each(['', '   ', null, 42, 'x'.repeat(101), '__proto__', 'constructor'])('rejects %p', (v) => {
    expect(() => validateOrderId(v)).toThrow();
  });
});

// ── validateCartItem ──────────────────────────────────────────────────────────
describe('validateCartItem', () => {
  const { validateCartItem } = require('../../src/main/validator');

  test('returns a clean copy with rounded prices', () => {
    expect(validateCartItem({ name: 'Latte', price: 119.999, addons: [{ name: 'Shot', price: 30, junk: 1 }] }))
      .toEqual({ name: 'Latte', price: 120, addons: [{ name: 'Shot', price: 30 }] });
  });

  test('missing add-ons become an empty list', () => {
    expect(validateCartItem({ name: 'Tea', price: 10 }).addons).toEqual([]);
  });

  test.each([
    [null],
    [{ name: 'Tea' }],
    [{ price: 10 }],
    [{ name: '   ', price: 10 }],
    [{ name: 'x'.repeat(201), price: 10 }],
    [{ name: 'Tea', price: NaN }],
    [{ name: 'Tea', price: Infinity }],
    [{ name: 'Tea', price: -5 }],
    [{ name: 'Tea', price: 100001 }],
    [{ name: 'Tea', price: 10, addons: 'Shot' }],
    [{ name: 'Tea', price: 10, addons: [{ name: 'Shot', price: NaN }] }],
    [{ name: 'Tea', price: 10, addons: [{ name: 'Shot', price: -1 }] }],
    [{ name: 'Tea', price: 10, addons: [{ price: 5 }] }],
    [{ name: 'Tea', price: 10, addons: Array.from({ length: 51 }, (_, i) => ({ name: `A${i}`, price: 1 })) }],
  ])('rejects %j', (bad) => {
    expect(() => validateCartItem(bad)).toThrow();
  });
});
