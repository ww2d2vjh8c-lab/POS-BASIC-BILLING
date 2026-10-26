'use strict';

/**
 * validator.js — validation for everything that arrives over IPC.
 *
 * The renderer is trusted code, but it can still send NaN, negative numbers,
 * huge strings or the wrong types (a bug, a stuck key, a corrupted form).
 * Nothing reaches the database without passing through one of these.
 */

const ALLOWED_SETTING_KEYS = new Set([
  "numberOfTables",
  "inventoryEnabled",
  "cafeName",
  "cafePhone",
  "printerName",       // used by save-printer-config
  "useThermalPrinting" // used by save-printer-config
]);

const MAX_NAME_LENGTH    = 100;
const MAX_PRICE          = 100000;
const MAX_TABLES         = 100;
const MAX_STOCK          = 1000000;
const MAX_CASH           = 10000000;   // ₹1 crore — far above any real cash payment
const MAX_ADDONS         = 50;
const MAX_ITEM_NAME      = 200;        // product name + " (Half)" etc.
const MAX_PRINTER_NAME   = 256;
const DATE_RE            = /^\d{4}-\d{2}-\d{2}$/;

/** Rounds a rupee amount to whole paise, removing float noise (0.1 + 0.2 → 0.3). */
function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function validateString(value, fieldName, maxLength = MAX_NAME_LENGTH) {
  if (value === null || value === undefined) throw new Error(`${fieldName} is required`);
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${fieldName} cannot be empty`);
  if (trimmed.length > maxLength) throw new Error(`${fieldName} must be under ${maxLength} characters`);
  return trimmed;
}

function validatePrice(value, fieldName = "price") {
  if (value === null || value === undefined || value === "") return null;
  const num = parseFloat(value);
  if (isNaN(num)) throw new Error(`${fieldName} must be a number`);
  if (num < 0) throw new Error(`${fieldName} cannot be negative`);
  if (num > MAX_PRICE) throw new Error(`${fieldName} seems too high`);
  return num;
}

/** A finite, non-negative rupee amount no larger than `max`, rounded to paise. */
function validateMoney(value, fieldName, max = MAX_PRICE) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${fieldName} must be a number`);
  if (value < 0) throw new Error(`${fieldName} cannot be negative`);
  if (value > max) throw new Error(`${fieldName} seems too high`);
  return roundMoney(value);
}

/** A whole-number count (stock, alert level) in [min, max]. Fractions are floored. */
function validateCount(value, fieldName, { min = 0, max = MAX_STOCK } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${fieldName} must be a number`);
  const n = Math.floor(value);
  if (n < min || n > max) throw new Error(`${fieldName} must be between ${min} and ${max}`);
  return n;
}

/** A YYYY-MM-DD calendar date string. */
function validateDate(value, fieldName = "date") {
  if (typeof value !== "string" || !DATE_RE.test(value)) throw new Error(`Invalid ${fieldName}`);
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) throw new Error(`Invalid ${fieldName}`);
  return value;
}

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Order / table id. Returned untrimmed because it is used as a lookup key. */
function validateOrderId(value) {
  if (!value || typeof value !== "string" || !value.trim()) throw new Error("Order ID is required");
  if (value.length > MAX_NAME_LENGTH) throw new Error(`Order ID must be under ${MAX_NAME_LENGTH} characters`);
  if (RESERVED_KEYS.has(value)) throw new Error("Invalid order ID");
  return value;
}

function toBoolean(value, fieldName) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${fieldName} must be true or false`);
}

function optionalText(value, fieldName, maxLength) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${fieldName} must be under ${maxLength} characters`);
  return trimmed;
}

const SETTING_VALIDATORS = {
  numberOfTables: (v) => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_TABLES) {
      throw new Error(`numberOfTables must be a whole number between 1 and ${MAX_TABLES}`);
    }
    return n;
  },
  inventoryEnabled:   (v) => toBoolean(v, "inventoryEnabled"),
  useThermalPrinting: (v) => toBoolean(v, "useThermalPrinting"),
  cafeName:           (v) => optionalText(v, "cafeName", MAX_NAME_LENGTH),
  cafePhone:          (v) => optionalText(v, "cafePhone", MAX_NAME_LENGTH),
  printerName:        (v) => optionalText(v, "printerName", MAX_PRINTER_NAME),
};

/** Keeps only known keys and rejects values of the wrong type or range. */
function validateSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Invalid settings object");
  const filtered = {};
  Object.entries(settings).forEach(([k, v]) => {
    if (ALLOWED_SETTING_KEYS.has(k)) filtered[k] = SETTING_VALIDATORS[k](v);
  });
  return filtered;
}

function validateBillPayload(payload) {
  if (!payload) throw new Error("Payload is required");
  validateString(payload.orderId, "orderId");
  validateString(payload.paymentMode, "paymentMode");
  if (!["Cash", "UPI", "Card"].includes(payload.paymentMode)) {
    throw new Error("paymentMode must be Cash, UPI, or Card");
  }
  return payload;
}

/**
 * Validates an item sent by add-to-order and returns a clean copy with prices
 * rounded to paise and add-ons reduced to { name, price }.
 */
function validateCartItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid item data");
  if (typeof item.name !== "string" || typeof item.price !== "number") throw new Error("Invalid item data");
  validateString(item.name, "Item name", MAX_ITEM_NAME);
  const price = validateMoney(item.price, "Item price");

  let addons = [];
  if (item.addons !== undefined && item.addons !== null) {
    if (!Array.isArray(item.addons)) throw new Error("Add-ons must be a list");
    if (item.addons.length > MAX_ADDONS) throw new Error(`An item can have at most ${MAX_ADDONS} add-ons`);
    addons = item.addons.map(a => {
      if (!a || typeof a !== "object") throw new Error("Invalid add-on");
      return {
        name:  validateString(a.name, "Add-on name"),
        price: validateMoney(a.price === undefined ? 0 : a.price, "Add-on price"),
      };
    });
  }
  return { ...item, name: item.name, price, addons };
}

module.exports = {
  MAX_CASH,
  roundMoney,
  validateString,
  validatePrice,
  validateMoney,
  validateCount,
  validateDate,
  validateOrderId,
  validateSettings,
  validateBillPayload,
  validateCartItem,
};
