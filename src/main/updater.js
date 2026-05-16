'use strict';

const { autoUpdater } = require('electron-updater');
const { BrowserWindow, shell, app } = require('electron');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let _downloadedFilePath = null;
let _installTimer = null;
let _shuttingDown = false; // guard: skip notifications during app quit
let _periodicTimer = null;

const FORCED_INSTALL_DELAY_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function notifyRenderer(event, data) {
  if (_shuttingDown) return;
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
    if (_shuttingDown) return; // expected during quit — ignore
    console.error('[Updater]', err.message);
    notifyRenderer('update:status', { state: 'error', message: err.message });
  });
}

function checkForUpdates() {
  if (_shuttingDown) return;
  autoUpdater.checkForUpdates().catch(err => {
    if (_shuttingDown) return;
    console.error('[Updater] checkForUpdates:', err.message);
    notifyRenderer('update:status', { state: 'error', message: err.message });
  });
}

function downloadUpdate() {
  if (_shuttingDown) return;
  autoUpdater.downloadUpdate().catch(err => {
    if (_shuttingDown) return;
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
  _periodicTimer = setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
  _periodicTimer.unref?.();
}

function setShuttingDown() {
  _shuttingDown = true;
  // Cancel pending timers so they don't fire during/after quit
  if (_installTimer) { clearTimeout(_installTimer); _installTimer = null; }
  if (_periodicTimer) { clearInterval(_periodicTimer); _periodicTimer = null; }
}

function installUpdate() {
  _shuttingDown = true; // no more notifications from here on
  if (_installTimer) { clearTimeout(_installTimer); _installTimer = null; }

  // electron-updater handles both Windows (NSIS silent install + restart)
  // and macOS (Squirrel.Mac replace-in-place + relaunch) with quitAndInstall.
  try {
    autoUpdater.quitAndInstall(true, true);
  } catch (err) {
    console.error('[Updater] quitAndInstall failed:', err.message);
    // Fallback: show the downloaded file so the user can install manually
    if (_downloadedFilePath) {
      shell.showItemInFolder(_downloadedFilePath);
    }
    setTimeout(() => app.quit(), 800);
  }
}

module.exports = { init, checkForUpdates, downloadUpdate, installUpdate, startPeriodicChecks, setShuttingDown };
