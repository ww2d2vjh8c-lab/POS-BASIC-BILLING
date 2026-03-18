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
    expect(result).not.toHaveProperty('__proto__');
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
