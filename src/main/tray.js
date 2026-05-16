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
    _mainWindow.flashFrame(false);
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

function notifyUnread(hasUnread, count = 0) {
  if (!trayInstance) return;
  _hasUnread = hasUnread;

  trayInstance.setImage(getTrayIcon(hasUnread));
  updateTaskbarUnread(hasUnread, count);

  if (process.platform === 'darwin' && hasUnread) {
    app.dock.bounce('informational');
  }

  // Show unread count in tooltip
  const label = STATUS_LABELS[_currentStatus] || _currentStatus;
  const unreadPart = count > 0
    ? ` · ${count} mensaje${count !== 1 ? 's' : ''} sin leer`
    : hasUnread ? ' · Mensajes pendientes' : '';
  trayInstance.setToolTip(`NeuroChat — ${label}${unreadPart}`);
  trayInstance.setContextMenu(buildMenu());
}

function updateTaskbarUnread(hasUnread, count) {
  if (!_mainWindow || _mainWindow.isDestroyed()) return;

  if (process.platform === 'win32') {
    if (hasUnread) {
      // If the window was hidden to tray, bring it back to the taskbar as a
      // minimized button (not full window) so flashFrame has somewhere to flash.
      // windowManager minimizes before hiding, so showInactive restores it minimized.
      if (!_mainWindow.isVisible()) {
        _mainWindow.showInactive();
      }
      _mainWindow.setOverlayIcon(loadIcon('tray-notify.ico'), `${count || 1} mensaje(s) sin leer`);
      _mainWindow.flashFrame(true);
    } else {
      _mainWindow.setOverlayIcon(null, '');
      _mainWindow.flashFrame(false);
      // Re-hide the window if the user hasn't opened it (still minimized)
      if (_mainWindow.isVisible() && _mainWindow.isMinimized()) {
        _mainWindow.hide();
      }
    }
    return;
  }

  if (process.platform === 'darwin') {
    app.dock.setBadge(hasUnread && count > 0 ? String(count) : '');
  }
}

function destroy() {
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
}

module.exports = { init, updateStatus, notifyUnread, destroy };
