#!/usr/bin/env node
'use strict';

/**
 * NeuroChat Signaling Server
 *
 * Deploy on a cheap VPS (4-6 EUR/month) so NeuroChat remote desktop works
 * across the internet without either side needing a public IP or port-forwarding.
 *
 * This is the equivalent of RustDesk's hbbs (rendezvous/hole-punching broker).
 * WebRTC's ICE does the actual hole punching — this server only exchanges
 * SDP offers/answers and ICE candidates between the two peers.
 *
 * Usage:
 *   PORT=8765 TURN_SECRET=<your-secret> node server/signaling.js
 *
 * Pairs with coturn for TURN relay when direct P2P fails.
 * See server/coturn.conf for the TURN server configuration.
 */

const WebSocket = require('ws');
const crypto    = require('crypto');

const PORT        = process.env.PORT        || 8765;
const TURN_HOST   = process.env.TURN_HOST   || '';   // e.g. 'turn.tu-dominio.com'
const TURN_SECRET = process.env.TURN_SECRET || '';   // shared secret for coturn HMAC auth

const wss = new WebSocket.Server({ port: PORT }, () =>
  console.log(`[signaling] Escuchando en puerto ${PORT}`)
);

// rooms: code (9 digits) → { host: WebSocket, viewers: Set<WebSocket>, timer }
const rooms    = new Map();
// reverse: ws → code
const wsToCode = new WeakMap();
// weak ids for viewers
const viewerIds = new WeakMap();
let _nextViewerId = 1;

const ROOM_TTL_MS = 30 * 60 * 1000; // 30-minute session TTL

// ── TURN credential generation (HMAC-SHA1 short-term) ─────────────────────────

function getTurnCredentials() {
  if (!TURN_HOST || !TURN_SECRET) return null;
  const ttl      = 3600;
  const expiry   = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:neurochat`;
  const credential = crypto
    .createHmac('sha1', TURN_SECRET)
    .update(username)
    .digest('base64');
  return {
    urls: [
      `turn:${TURN_HOST}:3478`,
      `turn:${TURN_HOST}:3478?transport=tcp`,
      `turns:${TURN_HOST}:5349`,
    ],
    username,
    credential,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateCode() {
  // 9-digit numeric code, never starts with 0 (same pattern as RustDesk)
  const n = (crypto.randomInt(900_000_000) + 100_000_000);
  return String(n); // "472819563"
}

function getViewerId(ws) {
  if (!viewerIds.has(ws)) viewerIds.set(ws, `v${_nextViewerId++}`);
  return viewerIds.get(ws);
}

function safeSend(ws, data) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function destroyRoom(code, reason) {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.timer);
  room.viewers.forEach(v => safeSend(v, { type: 'host-disconnected', reason }));
  rooms.delete(code);
  console.log(`[signaling] Sala ${code} eliminada (${reason})`);
}

// ── Connection handler ────────────────────────────────────────────────────────

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const { type, code } = msg;

    // ── Host: request a new session code ─────────────────────────────────────
    if (type === 'request-code') {
      // Clean up any previous registration for this WS
      const prev = wsToCode.get(ws);
      if (prev) destroyRoom(prev, 'host-reconnected');

      // Find a free code
      let newCode;
      let attempts = 0;
      do {
        newCode = generateCode();
        if (++attempts > 100) {
          safeSend(ws, { type: 'error', reason: 'code-space-full' });
          return;
        }
      } while (rooms.has(newCode));

      const timer = setTimeout(() => destroyRoom(newCode, 'ttl-expired'), ROOM_TTL_MS);
      rooms.set(newCode, { host: ws, viewers: new Set(), timer });
      wsToCode.set(ws, newCode);

      // Include TURN credentials if configured
      const turnCreds = getTurnCredentials();
      safeSend(ws, { type: 'code-assigned', code: newCode, turn: turnCreds });
      console.log(`[signaling] Host registrado: ${newCode}`);
      return;
    }

    // ── Viewer: join a session by code ────────────────────────────────────────
    if (type === 'join') {
      if (!code) return;
      const room = rooms.get(code);
      if (!room) {
        safeSend(ws, { type: 'error', reason: 'code-not-found' });
        return;
      }
      if (wsToCode.get(ws) === code) return; // already joined
      room.viewers.add(ws);
      wsToCode.set(ws, code);

      const turnCreds = getTurnCredentials();
      safeSend(ws, { type: 'joined', code, turn: turnCreds });
      safeSend(room.host, { type: 'viewer-joined', viewerId: getViewerId(ws) });
      console.log(`[signaling] Viewer ${getViewerId(ws)} unido a ${code}`);
      return;
    }

    // ── WebRTC signaling relay (offer / answer / ice) ─────────────────────────
    if (type === 'offer' || type === 'answer' || type === 'ice') {
      const roomCode = wsToCode.get(ws);
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;

      if (ws === room.host) {
        // Host → all viewers
        room.viewers.forEach(v => safeSend(v, msg));
      } else if (room.viewers.has(ws)) {
        // Viewer → host (tag with viewerId so host can track multi-viewer later)
        safeSend(room.host, { ...msg, viewerId: getViewerId(ws) });
      }
      return;
    }

    // ── Keepalive / ping ──────────────────────────────────────────────────────
    if (type === 'ping') {
      safeSend(ws, { type: 'pong' });
      return;
    }
  });

  ws.on('close', () => {
    const code = wsToCode.get(ws);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (ws === room.host) {
      destroyRoom(code, 'host-closed');
    } else {
      room.viewers.delete(ws);
      safeSend(room.host, { type: 'viewer-left', viewerId: getViewerId(ws) });
    }
  });

  ws.on('error', err => console.warn('[signaling] ws error:', err.message));
});

wss.on('error', err => console.error('[signaling] server error:', err.message));
