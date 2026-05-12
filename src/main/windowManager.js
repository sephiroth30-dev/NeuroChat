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
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // X button → quit the app (sets isQuitting so before-quit can clean up)
  mainWindow.on('close', () => {
    isQuitting = true;
  });

  // Minimize button → hide to tray (keeps taskbar clean on Windows)
  mainWindow.on('minimize', e => {
    if (process.platform !== 'darwin') {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function getMainWindow() {
  return mainWindow;
}

function getIsQuitting() {
  return isQuitting;
}

module.exports = { createMainWindow, showMainWindow, getMainWindow, getIsQuitting };
