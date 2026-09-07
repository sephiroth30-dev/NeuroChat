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

  // Strip any inline base64 payload out of a message's content before it
  // crosses IPC. Older rows (pre-2.4.0) embed the whole file in `content`,
  // so a 20-image chat used to structured-clone tens of MB into the renderer
  // on EVERY reload. The renderer fetches the bytes on demand instead, via
  // 'message:getInlineData'.
  function stripInlineData(m) {
    if (m.type !== 'file' && m.type !== 'audio') return m;
    if (!m.content || m.content.indexOf('"data"') === -1) return m;
    try {
      const meta = JSON.parse(m.content);
      if (!meta || !meta.data) return m;
      delete meta.data;
      return { ...m, content: JSON.stringify(meta), hasInlineData: true };
    } catch {
      return m;
    }
  }

  ipcMain.handle('messages:get', (_e, opts) => {
    const msgs = db.getMessages(opts);
    const allUsers = db.getAllUsers();
    const myProfile = db.getProfile();
    const userMap = new Map(allUsers.map(u => [u.uuid, u]));
    if (myProfile) userMap.set(myProfile.uuid, myProfile);

    // One query each for the whole page instead of two per message
    const ids = msgs.map(m => m.id);
    const reactionsByMsg = db.getReactionsForMessages(ids);
    const filesByMsg = db.getFilesForMessages(ids);

    return msgs.map(m => {
      const sender = userMap.get(m.from_uuid) || {};
      const base = stripInlineData(m);
      const result = {
        ...base,
        sender_name: sender.name || 'Usuario',
        color: sender.color || '#4A9E8F',
        read_by: JSON.parse(m.read_by || '[]'),
        reactions: reactionsByMsg[m.id] || [],
      };
      if (m.type === 'file' || m.type === 'audio') {
        const fileRec = filesByMsg[m.id];
        if (fileRec) result.localPath = fileRec.local_path;
      }
      return result;
    });
  });

  // On-demand fetch of an inline base64 payload for a legacy message whose
  // bytes were never written to disk. Writes them out on first access so the
  // next load uses localPath (lazy migration — no bulk DB rewrite needed).
  ipcMain.handle('message:getInlineData', (_e, messageId) => {
    const row = db.getMessageById(messageId);
    if (!row || !row.content) return null;
    let meta;
    try {
      meta = JSON.parse(row.content);
    } catch {
      return null;
    }
    if (!meta?.data || !meta.name) return null;

    // Persist to disk once so this path isn't needed again
    try {
      const nodeFs = require('fs');
      const nodePath = require('path');
      const nodeCrypto = require('crypto');
      const isImg = meta.mimeType?.startsWith('image/');
      const subDir = row.type === 'audio' ? 'audio' : isImg ? 'images' : 'files';
      const fileDir = nodePath.join(app.getPath('userData'), subDir);
      nodeFs.mkdirSync(fileDir, { recursive: true });
      // meta.name is peer-supplied — sanitize, and namespace by message id so
      // two messages sharing a filename can't end up pointing at one file.
      const localPath = require('./fileNames').attachmentPath(fileDir, messageId, meta.name);
      if (!nodeFs.existsSync(localPath)) {
        nodeFs.writeFileSync(localPath, Buffer.from(meta.data, 'base64'));
      }
      if (!db.getFileByMsgId(messageId)) {
        db.saveFile({
          id: nodeCrypto.randomUUID(), message_id: messageId, original_name: meta.name,
          local_path: localPath, size: meta.size || 0, mime_type: meta.mimeType || '',
          sha256: '', timestamp: Date.now(),
        });
      }
      return { mimeType: meta.mimeType || '', data: meta.data, localPath };
    } catch (err) {
      console.warn('[message:getInlineData] no se pudo materializar:', err.message);
      return { mimeType: meta.mimeType || '', data: meta.data, localPath: null };
    }
  });

  // Batched read receipts: one IPC round trip and one DB transaction instead of
  // one per message. The WIRE protocol is unchanged — a READ_RECEIPT is still
  // sent per message id, so peers on older versions still light up their ticks.
  ipcMain.handle('messages:markReadBatch', (_e, { messages }) => {
    const profile = db.getProfile();
    if (!profile || !Array.isArray(messages) || !messages.length) return { ok: false };

    db.markReadBatch(messages.map(m => m.id), profile.uuid);

    const onlineUsers = store.getOnlineUsers();
    messages.forEach(({ id, fromUuid }) => {
      const peer = onlineUsers.find(u => u.uuid === fromUuid);
      if (!peer) return;
      wsClient.sendTo(peer, {
        type: 'READ_RECEIPT',
        messageId: id,
        readerUuid: profile.uuid,
      });
    });
    return { ok: true };
  });

  // Single enriched message — lets the renderer patch one row after an edit,
  // delete or reaction instead of re-reading the whole conversation.
  ipcMain.handle('messages:getOne', (_e, messageId) => {
    const row = db.getMessageById(messageId);
    if (!row) return null;
    const sender =
      db.getAllUsers().find(u => u.uuid === row.from_uuid) ||
      (db.getProfile()?.uuid === row.from_uuid ? db.getProfile() : null) ||
      {};
    const result = {
      ...stripInlineData(row),
      sender_name: sender.name || 'Usuario',
      color: sender.color || '#4A9E8F',
      read_by: JSON.parse(row.read_by || '[]'),
      reactions: db.getReactions(row.id),
    };
    if (row.type === 'file' || row.type === 'audio') {
      const fileRec = db.getFileByMsgId(row.id);
      if (fileRec) result.localPath = fileRec.local_path;
    }
    return result;
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
    const transferId = crypto.randomUUID(); // generated here so file record can be saved immediately

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

    // Save file record BEFORE the async transfer so sender sees the image immediately,
    // even if the transfer to the peer fails or the peer is offline.
    db.saveFile({
      id: transferId,
      message_id: messageId,
      original_name: opts.name,
      local_path: opts.filePath,
      size: opts.size,
      mime_type: opts.mimeType,
      sha256: '',
      timestamp: Date.now(),
    });

    // Initiate transfer (computes SHA-256 hash, sends FILE_OFFER via WebSocket).
    // Uses the pre-generated transferId so the file record and offer share the same UUID.
    try {
      const { hash } = await fileTransfer.sendFile({ ...opts, messageId, transferId });
      db.updateFileSha256(transferId, hash);
    } catch (err) {
      console.warn('[file:send] transfer error:', err.message);
    }

    wsServer.broadcast(message);
    return { ok: true };
  });

  ipcMain.handle('file:accept', (_e, transferId) => fileTransfer.accept(transferId));
  ipcMain.handle('file:reject', (_e, transferId) => fileTransfer.reject(transferId));
  ipcMain.handle('file:open', async (_e, localPath) => {
    const fs = require('fs');
    if (!localPath || !fs.existsSync(localPath)) return { ok: false, error: 'Archivo no encontrado' };
    const result = await shell.openPath(localPath);
    if (result) {
      // shell.openPath failed (e.g. default app broken) — reveal in Explorer/Finder as fallback
      console.warn('[file:open] openPath failed:', result, '— falling back to showItemInFolder');
      shell.showItemInFolder(localPath);
      return { ok: false, fallback: true, error: result };
    }
    return { ok: true };
  });
  ipcMain.handle('url:open', (_e, url) => {
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return shell.openExternal(full);
  });

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

  // Save a clipboard image (ArrayBuffer) to a temp file on disk and return its path
  ipcMain.handle('file:saveClipboard', async (_e, { buffer, name, mimeType }) => {
    const fs = require('fs');
    const { app: electronApp } = require('electron');
    const buf = Buffer.from(buffer);
    const clipDir = path.join(electronApp.getPath('userData'), 'clipboard');
    if (!fs.existsSync(clipDir)) fs.mkdirSync(clipDir, { recursive: true });
    const filePath = path.join(clipDir, name);
    fs.writeFileSync(filePath, buf);
    return { ok: true, filePath, size: buf.length };
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
  // Inline image send — embeds image as base64 so recipient sees thumbnail immediately
  // without a P2P file transfer / accept dialog (mirrors the audio:send pattern).
  ipcMain.handle('image:sendInline', async (_e, { filePath, name, size, mimeType, chatType, chatId }) => {
    const fs = require('fs');
    const profile = db.getProfile();
    if (!profile) return { ok: false };

    const buf = fs.readFileSync(filePath);
    const base64 = buf.toString('base64');
    const messageId = crypto.randomUUID();

    const meta = { name, size: buf.length, mimeType };

    // The base64 goes on the wire, but NOT into our own DB: storing it in
    // messages.content made every later chat load ship megabytes over IPC.
    // We keep only the metadata locally and point at the file on disk.
    const message = {
      id: messageId,
      channel_id: chatType === 'channel' ? chatId : null,
      private_chat_uuid: chatType === 'dm' ? buildChatId(profile.uuid, chatId) : null,
      from_uuid: profile.uuid,
      content: JSON.stringify(meta),
      type: 'file',
      reply_to: null,
      timestamp: Date.now(),
      edited: 0,
      deleted: 0,
      delivered: 0,
      read_by: [],
    };
    db.saveMessage(message);

    // Copy into userData so the message keeps rendering even if the user
    // moves or deletes the original file they picked.
    let localPath = filePath;
    try {
      const isImg = mimeType?.startsWith('image/');
      const subDir = isImg ? 'images' : 'files';
      const fileDir = path.join(app.getPath('userData'), subDir);
      fs.mkdirSync(fileDir, { recursive: true });
      // Sanitize: a ':' or '?' in the picked filename would throw on Windows
      const dest = require('./fileNames').attachmentPath(fileDir, messageId, name);
      fs.writeFileSync(dest, buf);
      localPath = dest;
    } catch (err) {
      console.warn('[image:sendInline] no se pudo copiar a userData:', err.message);
    }

    db.saveFile({
      id: crypto.randomUUID(), message_id: messageId, original_name: name,
      local_path: localPath, size: buf.length, mime_type: mimeType,
      sha256: '', timestamp: Date.now(),
    });

    // Broadcast carries the payload; the persisted record above does not.
    wsServer.broadcast({ ...message, content: JSON.stringify({ ...meta, data: base64 }) });
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
      remoteSupportMode: s.remoteSupportMode || 'ask',
      remoteDomain: process.platform === 'win32'
        ? (process.env.USERDOMAIN && process.env.USERDOMAIN !== process.env.COMPUTERNAME ? process.env.USERDOMAIN : '')
        : '',
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
