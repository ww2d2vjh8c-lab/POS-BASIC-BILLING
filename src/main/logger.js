const fs = require("fs"); 
const path = require("path"); 
const os = require("os"); 
const { app } = require("electron"); 

function getUserDataPath() { 
  if (app && typeof app.getPath === "function") return app.getPath("userData"); 
  return path.join(os.homedir(), "Library", "Application Support", "bloom-cafe-pos"); 
} 

function getLogPath() { 
  const logsDir = path.join(getUserDataPath(), "logs"); 
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true }); 
  return logsDir; 
} 

function getLogFile() { 
  const date = new Date().toISOString().split("T")[0]; 
  return path.join(getLogPath(), `app-${date}.log`); 
} 

function write(level, event, data = {}) { 
  const entry = JSON.stringify({ 
    ts: new Date().toISOString(), 
    level, 
    event, 
    ...data 
  }); 
  try { 
    fs.appendFileSync(getLogFile(), entry + "\n"); 
  } catch (e) { 
    console.error("[LOGGER] Failed to write log:", e.message); 
  } 
  if (level === "ERROR") console.error(`[${level}] ${event}`, data); 
  else if (level === "WARN") console.warn(`[${level}] ${event}`, data); 
  else console.log(`[${level}] ${event}`, data); 
} 

function rotateLogs() { 
  try { 
    const logsDir = getLogPath(); 
    const files = fs.readdirSync(logsDir) 
      .filter(f => f.startsWith("app-") && f.endsWith(".log")) 
      .sort() 
      .reverse(); 
    if (files.length > 14) { 
      files.slice(14).forEach(f => { 
        fs.unlinkSync(path.join(logsDir, f)); 
      }); 
    } 
  } catch (e) {} 
} 

/**
 * logEvent — structured operational event helper.
 * Accepts either a plain string or an object with a `type` field.
 * Used by all IPC modules and services instead of bare console.log.
 */
function logEvent(data) {
  const event = (typeof data === "object" && data.type) ? data.type : "LOG_EVENT";
  write("INFO", event, typeof data === "object" ? data : { message: data });
}

module.exports = {
  info:     (event, data) => write("INFO",  event, data),
  warn:     (event, data) => write("WARN",  event, data),
  error:    (event, data) => write("ERROR", event, data),
  rotateLogs,
  logEvent,
};

