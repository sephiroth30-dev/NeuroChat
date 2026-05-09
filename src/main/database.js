'use strict';

const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3');

const _DB_VERSION = 2;
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
    const q = before
      ? `SELECT * FROM messages WHERE private_chat_uuid IN (?,?) AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`
      : `SELECT * FROM messages WHERE private_chat_uuid IN (?,?) ORDER BY timestamp DESC LIMIT ?`;
    const rows = before
      ? db.prepare(q).all(privateChatUuid, myUuid + ':' + privateChatUuid, before, limit)
      : db.prepare(q).all(privateChatUuid, myUuid + ':' + privateChatUuid, limit);
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

// ── Seed test data ────────────────────────────────────────────────────────────

function seedTestUsers() {
  const existing = db.prepare("SELECT COUNT(*) as c FROM users WHERE uuid LIKE 'seed-%'").get();
  if (existing.c > 0) return { already: true };

  const now = Date.now();

  const users = [
    {
      uuid: 'seed-u1',
      name: 'Dra. Ana Martínez',
      color: '#5B8DD9',
      status: 'available',
      is_online: 1,
      last_seen: now,
    },
    {
      uuid: 'seed-u2',
      name: 'Dr. Carlos Ruiz',
      color: '#9B59B6',
      status: 'away',
      is_online: 1,
      last_seen: now - 900000,
    },
    {
      uuid: 'seed-u3',
      name: 'Lic. María García',
      color: '#E67E22',
      status: 'available',
      is_online: 1,
      last_seen: now,
    },
    {
      uuid: 'seed-u4',
      name: 'Psic. Juan López',
      color: '#E74C3C',
      status: 'dnd',
      is_online: 1,
      last_seen: now - 300000,
    },
    {
      uuid: 'seed-u5',
      name: 'Enf. Laura Torres',
      color: '#1ABC9C',
      status: 'offline',
      is_online: 0,
      last_seen: now - 7200000,
    },
  ];

  const channels = [
    {
      id: 'seed-ch1',
      name: 'general',
      description: 'Canal general del equipo',
      created_by: 'seed-u1',
      created_at: now - 604800000,
      is_default: 1,
    },
    {
      id: 'seed-ch2',
      name: 'clínica',
      description: 'Casos y discusiones clínicas',
      created_by: 'seed-u1',
      created_at: now - 432000000,
      is_default: 0,
    },
    {
      id: 'seed-ch3',
      name: 'administración',
      description: 'Temas administrativos y agenda',
      created_by: 'seed-u3',
      created_at: now - 259200000,
      is_default: 0,
    },
  ];

  const messages = [
    {
      id: 'seed-m1',
      ch: 'seed-ch1',
      from: 'seed-u1',
      content: '¡Buenos días equipo! ¿Cómo van con los reportes del mes?',
      ts: now - 7200000,
    },
    {
      id: 'seed-m2',
      ch: 'seed-ch1',
      from: 'seed-u2',
      content: 'Todo bien, casi terminamos. ¿Reunión a las 3pm hoy?',
      ts: now - 6900000,
    },
    {
      id: 'seed-m3',
      ch: 'seed-ch1',
      from: 'seed-u3',
      content: 'Confirmo asistencia.',
      ts: now - 6600000,
    },
    {
      id: 'seed-m4',
      ch: 'seed-ch1',
      from: 'seed-u4',
      content: 'Yo también, llegaré 5 minutos tarde.',
      ts: now - 6300000,
    },
    {
      id: 'seed-m5',
      ch: 'seed-ch2',
      from: 'seed-u4',
      content: 'Tengo un caso interesante para la reunión clínica de mañana.',
      ts: now - 3600000,
    },
    {
      id: 'seed-m6',
      ch: 'seed-ch2',
      from: 'seed-u1',
      content: 'Perfecto, lo agendamos. ¿Puedes enviar el resumen antes de las 5pm?',
      ts: now - 3300000,
    },
    {
      id: 'seed-m7',
      ch: 'seed-ch2',
      from: 'seed-u4',
      content: 'Claro, lo envío ahora.',
      ts: now - 3000000,
    },
    {
      id: 'seed-m8',
      ch: 'seed-ch3',
      from: 'seed-u3',
      content: 'Recordatorio: mañana hay capacitación a las 9am en sala B.',
      ts: now - 1800000,
    },
    {
      id: 'seed-m9',
      ch: 'seed-ch3',
      from: 'seed-u2',
      content: '¿Hay que llevar algo específico?',
      ts: now - 1500000,
    },
    {
      id: 'seed-m10',
      ch: 'seed-ch3',
      from: 'seed-u3',
      content: 'Solo laptop y libreta. El material lo compartimos digital.',
      ts: now - 1200000,
    },
  ];

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (uuid, name, avatar, color, last_seen, is_online, status)
    VALUES (@uuid, @name, NULL, @color, @last_seen, @is_online, @status)
  `);
  const insertCh = db.prepare(`
    INSERT OR IGNORE INTO channels (id, name, description, created_by, created_at, is_default)
    VALUES (@id, @name, @description, @created_by, @created_at, @is_default)
  `);
  const insertMsg = db.prepare(`
    INSERT OR IGNORE INTO messages
      (id, channel_id, private_chat_uuid, from_uuid, content, type, reply_to, timestamp, edited, deleted, delivered, read_by)
    VALUES
      (@id, @channel_id, NULL, @from_uuid, @content, 'text', NULL, @timestamp, 0, 0, 1, '[]')
  `);

  users.forEach(u => insertUser.run(u));
  channels.forEach(c => insertCh.run(c));
  messages.forEach(m =>
    insertMsg.run({
      id: m.id,
      channel_id: m.ch,
      from_uuid: m.from,
      content: m.content,
      timestamp: m.ts,
    })
  );

  return { seeded: users.length };
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
  seedTestUsers,
};
