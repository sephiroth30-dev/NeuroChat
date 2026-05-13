'use strict';

const { autoUpdater } = require('electron-updater');
const { BrowserWindow, shell, app } = require('electron');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let _downloadedFilePath = null;
let _installTimer = null;
const FORCED_INSTALL_DELAY_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function notifyRenderer(event, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(event, data);
  });
}

function openSettingsWindow() {
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(w => { if (!w.isDestroyed()) { w.show(); w.focus(); } });
  setTimeout(() => notifyRenderer('notification:navigate', { action: 'settings' }), 250);
}

function init() {
  autoUpdater.on('checking-for-update', () => {
    notifyRenderer('update:status', { state: 'checking' });
  });

  autoUpdater.on('update-available', info => {
    notifyRenderer('update:status', {
      state: 'downloading',
      version: info.version,
      releaseDate: info.releaseDate,
      percent: 0,
    });

    const notifier = require('./notifier');
    notifier.notify({
      title: 'Actualización obligatoria',
      body: `NeuroChat v${info.version} se está descargando automáticamente.`,
      persistent: true,
      onClick: openSettingsWindow,
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
    _downloadedFilePath = info.downloadedFile || null;
    notifyRenderer('update:status', {
      state: 'required',
      version: info.version,
      installInMinutes: Math.ceil(FORCED_INSTALL_DELAY_MS / 60000),
    });

    const notifier = require('./notifier');
    notifier.notify({
      title: 'Actualización lista',
      body: `NeuroChat v${info.version} se instalará automáticamente. Haz clic para reiniciar ahora.`,
      persistent: true,
      onClick: () => installUpdate(),
    });

    scheduleForcedInstall();
  });

  autoUpdater.on('error', err => {
    console.error('[Updater]', err.message);
    notifyRenderer('update:status', { state: 'error', message: err.message });
  });
}

function checkForUpdates() {
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[Updater] checkForUpdates:', err.message);
    notifyRenderer('update:status', { state: 'error', message: err.message });
  });
}

function downloadUpdate() {
  autoUpdater.downloadUpdate().catch(err => {
    console.error('[Updater] downloadUpdate:', err.message);
    notifyRenderer('update:status', { state: 'error', message: err.message });
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
  const timer = setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
  timer.unref?.();
}

function installUpdate() {
  if (process.platform === 'darwin') {
    if (_downloadedFilePath) {
      const { exec } = require('child_process');
      const path = require('path');
      const os = require('os');

      // Extract ZIP to temp folder, then open it + Applications side by side
      const extractDir = path.join(os.tmpdir(), 'NeuroChat-update');
      exec(`rm -rf "${extractDir}" && mkdir -p "${extractDir}" && unzip -o "${_downloadedFilePath}" -d "${extractDir}"`, (err) => {
        if (err) {
          // Fallback: just reveal the ZIP
          shell.showItemInFolder(_downloadedFilePath);
          setTimeout(() => app.quit(), 800);
          return;
        }
        // Strip quarantine from extracted app
        exec(`xattr -cr "${extractDir}"`, () => {
          // Open the extracted folder AND Applications so user can drag
          exec(`open "${extractDir}" && open /Applications`);
          setTimeout(() => app.quit(), 1000);
        });
      });
    } else {
      notifyRenderer('update:status', {
        state: 'error',
        message: 'No se encontró el archivo descargado. Instala manualmente desde GitHub.',
      });
    }
    return;
  }

  // Windows: NSIS handles kill via customInit macro, run silently
  try {
    autoUpdater.quitAndInstall(true, true);
  } catch (err) {
    console.error('[Updater] quitAndInstall failed:', err.message);
    notifyRenderer('update:status', { state: 'error', message: err.message });
  }
}

module.exports = { init, checkForUpdates, downloadUpdate, installUpdate, startPeriodicChecks };
