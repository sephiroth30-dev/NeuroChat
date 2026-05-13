'use strict';

// ── Discovery module — unit tests ─────────────────────────────────────────────
// We use jest.doMock (not hoisted) so we can configure mocks per test.

const BASE_PROFILE = {
  uuid: 'u1', name: 'Ana', avatar: null, color: '#4A9E8F',
  status: 'available', status_message: '',
};

let mockSocketSend;

function loadDiscovery(profile, { settings = {} } = {}) {
  jest.resetModules();

  mockSocketSend = jest.fn((_buf, _o, _l, _p, _a, cb) => cb && cb());
  const mockSocket = {
    bind: jest.fn((_p, cb) => cb && cb()),
    setBroadcast: jest.fn(),
    send: mockSocketSend,
    on: jest.fn(),
    close: jest.fn(cb => cb && cb()),
  };

  jest.doMock('dgram', () => ({ createSocket: () => mockSocket }));
  jest.doMock('os', () => ({
    networkInterfaces: () => ({
      en0: [{ family: 'IPv4', address: '192.168.1.10', netmask: '255.255.255.0', internal: false }],
    }),
  }));
  jest.doMock('electron', () => ({
    app: { getVersion: () => '1.0.0-test' },
    BrowserWindow: { getAllWindows: () => [] },
  }));
  jest.doMock('../../src/main/database', () => ({
    getProfile: () => profile,
    getAllUsers: () => [],
    getAllSettings: () => settings,
  }));
  jest.doMock('../../src/main/store', () => ({
    getOnlineUsers: () => [],
    setOnlineStatus: jest.fn(),
    markOffline: jest.fn(),
    removeUser: jest.fn(),
  }));

  const disc = require('../../src/main/discovery');
  disc.start();
  return disc;
}

afterEach(() => {
  try { require('../../src/main/discovery').stop(); } catch (_) {}
  jest.resetModules();
});

// ── broadcast ─────────────────────────────────────────────────────────────────

describe('broadcast', () => {
  test('sends UDP packet when status is available', () => {
    loadDiscovery({ ...BASE_PROFILE, status: 'available' });
    expect(mockSocketSend).toHaveBeenCalled();
    const payload = JSON.parse(mockSocketSend.mock.calls[0][0].toString());
    expect(payload.type).toBe('NEUROCHAT_ANNOUNCE');
    expect(payload.status).toBe('available');
  });

  test('does NOT send UDP packet when status is invisible', () => {
    loadDiscovery({ ...BASE_PROFILE, status: 'invisible' });
    expect(mockSocketSend).not.toHaveBeenCalled();
  });

  test('target address is the broadcast IP (not host IP)', () => {
    loadDiscovery({ ...BASE_PROFILE, status: 'available' });
    const destAddr = mockSocketSend.mock.calls[0][4];
    expect(destAddr).toBe('192.168.1.255');
  });

  test('payload includes wsPort and ip', () => {
    loadDiscovery({ ...BASE_PROFILE, status: 'available' });
    const payload = JSON.parse(mockSocketSend.mock.calls[0][0].toString());
    expect(payload).toHaveProperty('wsPort');
    expect(payload).toHaveProperty('ip', '192.168.1.10');
  });

  test('payload never exposes invisible status to peers', () => {
    loadDiscovery({ ...BASE_PROFILE, status: 'invisible' });
    const sentInvisible = mockSocketSend.mock.calls.some(([buf]) => {
      try { return JSON.parse(buf.toString()).status === 'invisible'; } catch { return false; }
    });
    expect(sentInvisible).toBe(false);
  });

  test('does not send if profile is null (first run)', () => {
    loadDiscovery(null);
    expect(mockSocketSend).not.toHaveBeenCalled();
  });

  test('sends for dnd status (only invisible is blocked)', () => {
    loadDiscovery({ ...BASE_PROFILE, status: 'dnd' });
    expect(mockSocketSend).toHaveBeenCalled();
    const payload = JSON.parse(mockSocketSend.mock.calls[0][0].toString());
    expect(payload.status).toBe('dnd');
  });

  test('also sends unicast announcements to configured VLAN targets', () => {
    loadDiscovery(
      { ...BASE_PROFILE, status: 'available' },
      { settings: { discoveryTargets: '172.16.30.10 172.16.30.11' } }
    );
    const destinations = mockSocketSend.mock.calls.map(call => call[4]);
    expect(destinations).toEqual(expect.arrayContaining([
      '192.168.1.255',
      '172.16.30.10',
      '172.16.30.11',
    ]));
  });

  test('expands /24 CIDR targets for routed VLAN discovery', () => {
    loadDiscovery(
      { ...BASE_PROFILE, status: 'available' },
      { settings: { discoveryTargets: '172.16.30.0/24' } }
    );
    const destinations = mockSocketSend.mock.calls.map(call => call[4]);
    expect(destinations).toContain('172.16.30.1');
    expect(destinations).toContain('172.16.30.254');
    expect(destinations).not.toContain('172.16.30.0');
    expect(destinations).not.toContain('172.16.30.255');
  });
});
