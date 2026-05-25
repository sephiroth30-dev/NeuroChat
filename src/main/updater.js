'use strict';

const { autoUpdater } = require('electron-updater');
const { BrowserWindow, app } = require('electron');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null; // silence electron-updater's own logging

let _installTimer = null;
let _shuttingDown = false;
let _periodicTimer = null;
let _downloadedFile = null;

const FORCED_INSTALL_DELAY_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function notifyRenderer(event, data) {
  if (_shuttingDown) return;
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(event, data);
  });
}

function init() {
  // Silent: don't notify while downloading
  autoUpdater.on('update-available', info => {
    notifyRenderer('update:status', {
      state: 'downloading',
      version: info.version,
      percent: 0,
    });
  });

  autoUpdater.on('update-not-available', info => {
    notifyRenderer('update:status', { state: 'latest', version: info.version });
  });

  autoUpdater.on('download-progress', progress => {
    notifyRenderer('update:status', {
      state: 'downloading',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', info => {
    _downloadedFile = info.downloadedFile || null;

    notifyRenderer('update:status', {
      state: 'required',
      version: info.version,
      installInMinutes: Math.ceil(FORCED_INSTALL_DELAY_MS / 60000),
    });

    // Single, non-intrusive notification — no click required
    const notifier = require('./notifier');
    notifier.notify({
      title: `NeuroChat v${info.version} listo`,
      body: `Se instalará automáticamente en ${Math.ceil(FORCED_INSTALL_DELAY_MS / 60000)} minutos.`,
    });

    scheduleForcedInstall();
  });

  autoUpdater.on('error', err => {
    if (_shuttingDown) return;
    console.error('[Updater]', err.message);
    notifyRenderer('update:status', { state: 'error', message: err.message });
  });
}

function checkForUpdates() {
  if (_shuttingDown) return;
  autoUpdater.checkForUpdates().catch(err => {
    if (_shuttingDown) return;
    console.error('[Updater] checkForUpdates:', err.message);
  });
}

function downloadUpdate() {
  if (_shuttingDown) return;
  autoUpdater.downloadUpdate().catch(err => {
    if (_shuttingDown) return;
    console.error('[Updater] downloadUpdate:', err.message);
  });
}

function scheduleForcedInstall() {
  if (_installTimer) clearTimeout(_installTimer);
  _installTimer = setTimeout(() => {
    _installTimer = null;
    installUpdate();
  }, FORCED_INSTALL_DELAY_MS);
  _installTimer.unref?.();
}

function startPeriodicChecks() {
  _periodicTimer = setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
  _periodicTimer.unref?.();
}

function setShuttingDown() {
  _shuttingDown = true;
  if (_installTimer) { clearTimeout(_installTimer); _installTimer = null; }
  if (_periodicTimer) { clearInterval(_periodicTimer); _periodicTimer = null; }
}

function installUpdate() {
  _shuttingDown = true;
  if (_installTimer) { clearTimeout(_installTimer); _installTimer = null; }

  if (process.platform !== 'darwin') {
    // Windows: NSIS oneClick silent install + auto-restart
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (err) {
      console.error('[Updater] quitAndInstall failed:', err.message);
      setTimeout(() => app.quit(), 800);
    }
    return;
  }

  // macOS: extract ZIP to ~/Downloads, strip quarantine, open for drag-and-drop
  const downloadedFile = _downloadedFile;
  if (!downloadedFile) {
    notifyRenderer('update:status', {
      state: 'error',
      message: 'Archivo no encontrado. Descarga la nueva versión manualmente.',
    });
    _shuttingDown = false;
    return;
  }

  const { exec } = require('child_process');
  const path = require('path');
  const os = require('os');
  const extractDir = path.join(os.homedir(), 'Downloads', 'NeuroChat-Update');

  exec(
    `rm -rf "${extractDir}" && mkdir -p "${extractDir}" && unzip -o "${downloadedFile}" -d "${extractDir}" && xattr -cr "${extractDir}"`,
    err => {
      if (err) {
        require('electron').shell.showItemInFolder(downloadedFile);
        setTimeout(() => app.quit(), 800);
        return;
      }
      exec(`open "${extractDir}" && open /Applications`, () => {
        setTimeout(() => app.quit(), 800);
      });
    }
  );
}

module.exports = { init, checkForUpdates, downloadUpdate, installUpdate, startPeriodicChecks, setShuttingDown };
