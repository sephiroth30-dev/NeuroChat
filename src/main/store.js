'use strict';

// In-memory state — users online, pending queues, active transfers
const state = {
  onlineUsers: new Map(), // uuid → { uuid, name, avatar, color, status, ip, wsPort, lastSeen }
  channels: new Map(), // id → channel object
  pendingMessages: new Map(), // uuid → [messages] — queued while user is offline
  activeTransfers: new Map(), // transferId → transfer state
};

function setUserOnline(user) {
  state.onlineUsers.set(user.uuid, { ...user, lastSeen: Date.now() });
}

function setUserOffline(uuid) {
  const u = state.onlineUsers.get(uuid);
  if (u) {
    state.onlineUsers.set(uuid, { ...u, status: 'offline', isOnline: false, is_online: 0 });
  }
}

function removeUser(uuid) {
  state.onlineUsers.delete(uuid);
}

function getOnlineUsers() {
  return Array.from(state.onlineUsers.values());
}

function getUser(uuid) {
  return state.onlineUsers.get(uuid) || null;
}

function touchUser(uuid) {
  const u = state.onlineUsers.get(uuid);
  if (u) u.lastSeen = Date.now();
}

function queueMessage(targetUuid, message) {
  if (!state.pendingMessages.has(targetUuid)) {
    state.pendingMessages.set(targetUuid, []);
  }
  state.pendingMessages.get(targetUuid).push(message);
}

function drainQueue(targetUuid) {
  const msgs = state.pendingMessages.get(targetUuid) || [];
  state.pendingMessages.delete(targetUuid);
  return msgs;
}

function setTransfer(id, data) {
  state.activeTransfers.set(id, data);
}

function getTransfer(id) {
  return state.activeTransfers.get(id);
}

function removeTransfer(id) {
  state.activeTransfers.delete(id);
}

module.exports = {
  setUserOnline,
  setUserOffline,
  removeUser,
  getOnlineUsers,
  getUser,
  touchUser,
  queueMessage,
  drainQueue,
  setTransfer,
  getTransfer,
  removeTransfer,
};
