'use strict';

// WebSocket integration test — "Supertest" style for our WS server.
// The real ws server starts on TEST_PORT; a ws client connects and sends
// JSON messages. We verify DB calls and renderer IPC notifications.

const WebSocket = require('ws');

// ── Module mocks (must be before any require of the modules under test) ───────

jest.mock('../../src/main/database', () => ({
  saveMessage: jest.fn(),
  getAllUsers: jest.fn(() => []),
  getChannels: jest.fn(() => []),
  editMessage: jest.fn(),
  deleteMessage: jest.fn(),
  upsertReaction: jest.fn(),
  markRead: jest.fn(),
  getProfile: jest.fn(() => ({ uuid: 'my-uuid', name: 'Me' })),
  getAllSettings: jest.fn(() => ({})),
}));

jest.mock('../../src/main/store', () => ({
  getOnlineUsers: jest.fn(() => []),
}));

jest.mock('../../src/main/wsClient', () => ({
  sendTo: jest.fn(),
  closeAll: jest.fn(),
}));

jest.mock('../../src/main/fileTransfer', () => ({
  onOffer: jest.fn(),
}));

// ── Test setup ────────────────────────────────────────────────────────────────

const TEST_PORT = 47679; // separate port to avoid conflict with running app

const mockDb = require('../../src/main/database');
const { BrowserWindow } = require('electron'); // uses __mocks__/electron.js
const wsServer = require('../../src/main/wsServer');

let client;

// Helper: send a message and wait a tick for the server to process it
function send(msg) {
  return new Promise((resolve, reject) => {
    client.send(JSON.stringify(msg), err => {
      if (err) reject(err);
      else setTimeout(resolve, 50);
    });
  });
}

function makeMockWin() {
  const win = { isDestroyed: () => false, isFocused: () => false, webContents: { send: jest.fn() } };
  BrowserWindow.getAllWindows.mockReturnValue([win]);
  return win;
}

beforeAll(done => {
  wsServer.start(TEST_PORT);
  client = new WebSocket(`ws://localhost:${TEST_PORT}`);
  client.on('open', done);
  client.on('error', done);
});

afterAll(done => {
  client.close();
  wsServer.stop();
  setTimeout(done, 100);
});

beforeEach(() => {
  jest.clearAllMocks();
  BrowserWindow.getAllWindows.mockReturnValue([]);
});

// ── Invalid input ─────────────────────────────────────────────────────────────

describe('invalid input', () => {
  test('ignores malformed JSON — no DB call', done => {
    client.send('{ not json }', () => {
      setTimeout(() => {
        expect(mockDb.saveMessage).not.toHaveBeenCalled();
        done();
      }, 50);
    });
  });

  test('ignores MESSAGE missing id', async () => {
    await send({ type: 'MESSAGE', fromUuid: 'u1', channelId: 'ch-1', content: 'Hi' });
    expect(mockDb.saveMessage).not.toHaveBeenCalled();
  });

  test('ignores MESSAGE missing fromUuid', async () => {
    await send({ type: 'MESSAGE', id: 'msg-1', channelId: 'ch-1', content: 'Hi' });
    expect(mockDb.saveMessage).not.toHaveBeenCalled();
  });
});

// ── MESSAGE ───────────────────────────────────────────────────────────────────

describe('MESSAGE', () => {
  test('saves channel message to DB with delivered = 1', async () => {
    await send({ type: 'MESSAGE', id: 'msg-1', fromUuid: 'u1', channelId: 'ch-1', content: 'Hola', timestamp: 1000 });

    expect(mockDb.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'msg-1',
        channel_id: 'ch-1',
        content: 'Hola',
        delivered: 1,
        from_uuid: 'u1',
      })
    );
  });

  test('emits message:incoming to renderer window', async () => {
    const win = makeMockWin();
    mockDb.getAllUsers.mockReturnValue([{ uuid: 'u1', name: 'Ana', color: '#ABC' }]);
    mockDb.getChannels.mockReturnValue([{ id: 'ch-1', name: 'General' }]);

    await send({ type: 'MESSAGE', id: 'msg-2', fromUuid: 'u1', channelId: 'ch-1', content: 'Test', timestamp: 2000 });

    expect(win.webContents.send).toHaveBeenCalledWith(
      'message:incoming',
      expect.objectContaining({ id: 'msg-2', content: 'Test', sender_name: 'Ana' })
    );
  });

  test('builds private_chat_uuid as sorted join for DMs', async () => {
    await send({ type: 'MESSAGE', id: 'dm-1', fromUuid: 'u2', toUuid: 'u1', content: 'DM', timestamp: 3000 });

    const [saved] = mockDb.saveMessage.mock.calls[0];
    expect(saved.channel_id).toBeNull();
    expect(saved.private_chat_uuid).toBe('u1:u2'); // sorted: u1 < u2
  });

  test('uses fallback sender_name when user not found', async () => {
    const win = makeMockWin();
    mockDb.getAllUsers.mockReturnValue([]);

    await send({ type: 'MESSAGE', id: 'msg-3', fromUuid: 'unknown', channelId: 'ch-1', content: 'x', timestamp: 4000 });

    expect(win.webContents.send).toHaveBeenCalledWith(
      'message:incoming',
      expect.objectContaining({ sender_name: 'Usuario', color: '#4A9E8F' })
    );
  });
});

// ── EDIT ──────────────────────────────────────────────────────────────────────

describe('EDIT', () => {
  test('calls editMessage and notifies renderer', async () => {
    const win = makeMockWin();
    await send({ type: 'EDIT', id: 'msg-1', content: 'Editado' });

    expect(mockDb.editMessage).toHaveBeenCalledWith('msg-1', 'Editado');
    expect(win.webContents.send).toHaveBeenCalledWith('message:edited', { id: 'msg-1', content: 'Editado' });
  });

  test('ignores EDIT without id', async () => {
    await send({ type: 'EDIT', content: 'sin id' });
    expect(mockDb.editMessage).not.toHaveBeenCalled();
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE', () => {
  test('calls deleteMessage and notifies renderer', async () => {
    const win = makeMockWin();
    await send({ type: 'DELETE', id: 'msg-1' });

    expect(mockDb.deleteMessage).toHaveBeenCalledWith('msg-1');
    expect(win.webContents.send).toHaveBeenCalledWith('message:deleted', { id: 'msg-1' });
  });

  test('ignores DELETE without id', async () => {
    await send({ type: 'DELETE' });
    expect(mockDb.deleteMessage).not.toHaveBeenCalled();
  });
});

// ── REACTION ──────────────────────────────────────────────────────────────────

describe('REACTION', () => {
  test('calls upsertReaction and emits message:reaction', async () => {
    const win = makeMockWin();
    await send({ type: 'REACTION', messageId: 'msg-1', fromUuid: 'u1', emoji: '👍' });

    expect(mockDb.upsertReaction).toHaveBeenCalledWith('msg-1', 'u1', '👍');
    expect(win.webContents.send).toHaveBeenCalledWith('message:reaction', {
      messageId: 'msg-1',
      fromUuid: 'u1',
      emoji: '👍',
    });
  });

  test('ignores REACTION with missing fields', async () => {
    await send({ type: 'REACTION', messageId: 'msg-1' }); // no fromUuid, no emoji
    expect(mockDb.upsertReaction).not.toHaveBeenCalled();
  });
});

// ── TYPING ────────────────────────────────────────────────────────────────────

describe('TYPING', () => {
  test('emits typing:incoming with resolved sender name', async () => {
    const win = makeMockWin();
    mockDb.getAllUsers.mockReturnValue([{ uuid: 'u1', name: 'Ana' }]);

    await send({ type: 'TYPING', fromUuid: 'u1', channelId: 'ch-1' });

    expect(win.webContents.send).toHaveBeenCalledWith('typing:incoming', {
      name: 'Ana',
      chatId: 'ch-1',
    });
  });

  test('uses fallback name for unknown sender', async () => {
    const win = makeMockWin();
    mockDb.getAllUsers.mockReturnValue([]);

    await send({ type: 'TYPING', fromUuid: 'ghost', channelId: 'ch-1' });

    expect(win.webContents.send).toHaveBeenCalledWith('typing:incoming', {
      name: 'Alguien',
      chatId: 'ch-1',
    });
  });

  test('ignores TYPING without fromUuid', async () => {
    const win = makeMockWin();
    await send({ type: 'TYPING', channelId: 'ch-1' });
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

// ── FILE_REJECT ───────────────────────────────────────────────────────────────

describe('FILE_REJECT', () => {
  test('emits file:rejected to renderer', async () => {
    const win = makeMockWin();
    await send({ type: 'FILE_REJECT', transferId: 'tf-1' });
    expect(win.webContents.send).toHaveBeenCalledWith('file:rejected', { transferId: 'tf-1' });
  });
});

// ── READ_RECEIPT ──────────────────────────────────────────────────────────────

describe('READ_RECEIPT', () => {
  test('calls markRead and emits message:read to renderer', async () => {
    const win = makeMockWin();
    await send({ type: 'READ_RECEIPT', messageId: 'msg-1', readerUuid: 'u2' });

    expect(mockDb.markRead).toHaveBeenCalledWith('msg-1', 'u2');
    expect(win.webContents.send).toHaveBeenCalledWith('message:read', {
      messageId: 'msg-1',
      readerUuid: 'u2',
    });
  });

  test('ignores READ_RECEIPT with missing messageId', async () => {
    await send({ type: 'READ_RECEIPT', readerUuid: 'u2' });
    expect(mockDb.markRead).not.toHaveBeenCalled();
  });

  test('ignores READ_RECEIPT with missing readerUuid', async () => {
    await send({ type: 'READ_RECEIPT', messageId: 'msg-1' });
    expect(mockDb.markRead).not.toHaveBeenCalled();
  });
});
