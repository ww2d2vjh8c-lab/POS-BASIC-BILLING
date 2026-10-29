'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-sec-'));
jest.mock('electron', () => ({ app: { getPath: () => mockTmp, isPackaged: true } }));

const { secureWebPreferences, hardenWebContents } = require('../../src/main/security');

afterAll(() => fs.rmSync(mockTmp, { recursive: true, force: true }));

function fakeContents() {
  const listeners = {};
  return {
    listeners,
    openHandler: null,
    setWindowOpenHandler(fn) { this.openHandler = fn; },
    on(event, fn) { listeners[event] = fn; },
  };
}

describe('hardenWebContents', () => {
  test('blocks navigation away from the app (e.g. a file dropped on the window)', () => {
    const c = fakeContents();
    hardenWebContents(c);
    const event = { preventDefault: jest.fn() };
    c.listeners['will-navigate'](event, 'file:///C:/Users/cashier/Desktop/menu.pdf');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  test('denies new windows', () => {
    const c = fakeContents();
    hardenWebContents(c);
    expect(c.openHandler({ url: 'https://example.com' })).toEqual({ action: 'deny' });
  });

  test('blocks webviews', () => {
    const c = fakeContents();
    hardenWebContents(c);
    const event = { preventDefault: jest.fn() };
    c.listeners['will-attach-webview'](event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe('secureWebPreferences', () => {
  test('isolates and sandboxes the renderer', () => {
    const prefs = secureWebPreferences('/app/preload.js');
    expect(prefs).toMatchObject({
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: false, preload: '/app/preload.js',
    });
  });
});

describe('main.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/main/main.js'), 'utf8');

  test('hardens every webContents in dev and production', () => {
    expect(src).toMatch(/app\.on\('web-contents-created',[^\n]*hardenWebContents/);
    expect(src).toMatch(/webPreferences:\s*secureWebPreferences\(/);
  });

  test('no longer relies on the removed new-window event', () => {
    expect(src).not.toMatch(/'new-window'/);
  });

  test('a failed startup shows an error and exits instead of leaving a window-less process', () => {
    const start = src.slice(src.indexOf('function startApp'), src.indexOf('app.whenReady'));
    expect(start).toMatch(/catch \(e\)[\s\S]*dialog\.showErrorBox[\s\S]*app\.exit\(1\)/);
  });
});
