'use strict';

const { BrowserWindow, ipcMain, screen, desktopCapturer, systemPreferences, dialog, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');

let db, store, wsClient;
let _initialized = false;

// Active sessions: sessionId → { role, peerUuid, peerIp, peerName, hostWin, viewerWin, status }
const sessions = new Map();

// Signaling messages that arrive before the target window has finished loading
// are queued here and flushed on did-finish-load.
const _signalingQueue = new Map(); // sessionId → msg[]

function init() {
  if (_initialized) return;
  _initialized = true;
  db = require('./database');
  store = require('./store');
  wsClient = require('./wsClient');
  _registerIPC();
}

// ── macOS screen recording permission guard ───────────────────────────────────

async function _checkScreenPermission() {
  if (process.platform !== 'darwin') return true;

  // Use getSources() as the authoritative check — getMediaAccessStatus('screen') is
  // unreliable on macOS 14 Sonoma and may return 'not-determined' even when denied.
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    if (sources && sources.length > 0) return true;
  } catch {}

  // getSources() returned empty → screen recording permission is denied or restricted
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Permiso de pantalla requerido',
    message: 'NeuroChat no puede acceder a la pantalla',
    detail: 'Ve a Configuración del Sistema → Privacidad y Seguridad → Grabación de pantalla,\nactiva NeuroChat y reinicia la aplicación.',
    buttons: ['Abrir Configuración', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
  return false;
}

// ── IPC Registration ──────────────────────────────────────────────────────────

function _registerIPC() {
  // Viewer initiates remote session request
  ipcMain.handle('remote:request', (_e, { peerUuid }) => {
    const peer = store.getOnlineUsers().find(u => u.uuid === peerUuid);
    if (!peer?.ip) return { ok: false, error: 'peer_offline' };

    const profile = db.getProfile();
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      role: 'viewer',
      peerUuid,
      peerIp: peer.ip,
      peerName: peer.name,
      status: 'pending',
    });

    wsClient.sendTo(peer, {
      type: 'REMOTE_REQUEST',
      sessionId,
      fromUuid: profile.uuid,
      fromName: profile.name,
      fromDomain: process.platform === 'win32' ? (process.env.USERDOMAIN || '') : '',
      toUuid: peerUuid,
    });

    return { ok: true, sessionId };
  });

  // Host accepts incoming remote request
  ipcMain.handle('remote:accept', async (_e, { sessionId, fromUuid }) => {
    const peer = store.getOnlineUsers().find(u => u.uuid === fromUuid);
    if (!peer?.ip) return { ok: false, error: 'peer_offline' };

    // macOS: verify screen recording permission before proceeding
    const hasPermission = await _checkScreenPermission();
    if (!hasPermission) {
      const profile = db.getProfile();
      if (profile) {
        wsClient.sendTo(peer, {
          type: 'REMOTE_REJECT',
          sessionId,
          fromUuid: profile.uuid,
          toUuid: fromUuid,
        });
      }
      sessions.delete(sessionId);
      return { ok: false, error: 'permission_denied' };
    }

    const profile = db.getProfile();
    const { width, height } = screen.getPrimaryDisplay().size;

    sessions.set(sessionId, {
      role: 'host',
      peerUuid: fromUuid,
      peerIp: peer.ip,
      peerName: peer.name,
      status: 'active',
    });

    wsClient.sendTo(peer, {
      type: 'REMOTE_ACCEPT',
      sessionId,
      fromUuid: profile.uuid,
      toUuid: fromUuid,
      screenWidth: width,
      screenHeight: height,
    });

    const hostWin = _createHostWindow(sessionId, peer.name);
    sessions.get(sessionId).hostWin = hostWin;

    return { ok: true };
  });

  // Host rejects incoming remote request
  ipcMain.handle('remote:reject', (_e, { sessionId, fromUuid }) => {
    const peer = store.getOnlineUsers().find(u => u.uuid === fromUuid);
    const profile = db.getProfile();
    if (peer && profile) {
      wsClient.sendTo(peer, {
        type: 'REMOTE_REJECT',
        sessionId,
        fromUuid: profile.uuid,
        toUuid: fromUuid,
      });
    }
    sessions.delete(sessionId);
    return { ok: true };
  });

  // Either side ends session
  ipcMain.handle('remote:end', (_e, { sessionId }) => {
    _endSession(sessionId, true);
    return { ok: true };
  });

  // Relay WebRTC signaling (SDP + ICE) from a remote window to WS peer
  ipcMain.on('remote:sendSignaling', (_e, msg) => {
    let peer = store.getOnlineUsers().find(u => u.uuid === msg.toUuid);
    if (!peer) {
      // Fallback: find the IP stored in the active session so signaling is never dropped
      for (const s of sessions.values()) {
        if (s.peerUuid === msg.toUuid && s.peerIp) {
          peer = { uuid: msg.toUuid, ip: s.peerIp, wsPort: 45679 };
          break;
        }
      }
    }
    if (peer) wsClient.sendTo(peer, msg);
  });

  // Minimize the viewer window without ending the session
  ipcMain.on('remote:minimize', _e => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (win && !win.isDestroyed()) win.minimize();
  });

  // Return ICE server configuration (STUN + optional TURN from settings)
  ipcMain.handle('remote:getIceServers', () => {
    const settings = db.getAllSettings ? db.getAllSettings() : {};
    const servers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ];
    if (settings.turnUrl && settings.turnUsername && settings.turnCredential) {
      servers.push({
        urls: settings.turnUrl,
        username: settings.turnUsername,
        credential: settings.turnCredential,
      });
    }
    return servers;
  });

  // Get available screen capture sources (for host window)
  ipcMain.handle('remote:getScreenSources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      return sources.map(s => ({ id: s.id, name: s.name }));
    } catch {
      return [];
    }
  });

  // Execute input event on host via robotjs
  ipcMain.on('remote:executeInput', (_e, ev) => {
    _executeInput(ev);
  });
}

// ── Window creation ───────────────────────────────────────────────────────────

function _createHostWindow(sessionId, peerName) {
  const win = new BrowserWindow({
    width: 380,
    height: 150,
    resizable: false,
    alwaysOnTop: true,
    frame: false,
    title: `NeuroChat Remote — Sesión con ${peerName}`,
    backgroundColor: '#0f1f1f',
    webPreferences: {
      preload: path.join(__dirname, '../renderer/remote-host-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win._isRemoteHost = true;
  win._sessionId = sessionId;

  // Buffer signaling until the renderer has loaded and registered its listener
  _signalingQueue.set(sessionId, []);
  win.webContents.once('did-finish-load', () => {
    const pending = _signalingQueue.get(sessionId);
    if (!pending) return;
    _signalingQueue.delete(sessionId);
    if (!win.isDestroyed()) pending.forEach(m => win.webContents.send('remote:signaling', m));
  });

  const session = sessions.get(sessionId);
  const profile = db?.getProfile();
  win.loadFile(path.join(__dirname, '../renderer/remote-host.html'), {
    query: {
      sessionId,
      peerName,
      peerUuid: session?.peerUuid || '',
      myUuid: profile?.uuid || '',
    },
  });

  win.on('closed', () => {
    const s = sessions.get(sessionId);
    if (s) _endSession(sessionId, true);
  });

  return win;
}

function _createViewerWindow(sessionId, peerName, peerIp, screenW, screenH) {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;

  const ratio = (screenW || 1920) / (screenH || 1080);
  let winW = Math.min(1280, sw - 40);
  let winH = Math.round(winW / ratio) + 50; // +50 for toolbar
  if (winH > sh - 40) {
    winH = sh - 40;
    winW = Math.round((winH - 50) * ratio);
  }

  const win = new BrowserWindow({
    width: Math.max(800, winW),
    height: Math.max(500, winH),
    minWidth: 640,
    minHeight: 420,
    title: `NeuroChat Remote — ${peerName} (${peerIp})`,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, '../renderer/remote-viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win._isRemoteViewer = true;
  win._sessionId = sessionId;

  win.loadFile(path.join(__dirname, '../renderer/remote-viewer.html'), {
    query: { sessionId, peerName, peerIp, peerUuid: sessions.get(sessionId)?.peerUuid || '' },
  });

  // Buffer signaling messages until the renderer has loaded and set up its IPC listener.
  // webContents.send() before did-finish-load is silently dropped.
  _signalingQueue.set(sessionId, []);
  win.webContents.once('did-finish-load', () => {
    const pending = _signalingQueue.get(sessionId);
    if (!pending) return;
    _signalingQueue.delete(sessionId);
    if (!win.isDestroyed()) pending.forEach(m => win.webContents.send('remote:signaling', m));
  });

  win.on('closed', () => {
    _signalingQueue.delete(sessionId);
    _endSession(sessionId, true);
  });

  return win;
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

function _endSession(sessionId, notify) {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);

  if (notify) {
    const peer = store.getOnlineUsers().find(u => u.uuid === session.peerUuid);
    const profile = db?.getProfile();
    if (peer && profile) {
      wsClient.sendTo(peer, {
        type: 'REMOTE_END',
        sessionId,
        fromUuid: profile.uuid,
        toUuid: session.peerUuid,
      });
    }
  }

  _signalingQueue.delete(sessionId);
  if (session.hostWin && !session.hostWin.isDestroyed()) session.hostWin.destroy();
  if (session.viewerWin && !session.viewerWin.isDestroyed()) session.viewerWin.destroy();
}

// ── WebSocket signaling handler (called by wsServer.handleIncoming) ───────────

function handleSignaling(msg) {
  const { type, sessionId } = msg;

  if (type === 'REMOTE_REQUEST') {
    const settings = db.getAllSettings ? db.getAllSettings() : {};
    const mode = settings.remoteSupportMode || 'ask';
    const myDomain = process.platform === 'win32' ? (process.env.USERDOMAIN || '') : '';
    const fromDomain = msg.fromDomain || '';
    const sameDomain = myDomain && fromDomain && myDomain.toLowerCase() === fromDomain.toLowerCase();

    if (mode === 'auto-accept-all' || (mode === 'auto-accept-domain' && sameDomain)) {
      _autoAccept(msg);
    } else {
      _notifyMainWindows('remote:incoming-request', msg);
      // OS-level notification so the request is never missed
      try {
        const notifier = require('./notifier');
        notifier.notify({
          title: 'Solicitud de soporte remoto',
          body: `${msg.fromName || 'Alguien'} quiere conectarse a tu pantalla`,
          persistent: true,
          onClick: () => {
            BrowserWindow.getAllWindows()
              .filter(w => !w.isDestroyed() && !w._isRemoteHost && !w._isRemoteViewer)
              .forEach(w => { w.show(); w.focus(); });
          },
        });
      } catch {}
    }
    return;
  }

  if (type === 'REMOTE_ACCEPT') {
    const session = sessions.get(sessionId);
    if (session?.role === 'viewer' && session.status === 'pending') {
      session.status = 'active';
      const viewerWin = _createViewerWindow(
        sessionId,
        session.peerName,
        session.peerIp,
        msg.screenWidth,
        msg.screenHeight
      );
      session.viewerWin = viewerWin;
    }
    _notifyMainWindows('remote:session-accepted', { sessionId });
    return;
  }

  if (type === 'REMOTE_REJECT') {
    sessions.delete(sessionId);
    _notifyMainWindows('remote:session-rejected', { sessionId });
    return;
  }

  if (type === 'REMOTE_END') {
    const session = sessions.get(sessionId);
    if (session?.hostWin && !session.hostWin.isDestroyed()) {
      session.hostWin.webContents.send('remote:session-ended', { sessionId });
    }
    if (session?.viewerWin && !session.viewerWin.isDestroyed()) {
      session.viewerWin.webContents.send('remote:session-ended', { sessionId });
    }
    _endSession(sessionId, false);
    _notifyMainWindows('remote:session-ended', { sessionId });
    return;
  }

  // WebRTC signaling (SDP offer/answer + ICE candidates) — forward to correct window
  if (type === 'REMOTE_SDP' || type === 'REMOTE_ICE') {
    const session = sessions.get(sessionId);
    if (!session) return;
    const target = session.role === 'host' ? session.hostWin : session.viewerWin;
    if (!target || target.isDestroyed()) return;

    const queue = _signalingQueue.get(sessionId);
    if (queue !== undefined) {
      queue.push(msg); // window still loading — will be flushed on did-finish-load
    } else {
      target.webContents.send('remote:signaling', msg);
    }
  }
}

// ── Input simulation (Windows host) ──────────────────────────────────────────

let _robot = null;
function _getRobot() {
  if (_robot !== null) return _robot;
  try {
    _robot = require('robotjs');
  } catch {
    _robot = false;
    console.warn('[remoteDesktop] robotjs no disponible — control de input deshabilitado');
  }
  return _robot;
}

function _executeInput(ev) {
  const r = _getRobot();
  if (!r) return;
  const { width, height } = screen.getPrimaryDisplay().size;

  try {
    switch (ev.type) {
      case 'mousemove':
        r.moveMouse(Math.round(ev.x * width), Math.round(ev.y * height));
        break;
      case 'mousedown':
      case 'mouseup': {
        const btn = ev.button === 2 ? 'right' : ev.button === 1 ? 'middle' : 'left';
        r.moveMouse(Math.round(ev.x * width), Math.round(ev.y * height));
        r.mouseToggle(ev.type === 'mousedown' ? 'down' : 'up', btn);
        break;
      }
      case 'dblclick':
        r.moveMouse(Math.round(ev.x * width), Math.round(ev.y * height));
        r.mouseClick('left', true);
        break;
      case 'wheel': {
        const sx = Math.round((ev.dx || 0) / 120);
        const sy = Math.round((ev.dy || 0) / 120);
        if (sx !== 0 || sy !== 0) r.scrollMouse(sx, sy);
        break;
      }
      case 'keydown': {
        const key = _mapKey(ev.key);
        if (!key) break;
        const mods = (ev.modifiers || []).map(_mapMod).filter(Boolean);
        mods.length > 0 ? r.keyTap(key, mods) : r.keyTap(key);
        break;
      }
    }
  } catch (err) {
    console.warn('[remoteDesktop] input error:', err.message);
  }
}

function _mapKey(key) {
  const MAP = {
    ' ': 'space', Enter: 'enter', Backspace: 'backspace', Tab: 'tab',
    Escape: 'escape', Delete: 'delete', Insert: 'insert',
    Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
    F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
    Control: 'control', Alt: 'alt', Shift: 'shift', Meta: 'command',
    CapsLock: 'caps_lock', PrintScreen: 'printscreen',
  };
  return MAP[key] ?? (key.length === 1 ? key.toLowerCase() : null);
}

function _mapMod(m) {
  return { ctrl: 'control', alt: 'alt', shift: 'shift', meta: 'command' }[m] ?? null;
}

// ── Auto-accept (domain trust) ────────────────────────────────────────────────

async function _autoAccept(msg) {
  const { sessionId, fromUuid, fromName } = msg;
  const peer = store.getOnlineUsers().find(u => u.uuid === fromUuid);
  if (!peer?.ip) return;

  const profile = db.getProfile();
  if (!profile) return;

  // macOS: verify screen recording permission before accepting
  const hasPermission = await _checkScreenPermission();
  if (!hasPermission) {
    wsClient.sendTo(peer, {
      type: 'REMOTE_REJECT',
      sessionId,
      fromUuid: profile.uuid,
      toUuid: fromUuid,
    });
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().size;

  sessions.set(sessionId, {
    role: 'host',
    peerUuid: fromUuid,
    peerIp: peer.ip,
    peerName: fromName || peer.name,
    status: 'active',
  });

  wsClient.sendTo(peer, {
    type: 'REMOTE_ACCEPT',
    sessionId,
    fromUuid: profile.uuid,
    toUuid: fromUuid,
    screenWidth: width,
    screenHeight: height,
  });

  const hostWin = _createHostWindow(sessionId, fromName || peer.name);
  sessions.get(sessionId).hostWin = hostWin;

  _notifyMainWindows('remote:session-started', { sessionId, peerName: fromName || peer.name });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _notifyMainWindows(channel, data) {
  BrowserWindow.getAllWindows()
    .filter(w => !w.isDestroyed() && !w._isRemoteHost && !w._isRemoteViewer)
    .forEach(w => w.webContents.send(channel, data));
}

module.exports = { init, handleSignaling, sessions };
