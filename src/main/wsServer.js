'use strict';

const WebSocket = require('ws');
const { BrowserWindow } = require('electron');

const WS_PORT = 45679;

let wss = null;
let db = null;
let store = null;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start(port) {
  db = require('./database');
  store = require('./store');

  const listenPort = port || WS_PORT;
  wss = new WebSocket.Server({ port: listenPort }, () => {
    console.log(`[wsServer] Escuchando en TCP ${listenPort}`);
  });

  wss.on('connection', ws => {
    ws.on('message', raw => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      handleIncoming(msg);
    });
    ws.on('error', err => console.warn('[wsServer] conexión error:', err.message));
  });

  wss.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[wsServer] Puerto ${WS_PORT} en uso — otro proceso lo ocupa`);
    } else {
      console.error('[wsServer] error:', err.message);
    }
  });
}

function stop() {
  require('./wsClient').closeAll();
  clearPendingNotifications();
  if (wss) {
    wss.close(() => {});
    wss = null;
  }
}

// ── Incoming message handler ──────────────────────────────────────────────────

function handleIncoming(msg) {
  const { type } = msg;

  if (type === 'MESSAGE') {
    if (!msg.id || !msg.fromUuid) return;

    let record = {
      id: msg.id,
      channel_id: msg.channelId || null,
      private_chat_uuid:
        !msg.channelId && msg.fromUuid && msg.toUuid
          ? [msg.fromUuid, msg.toUuid].sort().join(':')
          : null,
      from_uuid: msg.fromUuid,
      content: msg.content || '',
      type: msg.msgType || 'text',
      reply_to: msg.replyTo || null,
      timestamp: msg.timestamp || Date.now(),
      received_at: Date.now(),
      edited: 0,
      deleted: 0,
      delivered: 1,
      read_by: [],
    };

    // For incoming audio: extract base64, save to disk, strip data from DB content
    if (record.type === 'audio') {
      try {
        const meta = JSON.parse(record.content || '{}');
        if (meta.data && meta.name) {
          const { app: electronApp } = require('electron');
          const nodeFs = require('fs');
          const nodePath = require('path');
          const nodeCrypto = require('crypto');
          const audioDir = nodePath.join(electronApp.getPath('userData'), 'audio');
          nodeFs.mkdirSync(audioDir, { recursive: true });
          const localPath = nodePath.join(audioDir, meta.name);
          nodeFs.writeFileSync(localPath, Buffer.from(meta.data, 'base64'));
          record = { ...record, content: JSON.stringify({ name: meta.name, size: meta.size, mimeType: meta.mimeType }) };
          db.saveMessage(record);
          db.saveFile({
            id: nodeCrypto.randomUUID(), message_id: record.id, original_name: meta.name,
            local_path: localPath, size: meta.size || 0, mime_type: meta.mimeType || 'audio/webm',
            sha256: '', timestamp: Date.now(),
          });
        } else {
          db.saveMessage(record);
        }
      } catch (err) {
        console.warn('[wsServer] audio save error:', err.message);
        db.saveMessage(record);
      }
    } else {
      db.saveMessage(record); // ON CONFLICT DO NOTHING — safe to call multiple times
    }

    const sender = db.getAllUsers().find(u => u.uuid === msg.fromUuid) || {};
    const channel = msg.channelId ? db.getChannels().find(c => c.id === msg.channelId) : null;

    notifyRenderer('message:incoming', {
      ...record,
      sender_name: sender.name || 'Usuario',
      color: sender.color || '#4A9E8F',
      channel_name: channel?.name || null,
      reactions: [],
    });
    maybeNotify(record, sender);
  } else if (type === 'EDIT') {
    if (!msg.id) return;
    db.editMessage(msg.id, msg.content || '');
    notifyRenderer('message:edited', { id: msg.id, content: msg.content });
  } else if (type === 'DELETE') {
    if (!msg.id) return;
    db.deleteMessage(msg.id);
    notifyRenderer('message:deleted', { id: msg.id });
  } else if (type === 'REACTION') {
    if (!msg.messageId || !msg.fromUuid || !msg.emoji) return;
    db.upsertReaction(msg.messageId, msg.fromUuid, msg.emoji);
    notifyRenderer('message:reaction', {
      messageId: msg.messageId,
      fromUuid: msg.fromUuid,
      emoji: msg.emoji,
    });
  } else if (type === 'TYPING') {
    if (!msg.fromUuid) return;
    const sender = db.getAllUsers().find(u => u.uuid === msg.fromUuid) || {};
    const chatId = msg.channelId || msg.fromUuid;
    notifyRenderer('typing:incoming', { name: sender.name || 'Alguien', chatId });
  } else if (type === 'READ_RECEIPT') {
    if (!msg.messageId || !msg.readerUuid) return;
    db.markRead(msg.messageId, msg.readerUuid);
    notifyRenderer('message:read', { messageId: msg.messageId, readerUuid: msg.readerUuid });
  } else if (type === 'FILE_OFFER') {
    require('./fileTransfer').onOffer(msg);
  } else if (type === 'FILE_REJECT') {
    notifyRenderer('file:rejected', { transferId: msg.transferId });
  } else if (type === 'CHANNEL_UPSERT') {
    if (!msg.channel?.id || !msg.channel?.name) return;
    db.upsertChannel({
      id: msg.channel.id,
      name: msg.channel.name,
      description: msg.channel.description || null,
      created_by: msg.channel.created_by || msg.fromUuid || null,
      created_at: msg.channel.created_at || Date.now(),
      is_default: msg.channel.is_default ? 1 : 0,
    });
    if (Array.isArray(msg.memberIds)) {
      db.replaceChannelMembers(msg.channel.id, msg.memberIds, msg.fromUuid || null);
    }
    notifyRenderer('channel:synced', { id: msg.channel.id });
  } else if (type === 'CHANNEL_DELETE') {
    if (!msg.channelId) return;
    db.deleteChannel(msg.channelId);
    notifyRenderer('channel:synced', { id: msg.channelId, deleted: true });
  }
}

function notifyRenderer(event, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(event, data);
  });
}

// Pending notification groups: chatId → { senderName, count, chatType, timer }
const _pendingNotifs = new Map();
let _unreadTotal = 0;

function maybeNotify(record, sender) {
  const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  if (wins.some(w => w.isFocused())) return;

  const settings = db.getAllSettings ? db.getAllSettings() : {};
  if (settings.notificationsEnabled === false) return;

  const profile = db.getProfile();
  if (profile?.status === 'dnd') return;

  const chatId = record.channel_id || record.from_uuid;
  const chatType = record.channel_id ? 'channel' : 'dm';
  const senderName = sender.name || 'NeuroChat';

  // Accumulate messages per chat, debounce 1.5 s to group bursts
  const existing = _pendingNotifs.get(chatId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.count += 1;
    existing.lastBody = buildBody(record);
  } else {
    _pendingNotifs.set(chatId, { senderName, count: 1, chatType, lastBody: buildBody(record) });
  }
  _unreadTotal += 1;

  const entry = _pendingNotifs.get(chatId);
  entry.timer = setTimeout(() => {
    _pendingNotifs.delete(chatId);
    fireNotification({ chatId, chatType, senderName: entry.senderName, count: entry.count, lastBody: entry.lastBody });
    updateTrayBadge();
  }, 1500);
  entry.timer.unref?.();

  updateTrayBadge();
}

function buildBody(record) {
  if (record.type === 'file') {
    try { return `📎 ${JSON.parse(record.content).name}`; } catch { return '📎 Archivo'; }
  }
  if (record.type === 'audio') return '🎤 Nota de voz';
  return String(record.content || '').slice(0, 80);
}

function fireNotification({ chatId, chatType, senderName, count, lastBody }) {
  const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  const title = count === 1 ? senderName : `${senderName} (${count} mensajes)`;
  const body = count === 1 ? lastBody : `${count} mensajes nuevos`;

  require('./notifier').notify({
    title,
    body,
    persistent: true,
    onClick: () => {
      wins.forEach(w => { if (!w.isDestroyed()) { w.show(); w.focus(); } });
      setTimeout(() => notifyRenderer('notification:navigate', { chatId, chatType }), 250);
    },
  });
}

function updateTrayBadge() {
  const count = _unreadTotal;
  try {
    const tray = require('./tray');
    tray.notifyUnread(count > 0, count);
  } catch {}
}

function clearUnread() {
  _unreadTotal = 0;
  updateTrayBadge();
}

function clearPendingNotifications() {
  _pendingNotifs.forEach(entry => {
    if (entry.timer) clearTimeout(entry.timer);
  });
  _pendingNotifs.clear();
}

// ── Outbound helpers (called by ipcHandlers) ──────────────────────────────────

function broadcast(message) {
  const wsClient = require('./wsClient');
  const profile = db.getProfile();
  if (!profile) return;

  const base = {
    type: 'MESSAGE',
    id: message.id,
    fromUuid: message.from_uuid,
    content: message.content,
    msgType: message.type,
    replyTo: message.reply_to || null,
    timestamp: message.timestamp,
  };

  if (message.channel_id) {
    const payload = { ...base, channelId: message.channel_id };
    store.getOnlineUsers().forEach(u => wsClient.sendTo(u, payload));
  } else if (message.private_chat_uuid) {
    const toUuid = message.private_chat_uuid.split(':').find(id => id !== profile.uuid);
    if (!toUuid) return;
    const peer = store.getOnlineUsers().find(u => u.uuid === toUuid);
    if (peer) {
      wsClient.sendTo(peer, { ...base, toUuid });
    } else {
      // Recipient offline — queue for delivery when they come back online
      store.queueMessage(toUuid, { ...base, toUuid });
      console.log(`[wsServer] Mensaje encolado para ${toUuid.slice(0, 8)} (offline)`);
    }
  }
}

function broadcastEdit(id, content) {
  const wsClient = require('./wsClient');
  const payload = { type: 'EDIT', id, content };
  store.getOnlineUsers().forEach(u => wsClient.sendTo(u, payload));
}

function broadcastDelete(id) {
  const wsClient = require('./wsClient');
  const payload = { type: 'DELETE', id };
  store.getOnlineUsers().forEach(u => wsClient.sendTo(u, payload));
}

function broadcastReaction(messageId, fromUuid, emoji) {
  const wsClient = require('./wsClient');
  const payload = { type: 'REACTION', messageId, fromUuid, emoji };
  store.getOnlineUsers().forEach(u => wsClient.sendTo(u, payload));
}

function broadcastTyping(opts) {
  const wsClient = require('./wsClient');
  const profile = db.getProfile();
  if (!profile) return;

  const payload = {
    type: 'TYPING',
    fromUuid: profile.uuid,
    channelId: opts.channelId || null,
    toUuid: opts.toUuid || null,
  };

  if (opts.toUuid) {
    const peer = store.getOnlineUsers().find(u => u.uuid === opts.toUuid);
    if (peer) wsClient.sendTo(peer, payload);
  } else {
    store.getOnlineUsers().forEach(u => wsClient.sendTo(u, payload));
  }
}

function broadcastChannelUpsert(channel, memberIds = []) {
  const wsClient = require('./wsClient');
  const profile = db.getProfile();
  if (!profile || !channel?.id) return;

  const payload = {
    type: 'CHANNEL_UPSERT',
    fromUuid: profile.uuid,
    channel,
    memberIds,
  };
  store.getOnlineUsers().forEach(u => wsClient.sendTo(u, payload));
}

function broadcastChannelDelete(channelId) {
  const wsClient = require('./wsClient');
  const profile = db.getProfile();
  if (!profile || !channelId) return;

  const payload = {
    type: 'CHANNEL_DELETE',
    fromUuid: profile.uuid,
    channelId,
  };
  store.getOnlineUsers().forEach(u => wsClient.sendTo(u, payload));
}

module.exports = {
  start,
  stop,
  broadcast,
  broadcastEdit,
  broadcastDelete,
  broadcastReaction,
  broadcastTyping,
  broadcastChannelUpsert,
  broadcastChannelDelete,
  clearUnread,
  clearPendingNotifications,
};
