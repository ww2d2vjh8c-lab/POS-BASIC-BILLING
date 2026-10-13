'use strict';

const { pickPrinter } = require('../../src/main/services/printer.service');

describe('pickPrinter', () => {
  const pdf = { name: 'Microsoft Print to PDF', isDefault: true };
  const laser = { name: 'HP LaserJet' };
  const thermal = { name: 'EC-58 Receipt' };

  test('keeps the saved printer when installed', () => {
    expect(pickPrinter([pdf, laser, thermal], 'HP LaserJet')).toEqual({ name: 'HP LaserJet', reason: 'saved' });
  });
  test('saved name match is case-insensitive', () => {
    expect(pickPrinter([laser], 'hp laserjet').name).toBe('HP LaserJet');
  });
  test('saved printer missing → auto-detects a thermal printer', () => {
    expect(pickPrinter([pdf, laser, thermal], 'Old Printer')).toEqual({ name: 'EC-58 Receipt', reason: 'thermal' });
  });
  test.each(['POS-80', 'XP-58', 'EPSON TM-T82', 'Rongta RP80', 'Generic 58mm'])('recognises %s as thermal', n => {
    expect(pickPrinter([laser, { name: n }], '').reason).toBe('thermal');
  });
  test('never picks a virtual printer', () => {
    expect(pickPrinter([pdf, { name: 'OneNote' }, { name: 'Fax' }], '')).toEqual({ name: null, reason: 'none' });
  });
  test('falls back to the OS default physical printer', () => {
    expect(pickPrinter([laser, { name: 'Canon', isDefault: true }], '')).toEqual({ name: 'Canon', reason: 'default' });
  });
  test('falls back to the first physical printer', () => {
    expect(pickPrinter([pdf, laser], '')).toEqual({ name: 'HP LaserJet', reason: 'first' });
  });
  test('handles empty / bad input', () => {
    expect(pickPrinter(null, null).reason).toBe('none');
    expect(pickPrinter([null, {}], 'x').reason).toBe('none');
  });
});
