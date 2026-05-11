'use strict';

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let trayInstance = null;
let _mainWindow = null;
let _isQuitting = false;
let _currentStatus = 'available';

const STATUS_LABELS = {
  available: 'Disponible',
  away: 'Ausente',
  dnd: 'No molestar',
  invisible: 'Invisible',
};

app.on('before-quit', () => {
  _isQuitting = true;
});

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Abrir NeuroChat',
      click: () => {
        if (_mainWindow) {
          _mainWindow.show();
          _mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Estado',
      submenu: [
        {
          label: '🟢 Disponible',
          type: 'radio',
          checked: _currentStatus === 'available',
          click: () => sendStatus('available'),
        },
        {
          label: '🟡 Ausente',
          type: 'radio',
          checked: _currentStatus === 'away',
          click: () => sendStatus('away'),
        },
        {
          label: '🔴 No molestar',
          type: 'radio',
          checked: _currentStatus === 'dnd',
          click: () => sendStatus('dnd'),
        },
        {
          label: '⚫ Invisible',
          type: 'radio',
          checked: _currentStatus === 'invisible',
          click: () => sendStatus('invisible'),
        },
      ],
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        _isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function sendStatus(status) {
  if (_mainWindow) _mainWindow.webContents.send('status:set-from-tray', status);
}

function init(mainWindow) {
  _mainWindow = mainWindow;

  let icon;
  try {
    if (process.platform === 'darwin') {
      icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/tray-template.png'));
      icon.setTemplateImage(true);
    } else {
      icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/tray-icon.ico'));
    }
  } catch (_) {
    icon = nativeImage.createEmpty();
  }

  trayInstance = new Tray(icon);
  trayInstance.setToolTip('NeuroChat');
  trayInstance.setContextMenu(buildMenu());

  trayInstance.on('double-click', () => {
    if (_mainWindow) {
      _mainWindow.show();
      _mainWindow.focus();
    }
  });
}

function updateStatus(status) {
  if (!trayInstance) return;
  _currentStatus = status || 'available';
  trayInstance.setToolTip(`NeuroChat — ${STATUS_LABELS[_currentStatus] || _currentStatus}`);
  trayInstance.setContextMenu(buildMenu());
}

function destroy() {
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
}

module.exports = { init, updateStatus, destroy };
