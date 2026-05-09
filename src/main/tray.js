'use strict';

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
let trayInstance = null;
let _isQuitting = false;

app.on('before-quit', () => {
  _isQuitting = true;
});

function init(mainWindow) {
  // Use a 16x16 transparent PNG as placeholder if .ico not present
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/tray-icon.ico'));
  } catch (_) {
    icon = nativeImage.createEmpty();
  }

  trayInstance = new Tray(icon);
  trayInstance.setToolTip('NeuroChat');

  const buildMenu = (_status = 'available') =>
    Menu.buildFromTemplate([
      {
        label: 'Abrir NeuroChat',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Estado',
        submenu: [
          { label: '🟢 Disponible', click: () => setStatus('available', mainWindow) },
          { label: '🟡 Ausente', click: () => setStatus('away', mainWindow) },
          { label: '🔴 No molestar', click: () => setStatus('dnd', mainWindow) },
          { label: '⚫ Invisible', click: () => setStatus('invisible', mainWindow) },
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

  trayInstance.setContextMenu(buildMenu());

  trayInstance.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function setStatus(status, mainWindow) {
  if (mainWindow) mainWindow.webContents.send('status:set-from-tray', status);
}

function setIcon(status) {
  if (!trayInstance) return;
  // Icons per status — fallback to empty if not found
  const iconMap = {
    available: 'tray-icon.ico',
    away: 'tray-icon.ico',
    dnd: 'tray-icon.ico',
    invisible: 'tray-icon.ico',
  };
  try {
    const img = nativeImage.createFromPath(
      path.join(__dirname, '../../assets', iconMap[status] || 'tray-icon.ico')
    );
    trayInstance.setImage(img);
  } catch (_) {}
}

function destroy() {
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
}

module.exports = { init, setIcon, destroy };
