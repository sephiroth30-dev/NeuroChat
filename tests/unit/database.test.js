'use strict';

// better-sqlite3 is a native module compiled for Electron's Node ABI.
// We mock it so these tests run on any Node.js version without recompilation.

jest.mock('better-sqlite3');
const Database = require('better-sqlite3');

let mockStmt, mockDb, db;

beforeEach(() => {
  jest.resetModules();

  mockStmt = {
    run: jest.fn(() => ({ changes: 1 })),
    // Default null — seedDefaultChannels handles null via (existing?.c ?? 0).
    get: jest.fn(() => null),
    all: jest.fn(() => []),
  };
  mockDb = {
    pragma: jest.fn(),
    exec: jest.fn(),
    prepare: jest.fn(() => mockStmt),
    close: jest.fn(),
    transaction: jest.fn(fn => (...args) => fn(...args)),
  };
  Database.mockImplementation(() => mockDb);

  jest.mock('better-sqlite3');
  require('better-sqlite3').mockImplementation(() => mockDb);

  db = require('../../src/main/database');
  db.initialize();
});

afterEach(() => {
  db.close();
});

// ── initialize ────────────────────────────────────────────────────────────────

describe('initialize', () => {
  test('runs PRAGMA and CREATE TABLE statements', () => {
    expect(mockDb.pragma).toHaveBeenCalledWith(expect.stringContaining('WAL'));
    expect(mockDb.exec).toHaveBeenCalled();
    const execSql = mockDb.exec.mock.calls.map(([s]) => s).join('\n');
    expect(execSql).toMatch(/CREATE TABLE IF NOT EXISTS messages/i);
    expect(execSql).toMatch(/CREATE TABLE IF NOT EXISTS users/i);
    expect(execSql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });
});

// ── Profile ───────────────────────────────────────────────────────────────────

describe('profile', () => {
  test('getProfile returns null when DB is empty', () => {
    mockStmt.get.mockReturnValue(undefined);
    expect(db.getProfile()).toBeNull();
  });

  test('getProfile returns the row from DB', () => {
    const row = { uuid: 'u1', name: 'Ana', status: 'available' };
    mockStmt.get.mockReturnValue(row);
    expect(db.getProfile()).toEqual(row);
  });

  test('saveProfile prepares INSERT … ON CONFLICT … UPDATE', () => {
    db.saveProfile({ uuid: 'u1', name: 'Ana', avatar: null, color: '#4A9E8F', status: 'available', status_message: '' });
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const profileSql = sqls.find(s => /INSERT INTO my_profile/i.test(s));
    expect(profileSql).toMatch(/ON CONFLICT.*DO UPDATE/is);
  });
});

// ── Channels ──────────────────────────────────────────────────────────────────

describe('channels', () => {
  test('getChannels returns rows from DB', () => {
    mockStmt.all.mockReturnValue([{ id: 'ch-1', name: 'General' }]);
    expect(db.getChannels()).toHaveLength(1);
  });

  test('upsertChannel uses INSERT … ON CONFLICT', () => {
    db.upsertChannel({ id: 'ch-1', name: 'General', description: null, created_by: 'u1', created_at: 1000, is_default: 1 });
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /INSERT INTO channels/i.test(s));
    expect(sql).toMatch(/ON CONFLICT/i);
  });

  test('deleteChannel restricts to is_default = 0', () => {
    db.deleteChannel('ch-1');
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /DELETE FROM channels/i.test(s));
    expect(sql).toMatch(/DELETE FROM channels WHERE id = \? AND is_default = 0/i);
  });
});

// ── Messages ──────────────────────────────────────────────────────────────────

describe('messages', () => {
  test('saveMessage serializes read_by array to JSON string', () => {
    db.saveMessage({
      id: 'm1', channel_id: 'ch-1', private_chat_uuid: null, from_uuid: 'u1',
      content: 'Hola', type: 'text', reply_to: null, timestamp: 1000,
      edited: 0, deleted: 0, delivered: 0, read_by: ['u2', 'u3'],
    });
    const callArg = mockStmt.run.mock.calls.at(-1)[0];
    expect(callArg.read_by).toBe('["u2","u3"]');
  });

  test('saveMessage uses ON CONFLICT DO NOTHING (idempotent)', () => {
    db.saveMessage({
      id: 'm1', channel_id: 'ch-1', private_chat_uuid: null, from_uuid: 'u1',
      content: 'Hola', type: 'text', reply_to: null, timestamp: 1000,
      edited: 0, deleted: 0, delivered: 0, read_by: [],
    });
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /INSERT INTO messages/i.test(s));
    expect(sql).toMatch(/ON CONFLICT.*DO NOTHING/is);
  });

  test('editMessage sets edited = 1', () => {
    db.editMessage('m1', 'Nuevo contenido');
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /UPDATE messages SET content/i.test(s));
    expect(sql).toMatch(/edited = 1/i);
  });

  test('deleteMessage is a soft-delete (deleted = 1, content = NULL)', () => {
    db.deleteMessage('m1');
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /UPDATE messages SET deleted/i.test(s));
    expect(sql).toMatch(/deleted = 1/i);
    expect(sql).toMatch(/content = NULL/i);
  });

  test('markDelivered sets delivered = 1', () => {
    db.markDelivered('m1');
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /UPDATE messages SET delivered/i.test(s));
    expect(sql).toMatch(/delivered = 1/i);
  });

  // ── Regression: DM blank screen (UUID normalization) ─────────────────────────
  // Bug: passing privateChatUuid='userB-uuid' when my uuid is 'userA-uuid' built
  // 'userA-uuid:userB-uuid' but messages were stored as 'userB-uuid:userA-uuid'
  // (sorted). Fix: always sort both sides before querying.
  test('getMessages DM query always uses sorted UUID pair', () => {
    mockStmt.get.mockReturnValue({ uuid: 'zzz-me', name: 'Me' });
    mockStmt.all.mockReturnValue([]);

    db.getMessages({ privateChatUuid: 'aaa-peer' });

    const allCalls = mockStmt.all.mock.calls;
    // The first positional argument to .all() is the normalised chat UUID
    const usedId = allCalls.at(-1)[0];
    // Sorted: 'aaa-peer' < 'zzz-me'  →  'aaa-peer:zzz-me'
    expect(usedId).toBe('aaa-peer:zzz-me');
  });

  test('getMessages DM sort is stable regardless of argument order', () => {
    // If myUuid comes first alphabetically, normalisation should still sort
    mockStmt.get.mockReturnValue({ uuid: 'aaa-me', name: 'Me' });
    mockStmt.all.mockReturnValue([]);

    db.getMessages({ privateChatUuid: 'zzz-peer' });

    const usedId = mockStmt.all.mock.calls.at(-1)[0];
    expect(usedId).toBe('aaa-me:zzz-peer');
  });
});

// ── Reactions ─────────────────────────────────────────────────────────────────

describe('reactions', () => {
  test('upsertReaction uses ON CONFLICT … DO UPDATE SET emoji', () => {
    db.upsertReaction('msg-1', 'u1', '👍');
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /ON CONFLICT/i.test(s) && /emoji/i.test(s));
    expect(sql).toMatch(/DO UPDATE SET emoji/is);
  });

  test('removeReaction deletes by message_id + user_uuid', () => {
    db.removeReaction('msg-1', 'u1');
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /DELETE FROM reactions/i.test(s));
    expect(sql).toMatch(/message_id = \? AND user_uuid = \?/i);
  });
});

// ── Files ─────────────────────────────────────────────────────────────────────

describe('files', () => {
  test('saveFile uses ON CONFLICT DO NOTHING', () => {
    db.saveFile({ id: 't1', message_id: 'm1', original_name: 'a.pdf', local_path: '/tmp/a.pdf', size: 500, mime_type: 'application/pdf', sha256: 'abc', timestamp: 1000 });
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /INSERT.*files/i.test(s));
    expect(sql).toMatch(/ON CONFLICT.*DO NOTHING/is);
  });

  test('getFileByMsgId queries by message_id', () => {
    db.getFileByMsgId('m1');
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const sql = sqls.find(s => /SELECT \* FROM files WHERE message_id/i.test(s));
    expect(sql).toBeDefined();
  });
});

// ── DM management (hide/unhide/delete) ────────────────────────────────────────

describe('DM management', () => {
  // getHiddenDMs uses getSetting('hidden_dms') — stored as JSON in settings table.

  test('getHiddenDMs returns empty array when setting is absent', () => {
    expect(db.getHiddenDMs()).toEqual([]);
  });

  test('getHiddenDMs returns stored UUID array from settings', () => {
    mockStmt.get.mockReturnValue({ value: JSON.stringify(['p1', 'p2']) });
    expect(db.getHiddenDMs()).toEqual(['p1', 'p2']);
  });

  test('setHiddenDM persists via INSERT … ON CONFLICT DO UPDATE into settings', () => {
    db.setHiddenDM('peer-uuid', true);
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const insertSql = sqls.find(s => /INSERT INTO settings/i.test(s));
    expect(insertSql).toMatch(/ON CONFLICT.*DO UPDATE SET value/is);
  });

  test('deleteDMMessages normalises UUID pair (sorted) before deleting', () => {
    // Profile uuid 'zzz-me'; peer 'aaa-peer' → sorted key = 'aaa-peer:zzz-me'
    mockStmt.get.mockReturnValue({ uuid: 'zzz-me' });
    db.deleteDMMessages('aaa-peer');
    const sqls = mockDb.prepare.mock.calls.map(([s]) => s);
    const delSql = sqls.find(s => /DELETE FROM messages WHERE private_chat_uuid/i.test(s));
    expect(delSql).toBeDefined();
    const usedId = mockStmt.run.mock.calls.at(-1)[0];
    expect(usedId).toBe('aaa-peer:zzz-me');
  });
});
