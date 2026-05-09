'use strict';

const WebSocket = require('ws');

// Connection pool: uuid → WebSocket
const pool = new Map();

// ── Send to a peer ────────────────────────────────────────────────────────────

function sendTo(peer, payload) {
  if (!peer?.ip) return;

  const { uuid, ip, wsPort = 45679 } = peer;
  const raw = JSON.stringify(payload);

  const existing = pool.get(uuid);

  if (existing) {
    if (existing.readyState === WebSocket.OPEN) {
      existing.send(raw);
      return;
    }
    if (existing.readyState === WebSocket.CONNECTING) {
      existing._queue = existing._queue || [];
      existing._queue.push(raw);
      return;
    }
    // CLOSING or CLOSED — fall through to reconnect
    pool.delete(uuid);
  }

  const ws = new WebSocket(`ws://${ip}:${wsPort}`, { handshakeTimeout: 5000 });
  ws._queue = [raw];
  pool.set(uuid, ws);

  ws.on('open', () => {
    const q = ws._queue || [];
    ws._queue = null;
    q.forEach(m => {
      if (ws.readyState === WebSocket.OPEN) ws.send(m);
    });
  });

  ws.on('error', err => {
    console.warn(`[wsClient] Error → ${uuid.slice(0, 8)}@${ip}: ${err.message}`);
    pool.delete(uuid);
  });

  ws.on('close', () => {
    pool.delete(uuid);
  });
}

// ── Close all outgoing connections ────────────────────────────────────────────

function closeAll() {
  for (const ws of pool.values()) {
    try {
      ws.terminate();
    } catch {}
  }
  pool.clear();
}

module.exports = { sendTo, closeAll };
