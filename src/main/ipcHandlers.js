'use strict';

const { ipcMain, app, shell, dialog, nativeTheme } = require('electron');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

let db,
  store,
  discovery,
  wsServer,
  wsClient,
  fileTransfer,
  diagnostics,
  tray,
  _notifier,
  windowManager;

function register() {
  db = require('./database');
  store = require('./store');
  discovery = require('./discovery');
  wsServer = require('./wsServer');
  wsClient = require('./wsClient');
  fileTransfer = require('./fileTransfer');
  diagnostics = require('./diagnostics');
  tray = require('./tray');
  _notifier = require('./notifier');
  windowManager = require('./windowManager');

  // ── Profile ────────────────────────────────────────────────────────────────

  ipcMain.handle('profile:get', () => {
    let profile = db.getProfile();
    if (!profile) {
      // First run: create profile with OS username
      profile = {
        uuid: crypto.randomUUID(),
        name: os.userInfo().username,
        avatar: null,
        color: pickColor(),
        status: 'available',
        status_message: '',
      };
      db.saveProfile(profile);
      // Let discovery know about the new profile so it can start broadcasting
      discovery.updateAnnounce(profile);
    }
    return profile;
  });

  ipcMain.handle('profile:save', (_e, data) => {
    db.saveProfile(data);
    discovery.updateAnnounce(data);
    return db.getProfile();
  });

  // ── Users ──────────────────────────────────────────────────────────────────

  ipcMain.handle('users:get', () => {
    const fromDb = db.getAllUsers();
    const online = store.getOnlineUsers();
    const onlineMap = new Map(online.map(u => [u.uuid, u]));
    return fromDb.map(u => ({ ...u, ...(onlineMap.get(u.uuid) || {}) }));
  });

  // ── Channels ───────────────────────────────────────────────────────────────

  ipcMain.handle('channels:get', () => db.getChannels());

  ipcMain.handle('channels:create', (_e, data) => {
    const profile = db.getProfile();
    const channel = {
      id: crypto.randomUUID(),
      name: data.name.trim(),
      description: data.description || null,
      created_by: profile.uuid,
      created_at: Date.now(),
      is_default: 0,
    };
    db.upsertChannel(channel);
    return channel;
  });

  ipcMain.handle('channels:delete', (_e, id) => {
    db.deleteChannel(id);
    return { ok: true };
  });

  // ── Messages ───────────────────────────────────────────────────────────────

  ipcMain.handle('messages:get', (_e, opts) => {
    const msgs = db.getMessages(opts);
    const allUsers = db.getAllUsers();
    const myProfile = db.getProfile();
    const userMap = new Map(allUsers.map(u => [u.uuid, u]));
    if (myProfile) userMap.set(myProfile.uuid, myProfile);
    return msgs.map(m => {
      const sender = userMap.get(m.from_uuid) || {};
      const result = {
        ...m,
        sender_name: sender.name || 'Usuario',
        color: sender.color || '#4A9E8F',
        read_by: JSON.parse(m.read_by || '[]'),
        reactions: db.getReactions(m.id),
      };
      if (m.type === 'file') {
        const fileRec = db.getFileByMsgId(m.id);
        if (fileRec) result.localPath = fileRec.local_path;
      }
      return result;
    });
  });

  ipcMain.handle('messages:send', (_e, msg) => {
    const profile = db.getProfile();
    const message = {
      id: crypto.randomUUID(),
      channel_id: msg.channelId || null,
      private_chat_uuid: msg.toUuid ? buildChatId(profile.uuid, msg.toUuid) : null,
      from_uuid: profile.uuid,
      content: msg.content,
      type: msg.type || 'text',
      reply_to: msg.replyTo || null,
      timestamp: Date.now(),
      edited: 0,
      deleted: 0,
      delivered: 0,
      read_by: [],
    };
    db.saveMessage(message);
    wsServer.broadcast(message);
    return message;
  });

  ipcMain.handle('messages:edit', (_e, id, content) => {
    db.editMessage(id, content);
    wsServer.broadcastEdit(id, content);
    return { ok: true };
  });

  ipcMain.handle('messages:delete', (_e, id) => {
    db.deleteMessage(id);
    wsServer.broadcastDelete(id);
    return { ok: true };
  });

  ipcMain.handle('messages:react', (_e, msgId, emoji) => {
    const profile = db.getProfile();
    db.upsertReaction(msgId, profile.uuid, emoji);
    wsServer.broadcastReaction(msgId, profile.uuid, emoji);
    return { ok: true };
  });

  ipcMain.handle('messages:pin', (_e, channelId, msgId) => {
    const profile = db.getProfile();
    db.pinMessage(channelId, msgId, profile.uuid);
    return { ok: true };
  });

  ipcMain.handle('messages:unpin', (_e, channelId, msgId) => {
    db.unpinMessage(channelId, msgId);
    return { ok: true };
  });

  ipcMain.handle('messages:pinned', (_e, channelId) => db.getPinnedMessages(channelId));

  // ── Files ──────────────────────────────────────────────────────────────────

  ipcMain.handle('file:send', async (_e, opts) => {
    const profile = db.getProfile();
    if (!profile) return { ok: false };

    const messageId = crypto.randomUUID();

    // Create file message in DB immediately so sender sees it in chat
    const message = {
      id: messageId,
      channel_id: opts.chatType === 'channel' ? opts.chatId : null,
      private_chat_uuid: opts.chatType === 'dm' ? buildChatId(profile.uuid, opts.chatId) : null,
      from_uuid: profile.uuid,
      content: JSON.stringify({ name: opts.name, size: opts.size, mimeType: opts.mimeType }),
      type: 'file',
      reply_to: null,
      timestamp: Date.now(),
      edited: 0,
      deleted: 0,
      delivered: 0,
      read_by: [],
    };
    db.saveMessage(message);

    // Send offer (computes SHA-256 hash, broadcasts FILE_OFFER via WebSocket)
    const { transferId, hash } = await fileTransfer.sendFile({ ...opts, messageId });

    // Save sender's own file record so the bubble is immediately "clickable" for sender
    db.saveFile({
      id: transferId,
      message_id: messageId,
      original_name: opts.name,
      local_path: opts.filePath,
      size: opts.size,
      mime_type: opts.mimeType,
      sha256: hash,
      timestamp: Date.now(),
    });

    // Broadcast the file message to peers via WebSocket
    wsServer.broadcast(message);

    return { ok: true };
  });

  ipcMain.handle('file:accept', (_e, transferId) => fileTransfer.accept(transferId));
  ipcMain.handle('file:reject', (_e, transferId) => fileTransfer.reject(transferId));
  ipcMain.handle('file:open', (_e, localPath) => shell.openPath(localPath));
  ipcMain.handle('file:chooseDir', async () => {
    const win = windowManager.getMainWindow();
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── Search ─────────────────────────────────────────────────────────────────

  ipcMain.handle('search:query', (_e, query, opts) => db.searchMessages(query, opts));

  // ── Settings ───────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => {
    const s = db.getAllSettings();
    return {
      soundEnabled: s.soundEnabled !== false,
      notificationsEnabled: s.notificationsEnabled !== false,
      downloadDir: s.downloadDir || path.join(os.homedir(), 'NeuroChat', 'Archivos'),
      startWithWindows: s.startWithWindows || false,
      theme: s.theme || 'auto',
      ...s,
    };
  });

  ipcMain.handle('settings:save', (_e, data) => {
    for (const [k, v] of Object.entries(data)) {
      db.setSetting(k, v);
      if (k === 'theme') {
        nativeTheme.themeSource = v === 'dark' ? 'dark' : v === 'light' ? 'light' : 'system';
      }
    }
    return { ok: true };
  });

  ipcMain.handle('settings:startup', (_e, enable) => {
    app.setLoginItemSettings({ openAtLogin: enable });
    db.setSetting('startWithWindows', enable);
    return { ok: true };
  });

  // ── Status ─────────────────────────────────────────────────────────────────

  ipcMain.handle('status:set', (_e, status) => {
    const profile = db.getProfile();
    profile.status = status;
    db.saveProfile(profile);
    discovery.updateAnnounce(profile);
    tray.updateStatus(status);
    return { ok: true };
  });

  ipcMain.handle('app:setBadge', (_e, count) => {
    try {
      app.setBadgeCount(count);
    } catch {}
    return { ok: true };
  });

  ipcMain.handle('status:setMessage', (_e, message) => {
    const profile = db.getProfile();
    profile.status_message = String(message || '').slice(0, 100);
    db.saveProfile(profile);
    return { ok: true };
  });

  // ── Debug / Dev ────────────────────────────────────────────────────────────

  ipcMain.handle('debug:seed', () => db.seedTestUsers());

  // ── Read receipts ──────────────────────────────────────────────────────────

  ipcMain.handle('read:mark', (_e, { messageId, senderUuid }) => {
    const profile = db.getProfile();
    if (!profile) return { ok: false };
    db.markRead(messageId, profile.uuid);
    const peer = store.getOnlineUsers().find(u => u.uuid === senderUuid);
    if (peer) {
      wsClient.sendTo(peer, {
        type: 'READ_RECEIPT',
        messageId,
        readerUuid: profile.uuid,
      });
    }
    return { ok: true };
  });

  // ── Typing ─────────────────────────────────────────────────────────────────

  ipcMain.handle('typing:send', (_e, opts) => {
    // Renderer sends { chatId, type: 'channel'|'dm' }
    wsServer.broadcastTyping({
      channelId: opts.type === 'channel' ? opts.chatId : null,
      toUuid: opts.type === 'dm' ? opts.chatId : null,
    });
    return { ok: true };
  });

  // ── Diagnostics ────────────────────────────────────────────────────────────

  ipcMain.handle('diagnostics:run', () => {
    const userCount = store.getOnlineUsers().length;
    return diagnostics.runDiagnostics(userCount);
  });

  ipcMain.handle('diagnostics:firewall', () => diagnostics.addFirewallRules());

  // ── App info ───────────────────────────────────────────────────────────────

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('app:networkInfo', () => {
    return {
      ips: discovery.getLocalIPs(),
      ports: { udp: 45678, ws: 45679, file: 45680 },
    };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildChatId(a, b) {
  return [a, b].sort().join(':');
}

const COLORS = [
  '#4A9E8F',
  '#5B8DD9',
  '#9B59B6',
  '#E67E22',
  '#E74C3C',
  '#1ABC9C',
  '#3498DB',
  '#F39C12',
];
let colorIndex = 0;
function pickColor() {
  return COLORS[colorIndex++ % COLORS.length];
}

module.exports = { register };
