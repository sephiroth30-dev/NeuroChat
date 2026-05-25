'use strict';

const { app, BrowserWindow, nativeTheme, shell, powerMonitor } = require('electron');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Lazy-loaded modules (initialized after app ready)
let windowManager, database, discovery, wsServer, fileTransfer, tray, _notifier, ipcHandlers, updater, remoteDesktop;

app.whenReady().then(async () => {
  console.log(`[NeuroChat] v${app.getVersion()} — iniciando`);

  // Load modules in dependency order
  database = require('./database');
  await database.initialize();

  // Apply saved theme before window creation
  const savedTheme = database.getSetting('theme');
  nativeTheme.themeSource =
    savedTheme === 'dark' ? 'dark' : savedTheme === 'light' ? 'light' : 'system';

  windowManager = require('./windowManager');
  tray = require('./tray');
  _notifier = require('./notifier');
  wsServer = require('./wsServer');
  fileTransfer = require('./fileTransfer');
  discovery = require('./discovery');
  ipcHandlers = require('./ipcHandlers');
  updater = require('./updater');
  remoteDesktop = require('./remoteDesktop');

  // Register all IPC handlers
  ipcHandlers.register();
  remoteDesktop.init();

  // Initialize auto-updater (check on startup after 5s)
  updater.init();
  setTimeout(() => updater.checkForUpdates(), 5000);
  updater.startPeriodicChecks();

  // Create main window
  const win = windowManager.createMainWindow();

  // Start network services
  wsServer.start();
  fileTransfer.start();
  discovery.start();

  // Windows: ensure firewall rules are in place (prompts UAC once if missing)
  if (process.platform === 'win32') {
    setTimeout(async () => {
      try {
        const diag = require('./diagnostics');
        const ok = await diag.checkFirewallRules();
        if (!ok) {
          console.log('[Firewall] Rules missing — requesting elevation to add them');
          await diag.addFirewallRules();
          // Re-announce so peers can now reach us
          discovery.updateAnnounce(database.getProfile() || {});
        }
      } catch (err) {
        console.warn('[Firewall] Auto-setup failed:', err.message);
      }
    }, 3000);
  }

  // Init tray icon
  tray.init(win);

  // Clear unread badge when window comes into focus
  win.on('focus', () => wsServer.clearUnread());

  // System idle → auto-away after 15 min
  const IDLE_AWAY_SECONDS = 15 * 60;
  let idleAwayTriggered = false;
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    if (idle >= IDLE_AWAY_SECONDS && !idleAwayTriggered) {
      idleAwayTriggered = true;
      win.webContents.send('system:idle');
    } else if (idle < 60 && idleAwayTriggered) {
      idleAwayTriggered = false;
      win.webContents.send('system:active');
    }
  }, 30_000);

  powerMonitor.on('lock-screen', () => win.webContents.send('system:idle'));
  powerMonitor.on('unlock-screen', () => {
    idleAwayTriggered = false;
    win.webContents.send('system:active');
  });

  // nativeTheme.themeSource was set above — Chromium's prefers-color-scheme updates
  // automatically, so CSS @media handles all theme switching without extra IPC events.

  // macOS dock click — always bring window to front, even if hidden
  app.on('activate', () => {
    windowManager.showMainWindow();
  });
});

app.on('second-instance', () => {
  if (windowManager) windowManager.showMainWindow();
});

app.on('window-all-closed', () => {
  // On macOS the convention is to keep the process alive until cmd+Q.
  // On Windows/Linux quit when all windows are closed (tray "Salir" path).
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Tell updater to stop all timers and suppress error notifications
  if (updater) updater.setShuttingDown();
  if (discovery) discovery.stop();
  if (wsServer) wsServer.stop();
  if (fileTransfer) fileTransfer.stop();
  if (database) database.close();
});

// Open external links in default browser, not in Electron
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
});
