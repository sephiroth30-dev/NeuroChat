'use strict';

const { ipcMain, app, shell, dialog, nativeTheme, nativeImage } = require('electron');
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

const DEFAULT_DISCOVERY_TARGETS = '172.16.30.0/24\n192.168.1.0/24';

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

  ipcMain.handle('users:lastActivity', () => db.getLastDMTimestamps());

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
    db.addAllKnownUsersToChannel(channel.id, profile.uuid);
    wsServer.broadcastChannelUpsert(channel, db.getChannelMemberIds(channel.id));
    return channel;
  });

  ipcMain.handle('channels:delete', (_e, id) => {
    db.deleteChannel(id);
    wsServer.broadcastChannelDelete(id);
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
      if (m.type === 'file' || m.type === 'audio') {
        const fileRec = db.getFileByMsgId(m.id);
        if (fileRec) result.localPath = fileRec.local_path;
      }
      return result;
    });
  });

  ipcMain.handle('messages:send', (_e, msg) => {
    const profile = db.getProfile();
    if (!profile) return null;
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
    if (msg.toUuid) db.setHiddenDM(msg.toUuid, false);
    wsServer.broadcast(message);
    return message;
  });

  ipcMain.handle('messages:broadcast', (_e, msg) => {
    const profile = db.getProfile();
    const content = String(msg.content || '').trim();
    if (!profile) return { ok: false, sent: 0 };

    const targetUuids = Array.from(new Set(msg.toUuids || [])).filter(uuid => uuid && uuid !== profile.uuid);
    if (!content || !targetUuids.length) return { ok: false, sent: 0 };

    const messages = targetUuids.map(toUuid => {
      const message = {
        id: crypto.randomUUID(),
        channel_id: null,
        private_chat_uuid: buildChatId(profile.uuid, toUuid),
        from_uuid: profile.uuid,
        content,
        type: 'text',
        reply_to: null,
        timestamp: Date.now(),
        edited: 0,
        deleted: 0,
        delivered: 0,
        read_by: [],
      };
      db.saveMessage(message);
      db.setHiddenDM(toUuid, false);
      wsServer.broadcast(message);
      return message;
    });

    return { ok: true, sent: messages.length, messages };
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

  ipcMain.handle('file:download', async (_e, srcPath) => {
    const fs = require('fs');
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

    const ext = path.extname(srcPath);
    const base = path.basename(srcPath, ext);
    let destPath = path.join(downloadsDir, path.basename(srcPath));
    let counter = 1;
    while (fs.existsSync(destPath)) {
      destPath = path.join(downloadsDir, `${base} (${counter})${ext}`);
      counter++;
    }
    try {
      fs.copyFileSync(srcPath, destPath);
      shell.showItemInFolder(destPath);
      return { ok: true, path: destPath };
    } catch (err) {
      console.error('[file:download]', err.message);
      shell.openPath(srcPath).catch(() => {});
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('audio:send', async (_e, { buffer, name, mimeType = 'audio/webm', chatType, chatId }) => {
    const profile = db.getProfile();
    if (!profile) return { ok: false };
    const fs = require('fs');
    const { app: electronApp } = require('electron');

    const buf = Buffer.from(buffer);
    const audioDir = path.join(electronApp.getPath('userData'), 'audio');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    const localPath = path.join(audioDir, name);
    fs.writeFileSync(localPath, buf);

    const messageId = crypto.randomUUID();
    const size = buf.length;
    const base64 = buf.toString('base64');

    const message = {
      id: messageId,
      channel_id: chatType === 'channel' ? chatId : null,
      private_chat_uuid: chatType === 'dm' ? buildChatId(profile.uuid, chatId) : null,
      from_uuid: profile.uuid,
      content: JSON.stringify({ name, size, mimeType, data: base64 }),
      type: 'audio',
      reply_to: null,
      timestamp: Date.now(),
      edited: 0,
      deleted: 0,
      delivered: 0,
      read_by: [],
    };
    db.saveMessage(message);
    db.saveFile({
      id: crypto.randomUUID(), message_id: messageId, original_name: name,
      local_path: localPath, size, mime_type: mimeType, sha256: '', timestamp: Date.now(),
    });
    wsServer.broadcast(message);
    return { ok: true };
  });
  ipcMain.handle('file:chooseAvatar', async () => {
    const win = windowManager.getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const fs = require('fs');
    const data = fs.readFileSync(result.filePaths[0]);
    const ext = path.extname(result.filePaths[0]).slice(1).toLowerCase() || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${data.toString('base64')}`;
  });

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
    // Default startWithWindows to true on first run (key not yet in DB)
    if (s.startWithWindows === undefined) {
      db.setSetting('startWithWindows', true);
      app.setLoginItemSettings({ openAtLogin: true });
    }
    return {
      soundEnabled: s.soundEnabled !== false,
      notificationsEnabled: s.notificationsEnabled !== false,
      downloadDir: s.downloadDir || path.join(os.homedir(), 'NeuroChat', 'Archivos'),
      startWithWindows: s.startWithWindows !== false,
      theme: s.theme || 'auto',
      discoveryTargets: s.discoveryTargets || DEFAULT_DISCOVERY_TARGETS,
      ...s,
    };
  });

  ipcMain.handle('settings:save', (_e, data) => {
    for (const [k, v] of Object.entries(data)) {
      db.setSetting(k, v);
      if (k === 'theme') {
        nativeTheme.themeSource = v === 'dark' ? 'dark' : v === 'light' ? 'light' : 'system';
      }
      if (k === 'discoveryTargets') {
        discovery.updateAnnounce(db.getProfile() || {});
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

  ipcMain.handle('app:flash', () => {
    const win = windowManager.getMainWindow();
    if (win && !win.isDestroyed()) {
      // Flash taskbar regardless of focus — new message must be visible even when app is open
      win.flashFrame(true);
      win.once('focus', () => win.flashFrame(false));
    }
    tray.notifyUnread(true);
    return { ok: true };
  });

  ipcMain.handle('app:setBadge', (_e, count, dataUrl) => {
    try {
      app.setBadgeCount(count); // macOS / Linux dock badge
    } catch {}
    const win = windowManager.getMainWindow();
    if (win && !win.isDestroyed()) {
      if (count > 0 && dataUrl) {
        try {
          const img = nativeImage.createFromDataURL(dataUrl);
          win.setOverlayIcon(img, `${count} mensajes no leídos`);
        } catch {}
      } else {
        try {
          win.setOverlayIcon(null, '');
        } catch {}
      }
    }
    // Clear tray unread indicator when badge goes to 0
    if (count === 0) tray.notifyUnread(false);
    return { ok: true };
  });

  ipcMain.handle('status:setMessage', (_e, message) => {
    const profile = db.getProfile();
    profile.status_message = String(message || '').slice(0, 100);
    db.saveProfile(profile);
    return { ok: true };
  });

  // ── DM conversation management ─────────────────────────────────────────────

  ipcMain.handle('dm:hide', (_e, peerUuid) => {
    db.setHiddenDM(peerUuid, true);
    return { ok: true };
  });

  ipcMain.handle('dm:unhide', (_e, peerUuid) => {
    db.setHiddenDM(peerUuid, false);
    return { ok: true };
  });

  ipcMain.handle('dm:delete', (_e, peerUuid) => {
    db.deleteDMMessages(peerUuid);
    db.setHiddenDM(peerUuid, true);
    return { ok: true };
  });

  // Deletes messages + removes user from DB (only valid for offline users)
  ipcMain.handle('user:delete', (_e, peerUuid) => {
    const isOnline = store.getOnlineUsers().some(u => u.uuid === peerUuid && u.isOnline !== false);
    if (isOnline) return { ok: false, reason: 'online' };
    store.drainQueue(peerUuid); // discard any pending outbound messages
    db.deleteDMMessages(peerUuid);
    db.deleteUser(peerUuid);
    return { ok: true };
  });

  ipcMain.handle('dm:hidden', () => db.getHiddenDMs());

  // ── Channel info & member management ──────────────────────────────────────

  ipcMain.handle('channels:info', (_e, channelId) => {
    const channel = db.getChannel(channelId);
    const profile = db.getProfile();
    const onlineUsers = store.getOnlineUsers();
    const onlineMap = new Map(onlineUsers.map(u => [u.uuid, u]));
    const allDbUsers = db.getAllUsers();

    // Build full user list: all DB users + online users not yet in DB, deduped
    const allUsersMap = new Map();
    if (profile) allUsersMap.set(profile.uuid, profile);
    allDbUsers.forEach(u => allUsersMap.set(u.uuid, u));
    onlineUsers.forEach(u => {
      if (!allUsersMap.has(u.uuid)) allUsersMap.set(u.uuid, u);
    });

    // Merge online status into every user
    const allUsers = Array.from(allUsersMap.values()).map(u => ({
      ...u,
      is_online: onlineMap.has(u.uuid) || (profile?.uuid === u.uuid) ? 1 : 0,
      status: onlineMap.get(u.uuid)?.status || u.status || 'offline',
    }));

    // Sort: self first, then online, then by name
    allUsers.sort((a, b) => {
      if (a.uuid === profile?.uuid) return -1;
      if (b.uuid === profile?.uuid) return 1;
      if (a.is_online !== b.is_online) return b.is_online - a.is_online;
      return (a.name || '').localeCompare(b.name || '');
    });

    const memberIds = new Set(db.getChannelMemberIds(channelId));
    const members = channel?.is_default ? allUsers : allUsers.filter(u => memberIds.has(u.uuid));
    const nonMembers = channel?.is_default ? [] : allUsers.filter(u => !memberIds.has(u.uuid));

    return { channel, members, nonMembers };
  });

  ipcMain.handle('channels:addMember', (_e, { channelId, userUuid }) => {
    const profile = db.getProfile();
    db.addChannelMember(channelId, userUuid, profile?.uuid || null);
    const channel = db.getChannel(channelId);
    if (channel) wsServer.broadcastChannelUpsert(channel, db.getChannelMemberIds(channelId));
    return { ok: true };
  });

  ipcMain.handle('channels:removeMember', (_e, { channelId, userUuid }) => {
    db.removeChannelMember(channelId, userUuid);
    const channel = db.getChannel(channelId);
    if (channel) wsServer.broadcastChannelUpsert(channel, db.getChannelMemberIds(channelId));
    return { ok: true };
  });

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

  // ── Updates ───────────────────────────────────────────────────────────────

  ipcMain.handle('update:check', () => require('./updater').checkForUpdates());
  ipcMain.handle('update:download', () => require('./updater').downloadUpdate());
  ipcMain.handle('update:install', () => require('./updater').installUpdate());

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('app:networkInfo', () => {
    return {
      ips: discovery.getLocalIPs(),
      ports: { udp: 45678, ws: 45679, file: 45680 },
      discoveryTargets: db.getAllSettings().discoveryTargets || '',
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
