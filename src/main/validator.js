const ALLOWED_SETTING_KEYS = new Set([
  "numberOfTables",
  "inventoryEnabled",
  "cafeName",
  "cafePhone",
  "printerName",       // used by save-printer-config
  "useThermalPrinting" // used by save-printer-config
]);

const MAX_NAME_LENGTH = 100; 
const MAX_PRICE = 100000; 

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

function validateSettings(settings) { 
  if (!settings || typeof settings !== "object") throw new Error("Invalid settings object"); 
  const filtered = {}; 
  Object.entries(settings).forEach(([k, v]) => { 
    if (ALLOWED_SETTING_KEYS.has(k)) filtered[k] = v; 
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

module.exports = { 
  validateString, 
  validatePrice, 
  validateSettings, 
  validateBillPayload 
}; 
