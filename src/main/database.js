'use strict';

const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3');

const _DB_VERSION = 3;
let db = null;

function getDbPath() {
  return path.join(app.getPath('userData'), 'neurochat.db');
}

function initialize() {
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema();
  runMigrations();
  seedDefaultChannels();
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS my_profile (
      uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      color TEXT DEFAULT '#4A9E8F',
      status TEXT DEFAULT 'available',
      status_message TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS users (
      uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      color TEXT,
      last_seen INTEGER,
      is_online INTEGER DEFAULT 0,
      status TEXT DEFAULT 'available'
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT,
      created_at INTEGER,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      private_chat_uuid TEXT,
      from_uuid TEXT NOT NULL,
      content TEXT,
      type TEXT DEFAULT 'text',
      reply_to TEXT,
      timestamp INTEGER NOT NULL,
      edited INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      delivered INTEGER DEFAULT 0,
      read_by TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL,
      user_uuid TEXT NOT NULL,
      emoji TEXT NOT NULL,
      PRIMARY KEY (message_id, user_uuid)
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      original_name TEXT,
      local_path TEXT,
      size INTEGER,
      mime_type TEXT,
      sha256 TEXT,
      timestamp INTEGER
    );

    CREATE TABLE IF NOT EXISTS pinned_messages (
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      pinned_by TEXT,
      pinned_at INTEGER,
      PRIMARY KEY (channel_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(private_chat_uuid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_uuid);
    CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_files_msg ON files(message_id);
    CREATE INDEX IF NOT EXISTS idx_pinned_channel ON pinned_messages(channel_id);
  `);
}

function runMigrations() {
  const row = db.prepare('SELECT version FROM schema_version').get();
  const current = row ? row.version : 0;

  if (current < 1) {
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(1);
  }

  if (current < 2) {
    try {
      db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'available'");
    } catch {}
    try {
      db.exec("ALTER TABLE my_profile ADD COLUMN status_message TEXT DEFAULT ''");
    } catch {}
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(2);
  }

  if (current < 3) {
    // Remove demo seed users and their messages; real channels (seed-ch*) are kept
    db.exec("DELETE FROM messages WHERE from_uuid LIKE 'seed-u%'");
    db.exec("DELETE FROM messages WHERE private_chat_uuid LIKE '%seed-u%'");
    db.exec("DELETE FROM users WHERE uuid LIKE 'seed-u%'");
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(3);
  }
}

// ── Profile ──────────────────────────────────────────────────────────────────

function getProfile() {
  return db.prepare('SELECT * FROM my_profile LIMIT 1').get() || null;
}

function saveProfile(profile) {
  db.prepare(
    `
    INSERT INTO my_profile (uuid, name, avatar, color, status, status_message)
    VALUES (@uuid, @name, @avatar, @color, @status, @status_message)
    ON CONFLICT(uuid) DO UPDATE SET
      name = excluded.name,
      avatar = excluded.avatar,
      color = excluded.color,
      status = excluded.status,
      status_message = excluded.status_message
  `
  ).run({ status_message: '', ...profile });
}

// ── Users ─────────────────────────────────────────────────────────────────────

function upsertUser(user) {
  db.prepare(
    `
    INSERT INTO users (uuid, name, avatar, color, last_seen, is_online, status)
    VALUES (@uuid, @name, @avatar, @color, @last_seen, @is_online, @status)
    ON CONFLICT(uuid) DO UPDATE SET
      name = excluded.name,
      avatar = excluded.avatar,
      color = excluded.color,
      last_seen = excluded.last_seen,
      is_online = excluded.is_online,
      status = excluded.status
  `
  ).run({ status: 'available', ...user });
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY name').all();
}

function setUserOffline(uuid) {
  db.prepare('UPDATE users SET is_online = 0 WHERE uuid = ?').run(uuid);
}

function setAllOffline() {
  db.prepare('UPDATE users SET is_online = 0').run();
}

// ── Channels ──────────────────────────────────────────────────────────────────

function getChannels() {
  return db.prepare('SELECT * FROM channels ORDER BY is_default DESC, name').all();
}

function getChannel(id) {
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
}

function upsertChannel(channel) {
  db.prepare(
    `
    INSERT INTO channels (id, name, description, created_by, created_at, is_default)
    VALUES (@id, @name, @description, @created_by, @created_at, @is_default)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description
  `
  ).run(channel);
}

function deleteChannel(id) {
  db.prepare('DELETE FROM channels WHERE id = ? AND is_default = 0').run(id);
}

// ── Messages ──────────────────────────────────────────────────────────────────

function getMessages({ channelId, privateChatUuid, limit = 50, before = null }) {
  if (channelId) {
    const q = before
      ? 'SELECT * FROM messages WHERE channel_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM messages WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?';
    const rows = before
      ? db.prepare(q).all(channelId, before, limit)
      : db.prepare(q).all(channelId, limit);
    return rows.reverse();
  }
  if (privateChatUuid) {
    const myUuid = getProfile()?.uuid;
    const normalizedId = [myUuid, privateChatUuid].sort().join(':');
    const q = before
      ? `SELECT * FROM messages WHERE private_chat_uuid = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`
      : `SELECT * FROM messages WHERE private_chat_uuid = ? ORDER BY timestamp DESC LIMIT ?`;
    const rows = before
      ? db.prepare(q).all(normalizedId, before, limit)
      : db.prepare(q).all(normalizedId, limit);
    return rows.reverse();
  }
  return [];
}

function saveMessage(msg) {
  db.prepare(
    `
    INSERT INTO messages (id, channel_id, private_chat_uuid, from_uuid, content, type, reply_to, timestamp, edited, deleted, delivered, read_by)
    VALUES (@id, @channel_id, @private_chat_uuid, @from_uuid, @content, @type, @reply_to, @timestamp, @edited, @deleted, @delivered, @read_by)
    ON CONFLICT(id) DO NOTHING
  `
  ).run({
    ...msg,
    read_by: JSON.stringify(msg.read_by || []),
  });
}

function editMessage(id, content) {
  db.prepare('UPDATE messages SET content = ?, edited = 1 WHERE id = ?').run(content, id);
}

function deleteMessage(id) {
  db.prepare('UPDATE messages SET deleted = 1, content = NULL WHERE id = ?').run(id);
}

function markDelivered(id) {
  db.prepare('UPDATE messages SET delivered = 1 WHERE id = ?').run(id);
}

function markRead(id, uuid) {
  const row = db.prepare('SELECT read_by FROM messages WHERE id = ?').get(id);
  if (!row) return;
  const readBy = JSON.parse(row.read_by || '[]');
  if (!readBy.includes(uuid)) {
    readBy.push(uuid);
    db.prepare('UPDATE messages SET read_by = ? WHERE id = ?').run(JSON.stringify(readBy), id);
  }
}

// ── Reactions ─────────────────────────────────────────────────────────────────

function getReactions(messageId) {
  return db.prepare('SELECT * FROM reactions WHERE message_id = ?').all(messageId);
}

function upsertReaction(messageId, userUuid, emoji) {
  db.prepare(
    `
    INSERT INTO reactions (message_id, user_uuid, emoji)
    VALUES (?, ?, ?)
    ON CONFLICT(message_id, user_uuid) DO UPDATE SET emoji = excluded.emoji
  `
  ).run(messageId, userUuid, emoji);
}

function removeReaction(messageId, userUuid) {
  db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_uuid = ?').run(
    messageId,
    userUuid
  );
}

// ── Files ─────────────────────────────────────────────────────────────────────

function saveFile(file) {
  db.prepare(
    `
    INSERT INTO files (id, message_id, original_name, local_path, size, mime_type, sha256, timestamp)
    VALUES (@id, @message_id, @original_name, @local_path, @size, @mime_type, @sha256, @timestamp)
    ON CONFLICT(id) DO NOTHING
  `
  ).run(file);
}

function getFile(id) {
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id);
}

function getFileByMsgId(messageId) {
  return db.prepare('SELECT * FROM files WHERE message_id = ?').get(messageId);
}

// ── Pinned messages ───────────────────────────────────────────────────────────

function pinMessage(channelId, messageId, pinnedBy) {
  db.prepare(
    `
    INSERT OR IGNORE INTO pinned_messages (channel_id, message_id, pinned_by, pinned_at)
    VALUES (?, ?, ?, ?)
  `
  ).run(channelId, messageId, pinnedBy, Date.now());
}

function unpinMessage(channelId, messageId) {
  db.prepare('DELETE FROM pinned_messages WHERE channel_id = ? AND message_id = ?').run(
    channelId,
    messageId
  );
}

function getPinnedMessages(channelId) {
  return db
    .prepare(
      `
    SELECT pm.*, m.content, m.from_uuid, m.timestamp as msg_ts
    FROM pinned_messages pm
    LEFT JOIN messages m ON m.id = pm.message_id
    WHERE pm.channel_id = ?
    ORDER BY pm.pinned_at DESC
  `
    )
    .all(channelId);
}

// ── Settings ──────────────────────────────────────────────────────────────────

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

function setSetting(key, value) {
  db.prepare(
    `
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `
  ).run(key, JSON.stringify(value));
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
}

// ── Search ────────────────────────────────────────────────────────────────────

function searchMessages(query, opts = {}) {
  const term = `%${query}%`;
  let sql = `SELECT * FROM messages WHERE deleted = 0 AND content LIKE ? `;
  const params = [term];

  if (opts.channelId) {
    sql += 'AND channel_id = ? ';
    params.push(opts.channelId);
  }
  if (opts.privateChatUuid) {
    sql += 'AND private_chat_uuid = ? ';
    params.push(opts.privateChatUuid);
  }

  sql += 'ORDER BY timestamp DESC LIMIT 50';
  return db.prepare(sql).all(...params);
}

// ── Default channels seed (runs on every init, idempotent) ───────────────────

function seedDefaultChannels() {
  const existing = db.prepare('SELECT COUNT(*) as c FROM channels').get();
  if (existing.c > 0) return;

  const now = Date.now();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO channels (id, name, description, created_by, created_at, is_default)
    VALUES (@id, @name, @description, NULL, @created_at, @is_default)
  `);
  insert.run({ id: 'ch-general', name: 'general', description: 'Canal general del equipo', created_at: now, is_default: 1 });
  insert.run({ id: 'ch-clinica', name: 'clínica', description: 'Casos y discusiones clínicas', created_at: now, is_default: 0 });
  insert.run({ id: 'ch-admin', name: 'administración', description: 'Temas administrativos y agenda', created_at: now, is_default: 0 });
}

// ── DM conversation management ────────────────────────────────────────────────

function deleteDMMessages(peerUuid) {
  const myUuid = getProfile()?.uuid;
  if (!myUuid) return;
  const chatId = [myUuid, peerUuid].sort().join(':');
  db.prepare("DELETE FROM messages WHERE private_chat_uuid = ?").run(chatId);
}

function getHiddenDMs() {
  return getSetting('hidden_dms') || [];
}

function setHiddenDM(peerUuid, hidden) {
  const list = getHiddenDMs();
  const next = hidden
    ? [...new Set([...list, peerUuid])]
    : list.filter(id => id !== peerUuid);
  setSetting('hidden_dms', next);
}

// ── Misc ──────────────────────────────────────────────────────────────────────

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initialize,
  close,
  getDbPath,
  getProfile,
  saveProfile,
  upsertUser,
  getAllUsers,
  setUserOffline,
  setAllOffline,
  getChannels,
  getChannel,
  upsertChannel,
  deleteChannel,
  getMessages,
  saveMessage,
  editMessage,
  deleteMessage,
  markDelivered,
  markRead,
  getReactions,
  upsertReaction,
  removeReaction,
  saveFile,
  getFile,
  getFileByMsgId,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  getSetting,
  setSetting,
  getAllSettings,
  searchMessages,
  deleteDMMessages,
  getHiddenDMs,
  setHiddenDM,
};
