'use strict';

const { BrowserWindow, app, nativeTheme } = require('electron');
const path = require('path');

let mainWindow = null;
let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 540,
    title: 'NeuroChat',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0E1621' : '#F4F6F8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // X button → minimize to tray (never close the app directly)
  // Windows strategy: minimize the window (preserves state) then remove from
  // taskbar via setSkipTaskbar(true).  This lets tray.js call setSkipTaskbar(false)
  // later to bring back a MINIMIZED BUTTON — not a full window — so flashFrame works.
  mainWindow.on('close', e => {
    if (isQuitting) return;
    e.preventDefault();
    if (process.platform === 'win32') {
      if (!mainWindow.isMinimized()) mainWindow.minimize();
      mainWindow.setSkipTaskbar(true);
    } else {
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('unresponsive', () => {
    console.warn('[Window] Renderer sin respuesta, recargando ventana principal');
    mainWindow?.webContents.reloadIgnoringCache();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Window] Renderer finalizó: ${details.reason}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  });

  // Grant microphone permission for voice notes
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  return mainWindow;
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  // On Windows the window may be minimized + hidden from taskbar via setSkipTaskbar
  if (process.platform === 'win32') mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.flashFrame(false);
  // Force repaint — prevents blank screen after hide/show cycle
  mainWindow.webContents.invalidate();
}

function getMainWindow() {
  return mainWindow;
}

function getIsQuitting() {
  return isQuitting;
}

module.exports = { createMainWindow, showMainWindow, getMainWindow, getIsQuitting };
