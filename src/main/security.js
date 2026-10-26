'use strict';

/**
 * security.js — BrowserWindow / webContents hardening.
 *
 * The UI is a single local page. It must never navigate away (dropping a
 * file onto the window would otherwise replace the till with that file),
 * open new windows, or embed webviews.
 */

const logger = require('./logger');

function secureWebPreferences(preloadPath) {
  return {
    nodeIntegration:             false,
    contextIsolation:            true,
    sandbox:                     true,   // preload only uses contextBridge + ipcRenderer
    preload:                     preloadPath,
    webSecurity:                 true,
    allowRunningInsecureContent: false,
    experimentalFeatures:        false,
    webviewTag:                  false,
  };
}

/** Applies the rules to any webContents (wire to app 'web-contents-created'). */
function hardenWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    logger.warn('WINDOW_BLOCKED', { url });
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    event.preventDefault();
    logger.warn('NAVIGATION_BLOCKED', { url });
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    logger.warn('WEBVIEW_BLOCKED');
  });
}

module.exports = { secureWebPreferences, hardenWebContents };
