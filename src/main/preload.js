'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC bridge to renderer (no direct Node.js access)
contextBridge.exposeInMainWorld('neurochat', {
  // Profile
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: data => ipcRenderer.invoke('profile:save', data),

  // Users
  getUsers: () => ipcRenderer.invoke('users:get'),
  getLastDMActivity: () => ipcRenderer.invoke('users:lastActivity'),

  // Channels
  getChannels: () => ipcRenderer.invoke('channels:get'),
  createChannel: data => ipcRenderer.invoke('channels:create', data),
  deleteChannel: id => ipcRenderer.invoke('channels:delete', id),

  // Messages
  getMessages: opts => ipcRenderer.invoke('messages:get', opts),
  sendMessage: msg => ipcRenderer.invoke('messages:send', msg),
  sendBroadcast: msg => ipcRenderer.invoke('messages:broadcast', msg),
  editMessage: (id, content) => ipcRenderer.invoke('messages:edit', id, content),
  deleteMessage: id => ipcRenderer.invoke('messages:delete', id),
  sendReaction: (msgId, emoji) => ipcRenderer.invoke('messages:react', msgId, emoji),
  pinMessage: (channelId, msgId) => ipcRenderer.invoke('messages:pin', channelId, msgId),
  unpinMessage: (channelId, msgId) => ipcRenderer.invoke('messages:unpin', channelId, msgId),
  getPinnedMessages: channelId => ipcRenderer.invoke('messages:pinned', channelId),

  // File transfer
  sendFile: opts => ipcRenderer.invoke('file:send', opts),
  sendInlineImage: opts => ipcRenderer.invoke('image:sendInline', opts),
  acceptFile: transferId => ipcRenderer.invoke('file:accept', transferId),
  rejectFile: transferId => ipcRenderer.invoke('file:reject', transferId),
  openFile: localPath => ipcRenderer.invoke('file:open', localPath),
  downloadFile: localPath => ipcRenderer.invoke('file:download', localPath),
  sendAudio: opts => ipcRenderer.invoke('audio:send', opts),
  saveClipboardImage: opts => ipcRenderer.invoke('file:saveClipboard', opts),
  chooseDownloadDir: () => ipcRenderer.invoke('file:chooseDir'),
  chooseAvatar: () => ipcRenderer.invoke('file:chooseAvatar'),

  // Search
  search: (query, opts) => ipcRenderer.invoke('search:query', query, opts),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: data => ipcRenderer.invoke('settings:save', data),
  setStartupWithWindows: enable => ipcRenderer.invoke('settings:startup', enable),

  // Diagnostics
  runDiagnostics: () => ipcRenderer.invoke('diagnostics:run'),
  addFirewallRules: () => ipcRenderer.invoke('diagnostics:firewall'),

  // Status
  setStatus: status => ipcRenderer.invoke('status:set', status),
  setStatusMessage: message => ipcRenderer.invoke('status:setMessage', message),

  // DM conversation management
  hideDM: peerUuid => ipcRenderer.invoke('dm:hide', peerUuid),
  unhideDM: peerUuid => ipcRenderer.invoke('dm:unhide', peerUuid),
  deleteDMConversation: peerUuid => ipcRenderer.invoke('dm:delete', peerUuid),
  deleteUser: peerUuid => ipcRenderer.invoke('user:delete', peerUuid),
  getHiddenDMs: () => ipcRenderer.invoke('dm:hidden'),

  // Channel info & member management
  getChannelInfo: channelId => ipcRenderer.invoke('channels:info', channelId),
  addChannelMember: (channelId, userUuid) => ipcRenderer.invoke('channels:addMember', { channelId, userUuid }),
  removeChannelMember: (channelId, userUuid) => ipcRenderer.invoke('channels:removeMember', { channelId, userUuid }),

  // Read receipts
  markRead: (messageId, senderUuid) => ipcRenderer.invoke('read:mark', { messageId, senderUuid }),

  // App badge (taskbar / dock)
  setBadge: (count, dataUrl) => ipcRenderer.invoke('app:setBadge', count, dataUrl),
  flashWindow: () => ipcRenderer.invoke('app:flash'),

  // Typing indicator
  sendTyping: opts => ipcRenderer.invoke('typing:send', opts),

  // Events from main → renderer
  on: (channel, fn) => {
    const allowed = [
      'users:updated',
      'message:incoming',
      'message:edited',
      'message:deleted',
      'message:reaction',
      'message:read',
      'file:offer',
      'file:progress',
      'file:complete',
      'file:rejected',
      'file:error',
      'typing:incoming',
      'theme:changed',
      'channel:synced',
      'notification:incoming',
      'notification:navigate',
      'status:set-from-tray',
      'system:idle',
      'system:active',
      'update:status',
      'remote:incoming-request',
      'remote:session-accepted',
      'remote:session-rejected',
      'remote:session-ended',
    ];
    if (!allowed.includes(channel)) return;
    const listener = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // One-time listener
  once: (channel, fn) => {
    ipcRenderer.once(channel, (_e, ...args) => fn(...args));
  },

  // Remote desktop
  requestRemote: peerUuid => ipcRenderer.invoke('remote:request', { peerUuid }),
  acceptRemote: (sessionId, fromUuid) => ipcRenderer.invoke('remote:accept', { sessionId, fromUuid }),
  rejectRemote: (sessionId, fromUuid) => ipcRenderer.invoke('remote:reject', { sessionId, fromUuid }),
  endRemote: sessionId => ipcRenderer.invoke('remote:end', { sessionId }),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),
  getNetworkInfo: () => ipcRenderer.invoke('app:networkInfo'),

  // Open URL in system browser
  openUrl: url => ipcRenderer.invoke('url:open', url),
});
