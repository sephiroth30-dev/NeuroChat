'use strict';

const WebSocket = require('ws');

// Connection pool: uuid → WebSocket
const pool = new Map();

// ── Send to a peer ────────────────────────────────────────────────────────────

function sendTo(peer, payload) {
  if (!peer?.ip) return;

  const { uuid, ip, wsPort = 45679 } = peer;

  const existing = pool.get(uuid);

  if (existing) {
    if (existing.readyState === WebSocket.OPEN) {
      existing.send(JSON.stringify(payload));
      return;
    }
    if (existing.readyState === WebSocket.CONNECTING) {
      existing._queue = existing._queue || [];
      existing._queue.push(payload);
      return;
    }
    // CLOSING or CLOSED — fall through to reconnect
    pool.delete(uuid);
  }

  const ws = new WebSocket(`ws://${ip}:${wsPort}`, { handshakeTimeout: 5000 });
  ws._queue = [payload];
  pool.set(uuid, ws);

  ws.on('open', () => {
    const q = ws._queue || [];
    ws._queue = null;
    q.forEach(p => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(p));
    });
  });

  ws.on('error', err => {
    console.warn(`[wsClient] Error → ${uuid.slice(0, 8)}@${ip}: ${err.message}`);
    // Re-queue undelivered messages so they reach the recipient when they reconnect
    if (ws._queue?.length > 0) {
      const store = require('./store');
      ws._queue.forEach(p => store.queueMessage(uuid, p));
      ws._queue = null;
    }
    pool.delete(uuid);
  });

  ws.on('close', () => {
    // Re-queue any messages that were never sent (error handler may have already cleared _queue)
    if (ws._queue?.length > 0) {
      const store = require('./store');
      ws._queue.forEach(p => store.queueMessage(uuid, p));
      ws._queue = null;
    }
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
