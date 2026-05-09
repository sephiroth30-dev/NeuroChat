'use strict';

const dgram = require('dgram');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const UDP_PORT = 45678;
const BROADCAST_INTERVAL = 30_000; // 30 s
const USER_TIMEOUT = 90_000; // 90 s sin señal → offline
const TIMEOUT_CHECK = 15_000; // revisar cada 15 s

let socket = null;
let broadcastInterval = null;
let timeoutCheckInterval = null;
let notifyTimer = null;
let myProfile = null;
let db = null;
let store = null;

// ── Network helpers ───────────────────────────────────────────────────────────

function getNetworkInterfaces() {
  const result = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ ip: addr.address, broadcast: calcBroadcast(addr.address, addr.netmask) });
      }
    }
  }
  return result;
}

function calcBroadcast(ip, netmask) {
  const ipParts = ip.split('.').map(Number);
  const maskParts = netmask.split('.').map(Number);
  return ipParts.map((p, i) => (p | (~maskParts[i] & 0xff)) >>> 0).join('.');
}

function getLocalIPs() {
  return getNetworkInterfaces().map(i => i.ip);
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

function buildPayload() {
  if (!myProfile) return null;
  const ifaces = getNetworkInterfaces();
  if (!ifaces.length) return null;

  return Buffer.from(
    JSON.stringify({
      type: 'NEUROCHAT_ANNOUNCE',
      uuid: myProfile.uuid,
      name: myProfile.name,
      avatar: myProfile.avatar || null,
      color: myProfile.color || '#4A9E8F',
      status: myProfile.status || 'available',
      wsPort: 45679,
      ip: ifaces[0].ip,
      version: app.getVersion(),
    })
  );
}

function broadcast() {
  if (!socket || !myProfile) return;
  if (myProfile.status === 'invisible') return; // invisible no emite

  const payload = buildPayload();
  if (!payload) return;

  for (const { broadcast: bcast } of getNetworkInterfaces()) {
    socket.send(payload, 0, payload.length, UDP_PORT, bcast, err => {
      if (err) console.warn(`[Discovery] broadcast → ${bcast}: ${err.message}`);
    });
  }
}

// ── Incoming message handler ──────────────────────────────────────────────────

function handleMessage(msg, rinfo) {
  let data;
  try {
    data = JSON.parse(msg.toString());
  } catch {
    return;
  }

  if (data.type !== 'NEUROCHAT_ANNOUNCE') return;
  if (!data.uuid || !data.name) return;
  if (myProfile && data.uuid === myProfile.uuid) return; // ignorar eco propio

  const now = Date.now();
  const user = {
    uuid: data.uuid,
    name: data.name,
    avatar: data.avatar || null,
    color: data.color || '#4A9E8F',
    status: data.status || 'available',
    ip: data.ip || rinfo.address,
    wsPort: data.wsPort || 45679,
    is_online: 1,
    last_seen: now,
  };

  store.setUserOnline(user);
  db.upsertUser(user);

  // Deliver any messages queued while this peer was offline
  const pending = store.drainQueue(user.uuid);
  if (pending.length > 0) {
    const wsClient = require('./wsClient');
    console.log(`[Discovery] Entregando ${pending.length} mensaje(s) encolado(s) a ${user.name}`);
    pending.forEach(payload => wsClient.sendTo(user, payload));
  }

  scheduleNotify();
}

// ── Timeout check ─────────────────────────────────────────────────────────────

function checkTimeouts() {
  const now = Date.now();
  let changed = false;

  for (const user of store.getOnlineUsers()) {
    if (user.lastSeen && now - user.lastSeen > USER_TIMEOUT) {
      store.setUserOffline(user.uuid);
      db.setUserOffline(user.uuid);
      changed = true;
      console.log(`[Discovery] ${user.name} (${user.uuid.slice(0, 8)}) → offline (timeout)`);
    }
  }

  if (changed) scheduleNotify();
}

// ── Renderer notification (debounced) ─────────────────────────────────────────

function scheduleNotify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('users:updated');
    });
  }, 200);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start() {
  db = require('./database');
  store = require('./store');

  myProfile = db.getProfile(); // puede ser null en primer arranque

  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', err => {
    console.error('[Discovery] UDP socket error:', err.message);
  });

  socket.on('message', handleMessage);

  socket.bind(UDP_PORT, () => {
    try {
      socket.setBroadcast(true);
    } catch (e) {
      console.error('[Discovery] setBroadcast failed:', e.message);
    }

    console.log(`[Discovery] Escuchando en UDP ${UDP_PORT}`);

    // Anuncio inmediato al arrancar
    broadcast();

    broadcastInterval = setInterval(broadcast, BROADCAST_INTERVAL);
    timeoutCheckInterval = setInterval(checkTimeouts, TIMEOUT_CHECK);
  });
}

function stop() {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
  }
  if (timeoutCheckInterval) {
    clearInterval(timeoutCheckInterval);
    timeoutCheckInterval = null;
  }

  // Marcar todos los usuarios como offline al salir
  if (store && db) {
    store.getOnlineUsers().forEach(u => db.setUserOffline(u.uuid));
  }

  if (socket) {
    try {
      socket.close();
    } catch (_) {}
    socket = null;
  }
}

function updateAnnounce(profile) {
  myProfile = { ...(myProfile || {}), ...profile };
  broadcast(); // re-anunciar inmediatamente cuando cambia perfil/estado
}

module.exports = { start, stop, updateAnnounce, getLocalIPs };
