'use strict';

// better-sqlite3 is a native module compiled for Electron's Node ABI.
// We mock it so these tests run on any Node.js version without recompilation.
// The mock lets us verify SQL intent (ON CONFLICT, DELETE, JOIN patterns) and
// business logic (read_by serialization, soft-delete, etc.) without a real DB.

jest.mock('better-sqlite3');
const Database = require('better-sqlite3');

let mockStmt, mockDb, db;

beforeEach(() => {
  jest.resetModules();

  mockStmt = {
    run: jest.fn(() => ({ changes: 1 })),
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

  jest.resetModules(); // re-register mocks after resetModules
  jest.mock('better-sqlite3');
  require('better-sqlite3').mockImplementation(() => mockDb);

  db = require('../../src/main/database');
  db.initialize(); // uses mocked Database — path resolved via mocked app.getPath
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
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/INSERT INTO my_profile/i);
    expect(lastSql).toMatch(/ON CONFLICT.*DO UPDATE/is);
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
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/INSERT INTO channels/i);
    expect(lastSql).toMatch(/ON CONFLICT/i);
  });

  test('deleteChannel restricts to is_default = 0', () => {
    db.deleteChannel('ch-1');
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/DELETE FROM channels WHERE id = \? AND is_default = 0/i);
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
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/ON CONFLICT.*DO NOTHING/is);
  });

  test('editMessage sets edited = 1', () => {
    db.editMessage('m1', 'Nuevo contenido');
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/UPDATE messages SET content = \?, edited = 1/i);
  });

  test('deleteMessage is a soft-delete (deleted = 1, content = NULL)', () => {
    db.deleteMessage('m1');
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/UPDATE messages SET deleted = 1, content = NULL/i);
  });

  test('markDelivered sets delivered = 1', () => {
    db.markDelivered('m1');
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/UPDATE messages SET delivered = 1/i);
  });
});

// ── Reactions ─────────────────────────────────────────────────────────────────

describe('reactions', () => {
  test('upsertReaction uses ON CONFLICT … DO UPDATE SET emoji', () => {
    db.upsertReaction('msg-1', 'u1', '👍');
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/ON CONFLICT.*DO UPDATE SET emoji/is);
  });

  test('removeReaction deletes by message_id + user_uuid', () => {
    db.removeReaction('msg-1', 'u1');
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/DELETE FROM reactions WHERE message_id = \? AND user_uuid = \?/i);
  });
});

// ── Files ─────────────────────────────────────────────────────────────────────

describe('files', () => {
  test('saveFile uses ON CONFLICT DO NOTHING', () => {
    db.saveFile({ id: 't1', message_id: 'm1', original_name: 'a.pdf', local_path: '/tmp/a.pdf', size: 500, mime_type: 'application/pdf', sha256: 'abc', timestamp: 1000 });
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/ON CONFLICT.*DO NOTHING/is);
  });

  test('getFileByMsgId queries by message_id', () => {
    db.getFileByMsgId('m1');
    const lastSql = mockDb.prepare.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/SELECT \* FROM files WHERE message_id = \?/i);
  });
});
