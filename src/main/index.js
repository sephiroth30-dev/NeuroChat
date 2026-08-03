'use strict';

const { app, BrowserWindow, nativeTheme, shell, powerMonitor } = require('electron');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// WebRTC: disable mDNS candidate obfuscation so LAN peers can resolve ICE candidates.
// Chromium hides local IPs with random .local hostnames by default; Windows/Linux
// cannot resolve macOS mDNS names, breaking WebRTC on heterogeneous LANs.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

// Lazy-loaded modules (initialized after app ready)
let windowManager, database, discovery, wsServer, fileTransfer, tray, _notifier, ipcHandlers, updater, remoteDesktop;

app.whenReady().then(async () => {
  console.log(`[NeuroChat] v${app.getVersion()} — iniciando`);

  try {
    await _startup();
  } catch (err) {
    const { dialog } = require('electron');
    dialog.showErrorBox(
      `NeuroChat v${app.getVersion()} — Error al iniciar`,
      `${err.message}\n\n${err.stack || ''}`
    );
    app.exit(1);
  }
});

async function _startup() {
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

  // Windows: check firewall rules. Elevation is attempted at most 3 times
  // across restarts (only counted on a CONFIRMED failure, not just an
  // attempt) — repeated UAC credential prompts on every launch block
  // non-admin corporate users, but a single transient failure or an
  // accidental UAC "No" shouldn't permanently disable retries either.
  // Preferred path: rules deployed via GPO (see docs/DESPLIEGUE-GPO.md);
  // then this never prompts at all.
  const FIREWALL_MAX_ATTEMPTS = 3;
  if (process.platform === 'win32') {
    setTimeout(async () => {
      try {
        const diag = require('./diagnostics');
        const ok = await diag.checkFirewallRules();
        if (ok) return;
        const attempts = database.getSetting('firewallSetupAttempts') || 0;
        if (attempts >= FIREWALL_MAX_ATTEMPTS) {
          console.warn('[Firewall] Reglas ausentes — límite de intentos alcanzado, se recomienda despliegue por GPO (no se vuelve a pedir elevación)');
          return;
        }
        console.log(`[Firewall] Rules missing — requesting elevation to add them (intento ${attempts + 1}/${FIREWALL_MAX_ATTEMPTS})`);
        // addFirewallRules() can also throw (e.g. can't write the temp batch
        // file) rather than resolve — that must count toward the cap too,
        // or a hard failure retries the UAC prompt every launch forever.
        let result;
        try {
          [result] = await diag.addFirewallRules();
        } catch (err) {
          database.setSetting('firewallSetupAttempts', attempts + 1);
          console.warn('[Firewall] addFirewallRules threw:', err.message);
          return;
        }
        if (!result?.ok) {
          database.setSetting('firewallSetupAttempts', attempts + 1);
          console.warn('[Firewall] Elevation failed or was denied:', result?.error);
          return;
        }
        // Re-announce so peers can now reach us
        discovery.updateAnnounce(database.getProfile() || {});
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
}

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
