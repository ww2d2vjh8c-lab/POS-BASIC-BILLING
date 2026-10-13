'use strict';

/**
 * printer.service.js — printer discovery and automatic selection.
 *
 * The cashier should never have to type a printer name. On every print we ask
 * the OS for its printers and pick, in order:
 *   1. the printer saved in settings, if it is still installed
 *   2. a receipt/thermal printer (matched by common model/driver names)
 *   3. the OS default printer
 *   4. the first physical printer
 * Virtual printers (PDF, XPS, OneNote, Fax) are never auto-selected.
 */

const THERMAL_PATTERN = /(thermal|receipt|pos[-_ ]?\d*|\b(58|80)\s?mm\b|ec-?58|xp-?\d+|tm-?[a-z]?\d+|rp-?\d+|tsp\d+|zj-?\d+|gp-?\d+|rongta|xprinter|epson tm|everycom|bixolon|citizen ct|sewoo|hoin|munbyn)/i;
const VIRTUAL_PATTERN = /(pdf|xps|onenote|fax|send to|microsoft print to|document writer)/i;

function isVirtual(p) {
  return VIRTUAL_PATTERN.test(`${p.name} ${p.displayName || ''}`);
}

function isThermal(p) {
  return THERMAL_PATTERN.test(`${p.name} ${p.displayName || ''} ${p.description || ''}`);
}

/**
 * Pure selection logic (unit tested).
 * @param {Array<{name:string,displayName?:string,description?:string,isDefault?:boolean}>} printers
 * @param {string} savedName
 * @returns {{ name: string|null, reason: 'saved'|'thermal'|'default'|'first'|'none' }}
 */
function pickPrinter(printers, savedName) {
  const list = Array.isArray(printers) ? printers.filter(p => p && p.name) : [];
  const saved = (savedName || '').trim();

  if (saved) {
    const match = list.find(p => p.name === saved || p.displayName === saved)
      || list.find(p => p.name.toLowerCase() === saved.toLowerCase());
    if (match) return { name: match.name, reason: 'saved' };
  }

  const physical = list.filter(p => !isVirtual(p));
  const thermal = physical.find(isThermal);
  if (thermal) return { name: thermal.name, reason: 'thermal' };

  const def = physical.find(p => p.isDefault);
  if (def) return { name: def.name, reason: 'default' };

  if (physical.length > 0) return { name: physical[0].name, reason: 'first' };
  return { name: null, reason: 'none' };
}

/** Returns the OS printer list for a webContents, never throws. */
async function listPrinters(webContents) {
  try {
    if (webContents && typeof webContents.getPrintersAsync === 'function') {
      return await webContents.getPrintersAsync();
    }
  } catch (_e) { /* fall through */ }
  return [];
}

module.exports = { pickPrinter, listPrinters, isThermal, isVirtual };
