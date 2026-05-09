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

    const record = {
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
      edited: 0,
      deleted: 0,
      delivered: 1,
      read_by: [],
    };
    db.saveMessage(record); // ON CONFLICT DO NOTHING — safe to call multiple times

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
  }
}

function notifyRenderer(event, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(event, data);
  });
}

function maybeNotify(record, sender) {
  const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  if (wins.some(w => w.isFocused())) return;

  const settings = db.getAllSettings ? db.getAllSettings() : {};
  if (settings.notificationsEnabled === false) return;

  const profile = db.getProfile();
  if (profile?.status === 'dnd') return;

  let body;
  if (record.type === 'file') {
    try {
      body = `📎 ${JSON.parse(record.content).name}`;
    } catch {
      body = '📎 Archivo';
    }
  } else {
    body = String(record.content || '').slice(0, 80);
  }

  const chatId = record.channel_id || record.from_uuid;
  const chatType = record.channel_id ? 'channel' : 'dm';

  require('./notifier').notify({
    title: sender.name || 'NeuroChat',
    body,
    onClick: () => {
      wins.forEach(w => {
        w.show();
        w.focus();
      });
      notifyRenderer('notification:navigate', { chatId, chatType });
    },
  });
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

module.exports = {
  start,
  stop,
  broadcast,
  broadcastEdit,
  broadcastDelete,
  broadcastReaction,
  broadcastTyping,
};
