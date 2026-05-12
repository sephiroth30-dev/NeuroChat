'use strict';

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let trayInstance = null;
let _mainWindow = null;
let _isQuitting = false;
let _currentStatus = 'available';
let _hasUnread = false;

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
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: 'Estado',
      submenu: [
        { label: '🟢 Disponible', type: 'radio', checked: _currentStatus === 'available', click: () => sendStatus('available') },
        { label: '🟡 Ausente',     type: 'radio', checked: _currentStatus === 'away',      click: () => sendStatus('away')      },
        { label: '🔴 No molestar', type: 'radio', checked: _currentStatus === 'dnd',       click: () => sendStatus('dnd')       },
        { label: '⚫ Invisible',   type: 'radio', checked: _currentStatus === 'invisible', click: () => sendStatus('invisible') },
      ],
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => { _isQuitting = true; app.quit(); },
    },
  ]);
}

function sendStatus(status) {
  if (_mainWindow) _mainWindow.webContents.send('status:set-from-tray', status);
}

function showWindow() {
  if (_mainWindow) {
    if (_mainWindow.isMinimized()) _mainWindow.restore();
    if (!_mainWindow.isVisible()) _mainWindow.show();
    _mainWindow.focus();
  }
}

function loadIcon(filename) {
  try {
    return nativeImage.createFromPath(path.join(__dirname, '../../assets', filename));
  } catch (_) {
    return nativeImage.createEmpty();
  }
}

function getTrayIcon(unread) {
  if (process.platform === 'darwin') {
    // macOS: always use template image (color is managed by the OS)
    const img = loadIcon('tray-template.png');
    img.setTemplateImage(true);
    return img;
  }
  // Windows/Linux: swap to orange-dot icon when there are unread messages
  return loadIcon(unread ? 'tray-notify.ico' : 'tray-icon.ico');
}

function init(mainWindow) {
  _mainWindow = mainWindow;

  trayInstance = new Tray(getTrayIcon(false));
  trayInstance.setToolTip('NeuroChat');
  trayInstance.setContextMenu(buildMenu());

  // Single click opens the window (Windows/Linux primarily; macOS uses left-click too)
  trayInstance.on('click', () => showWindow());
  trayInstance.on('double-click', () => showWindow());
}

function updateStatus(status) {
  if (!trayInstance) return;
  _currentStatus = status || 'available';
  const label = STATUS_LABELS[_currentStatus] || _currentStatus;
  const unreadPart = _hasUnread ? ' · Mensajes pendientes' : '';
  trayInstance.setToolTip(`NeuroChat — ${label}${unreadPart}`);
  trayInstance.setContextMenu(buildMenu());
}

function notifyUnread(hasUnread) {
  if (!trayInstance) return;
  _hasUnread = hasUnread;

  trayInstance.setImage(getTrayIcon(hasUnread));

  if (process.platform === 'darwin') {
    if (hasUnread) {
      app.dock.bounce('informational'); // one bounce on macOS dock
    }
  }

  // Update tooltip to reflect unread state
  updateStatus(_currentStatus);
}

function destroy() {
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
}

module.exports = { init, updateStatus, notifyUnread, destroy };
