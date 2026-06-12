'use strict';

const dgram = require('dgram');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const UDP_PORT = 45678;
const BROADCAST_INTERVAL = 5_000; // 5 s
const USER_TIMEOUT = 18_000; // 18 s sin señal → offline
const TIMEOUT_CHECK = 5_000; // revisar cada 5 s
const MAX_TARGET_HOSTS = 1024;
const DEFAULT_DISCOVERY_TARGETS = '172.16.30.0/24\n192.168.1.0/24';

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
      // Node.js <18: family is 'IPv4'; Node.js 18+: family is the number 4
      if ((addr.family === 'IPv4' || addr.family === 4) && !addr.internal) {
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

function isValidIPv4(ip) {
  const parts = String(ip || '').trim().split('.');
  return parts.length === 4 && parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function intToIp(n) {
  return [24, 16, 8, 0].map(shift => (n >>> shift) & 0xff).join('.');
}

function expandCidr(cidr) {
  const [base, prefixRaw] = String(cidr).split('/');
  const prefix = Number(prefixRaw);
  if (!isValidIPv4(base) || !Number.isInteger(prefix) || prefix < 24 || prefix > 32) return [];

  const count = 2 ** (32 - prefix);
  if (count > MAX_TARGET_HOSTS) return [];

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipToInt(base) & mask;
  const first = prefix === 32 ? network : network + 1;
  const last = prefix >= 31 ? network + count - 1 : network + count - 2;
  const ips = [];
  for (let n = first; n <= last; n++) ips.push(intToIp(n >>> 0));
  return ips;
}

function getExtraDiscoveryTargets() {
  const settings = db?.getAllSettings ? db.getAllSettings() : {};
  const raw = settings.discoveryTargets || DEFAULT_DISCOVERY_TARGETS;
  const tokens = Array.isArray(raw)
    ? raw
    : String(raw).split(/[\s,;]+/).filter(Boolean);

  const localIps = new Set(getLocalIPs());
  const targets = new Set();

  tokens.forEach(token => {
    const trimmed = String(token).trim();
    const expanded = trimmed.includes('/') ? expandCidr(trimmed) : [trimmed];
    expanded.forEach(ip => {
      if (isValidIPv4(ip) && !localIps.has(ip)) targets.add(ip);
    });
  });

  return Array.from(targets);
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

function buildPayload() {
  if (!myProfile) return null;
  const ifaces = getNetworkInterfaces();
  const ips = ifaces.map(iface => iface.ip);

  return Buffer.from(
    JSON.stringify({
      type: 'NEUROCHAT_ANNOUNCE',
      uuid: myProfile.uuid,
      name: myProfile.name,
      avatar: myProfile.avatar || null,
      color: myProfile.color || '#4A9E8F',
      status: myProfile.status || 'available',
      statusMessage: myProfile.status_message || '',
      wsPort: 45679,
      ip: ips[0] || '',
      ips,
      version: app.getVersion(),
      domain: process.platform === 'win32' ? (process.env.USERDOMAIN || '') : '',
    })
  );
}

function broadcast() {
  if (!socket || !myProfile) return;
  if (myProfile.status === 'invisible') return; // no emite — aparece desconectado

  const payload = buildPayload();
  if (!payload) return;

  const ifaces = getNetworkInterfaces();
  if (ifaces.length) {
    for (const { broadcast: bcast } of ifaces) {
      socket.send(payload, 0, payload.length, UDP_PORT, bcast, err => {
        if (err) console.warn(`[Discovery] broadcast → ${bcast}: ${err.message}`);
      });
    }
  } else {
    // No local interfaces detected — use general broadcast as fallback
    socket.send(payload, 0, payload.length, UDP_PORT, '255.255.255.255', err => {
      if (err) console.warn(`[Discovery] fallback broadcast: ${err.message}`);
    });
  }

  for (const target of getExtraDiscoveryTargets()) {
    socket.send(payload, 0, payload.length, UDP_PORT, target, err => {
      if (err) console.warn(`[Discovery] target → ${target}: ${err.message}`);
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

  if (data.type === 'NEUROCHAT_LEAVE') {
    if (data.uuid && myProfile?.uuid !== data.uuid) {
      store.setUserOffline(data.uuid);
      db.setUserOffline(data.uuid);
      scheduleNotify();
    }
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
    status_message: data.statusMessage || '',
    ip: rinfo.address || data.ip,
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

function broadcastLeave() {
  if (!socket || !myProfile) return;
  const ifaces = getNetworkInterfaces();
  if (!ifaces.length) return;
  const payload = Buffer.from(JSON.stringify({
    type: 'NEUROCHAT_LEAVE',
    uuid: myProfile.uuid,
  }));
  for (const { broadcast: bcast } of ifaces) {
    try {
      socket.send(payload, 0, payload.length, UDP_PORT, bcast, () => {});
    } catch (_) {}
  }
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

  // Broadcast departure so peers mark us offline immediately
  broadcastLeave();

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
