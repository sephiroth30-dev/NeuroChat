'use strict';

const { BrowserWindow, app, nativeTheme, dialog } = require('electron');
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

  // X button → ask user before quitting (closing disables notifications)
  mainWindow.on('close', e => {
    if (isQuitting) return; // already confirmed (e.g. from tray menu)
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      title: 'Cerrar NeuroChat',
      message: '¿Cerrar NeuroChat?',
      detail: 'Si cierras la aplicación dejarás de recibir notificaciones de mensajes.',
      buttons: ['Cerrar y salir', 'Minimizar a la bandeja'],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice === 0) {
      isQuitting = true;
      app.quit();
    } else {
      mainWindow.hide();
    }
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
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
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
