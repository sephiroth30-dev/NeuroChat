'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC bridge to renderer (no direct Node.js access)
contextBridge.exposeInMainWorld('neurochat', {
  // Profile
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: data => ipcRenderer.invoke('profile:save', data),

  // Users
  getUsers: () => ipcRenderer.invoke('users:get'),

  // Channels
  getChannels: () => ipcRenderer.invoke('channels:get'),
  createChannel: data => ipcRenderer.invoke('channels:create', data),
  deleteChannel: id => ipcRenderer.invoke('channels:delete', id),

  // Messages
  getMessages: opts => ipcRenderer.invoke('messages:get', opts),
  sendMessage: msg => ipcRenderer.invoke('messages:send', msg),
  editMessage: (id, content) => ipcRenderer.invoke('messages:edit', id, content),
  deleteMessage: id => ipcRenderer.invoke('messages:delete', id),
  sendReaction: (msgId, emoji) => ipcRenderer.invoke('messages:react', msgId, emoji),
  pinMessage: (channelId, msgId) => ipcRenderer.invoke('messages:pin', channelId, msgId),
  unpinMessage: (channelId, msgId) => ipcRenderer.invoke('messages:unpin', channelId, msgId),
  getPinnedMessages: channelId => ipcRenderer.invoke('messages:pinned', channelId),

  // File transfer
  sendFile: opts => ipcRenderer.invoke('file:send', opts),
  acceptFile: transferId => ipcRenderer.invoke('file:accept', transferId),
  rejectFile: transferId => ipcRenderer.invoke('file:reject', transferId),
  openFile: localPath => ipcRenderer.invoke('file:open', localPath),
  chooseDownloadDir: () => ipcRenderer.invoke('file:chooseDir'),

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

  // Dev / seed
  seedUsers: () => ipcRenderer.invoke('debug:seed'),

  // Read receipts
  markRead: (messageId, senderUuid) => ipcRenderer.invoke('read:mark', { messageId, senderUuid }),

  // App badge (taskbar / dock)
  setBadge: (count, dataUrl) => ipcRenderer.invoke('app:setBadge', count, dataUrl),

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

  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),
  getNetworkInfo: () => ipcRenderer.invoke('app:networkInfo'),
});
