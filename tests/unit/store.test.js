'use strict';

// store.js is pure JavaScript — no mocking needed.
// Reset module between tests to get fresh in-memory state.
let store;

beforeEach(() => {
  jest.resetModules();
  store = require('../../src/main/store');
});

// ── Online users ──────────────────────────────────────────────────────────────

describe('online users', () => {
  test('initially empty', () => {
    expect(store.getOnlineUsers()).toEqual([]);
  });

  test('setUserOnline adds user', () => {
    store.setUserOnline({ uuid: 'u1', name: 'Ana', status: 'available' });
    expect(store.getOnlineUsers()).toHaveLength(1);
    expect(store.getOnlineUsers()[0].uuid).toBe('u1');
  });

  test('setUserOnline updates existing user', () => {
    store.setUserOnline({ uuid: 'u1', name: 'Ana', status: 'available' });
    store.setUserOnline({ uuid: 'u1', name: 'Ana M.', status: 'away' });
    expect(store.getOnlineUsers()).toHaveLength(1);
    expect(store.getOnlineUsers()[0].name).toBe('Ana M.');
  });

  test('getUser returns null for unknown uuid', () => {
    expect(store.getUser('nope')).toBeNull();
  });

  test('getUser returns user by uuid', () => {
    store.setUserOnline({ uuid: 'u1', name: 'Ana' });
    expect(store.getUser('u1')).toMatchObject({ uuid: 'u1', name: 'Ana' });
  });

  test('setUserOffline marks user offline but keeps entry', () => {
    store.setUserOnline({ uuid: 'u1', name: 'Ana', status: 'available' });
    store.setUserOffline('u1');
    expect(store.getUser('u1').status).toBe('offline');
    expect(store.getUser('u1').isOnline).toBe(false);
  });

  test('setUserOffline is a no-op for unknown uuid', () => {
    expect(() => store.setUserOffline('nope')).not.toThrow();
  });

  test('removeUser deletes user completely', () => {
    store.setUserOnline({ uuid: 'u1', name: 'Ana' });
    store.removeUser('u1');
    expect(store.getUser('u1')).toBeNull();
    expect(store.getOnlineUsers()).toHaveLength(0);
  });

  test('touchUser updates lastSeen', () => {
    const before = Date.now();
    store.setUserOnline({ uuid: 'u1', name: 'Ana', lastSeen: 0 });
    store.touchUser('u1');
    expect(store.getUser('u1').lastSeen).toBeGreaterThanOrEqual(before);
  });

  test('touchUser is a no-op for unknown uuid', () => {
    expect(() => store.touchUser('nope')).not.toThrow();
  });
});

// ── Message queue ─────────────────────────────────────────────────────────────

describe('message queue', () => {
  test('drainQueue returns [] when nothing queued', () => {
    expect(store.drainQueue('u1')).toEqual([]);
  });

  test('queueMessage / drainQueue round-trip preserves order', () => {
    store.queueMessage('u1', { id: 'a' });
    store.queueMessage('u1', { id: 'b' });
    const msgs = store.drainQueue('u1');
    expect(msgs.map(m => m.id)).toEqual(['a', 'b']);
  });

  test('drainQueue empties the queue', () => {
    store.queueMessage('u1', { id: 'a' });
    store.drainQueue('u1');
    expect(store.drainQueue('u1')).toEqual([]);
  });

  test('queues are isolated per user', () => {
    store.queueMessage('u1', { id: 'for-u1' });
    store.queueMessage('u2', { id: 'for-u2' });
    expect(store.drainQueue('u1')).toHaveLength(1);
    expect(store.drainQueue('u2')).toHaveLength(1);
  });
});

// ── Active transfers ──────────────────────────────────────────────────────────

describe('active transfers', () => {
  test('getTransfer returns undefined for unknown id', () => {
    expect(store.getTransfer('t1')).toBeUndefined();
  });

  test('setTransfer / getTransfer round-trip', () => {
    store.setTransfer('t1', { filePath: '/tmp/a.txt', size: 1024 });
    expect(store.getTransfer('t1')).toMatchObject({ filePath: '/tmp/a.txt', size: 1024 });
  });

  test('removeTransfer deletes entry', () => {
    store.setTransfer('t1', { filePath: '/tmp/a.txt' });
    store.removeTransfer('t1');
    expect(store.getTransfer('t1')).toBeUndefined();
  });
});
