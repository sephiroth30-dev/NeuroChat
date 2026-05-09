'use strict';

// ── Module mocks (hoisted before any require) ─────────────────────────────────

jest.mock('os', () => ({
  networkInterfaces: jest.fn(() => ({
    lo: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    eth0: [
      { family: 'IPv4', address: '192.168.1.10', netmask: '255.255.255.0', internal: false },
      { family: 'IPv6', address: 'fe80::1', netmask: '/64', internal: false },
    ],
  })),
}));

// TCP server mock — resolves to true (port available)
jest.mock('net', () => {
  const makeSrv = () => {
    const srv = {
      once: jest.fn(() => srv),
      listen: jest.fn((_port, _host, cb) => cb()),
      close: jest.fn(cb => cb && cb()),
    };
    return srv;
  };
  return { createServer: jest.fn(makeSrv) };
});

// UDP socket mock — resolves to true (port available)
jest.mock('dgram', () => {
  const makeSock = () => {
    const sock = {
      once: jest.fn(() => sock),
      bind: jest.fn((_port, cb) => cb()),
      close: jest.fn(cb => cb && cb()),
    };
    return sock;
  };
  return { createSocket: jest.fn(makeSock) };
});

jest.mock('child_process', () => ({
  exec: jest.fn((_cmd, cb) => cb(null, 'OK', '')),
}));

// ── Load module after mocks are in place ──────────────────────────────────────

const diagnostics = require('../../src/main/diagnostics');
const { exec } = require('child_process');
const os = require('os');

// ── getLocalIPs ───────────────────────────────────────────────────────────────

describe('getLocalIPs', () => {
  test('returns only non-internal IPv4 addresses', () => {
    const ips = diagnostics.getLocalIPs();
    expect(ips).toHaveLength(1);
    expect(ips[0]).toMatchObject({ name: 'eth0', address: '192.168.1.10' });
  });

  test('excludes loopback (127.x)', () => {
    const ips = diagnostics.getLocalIPs();
    expect(ips.every(i => !i.address.startsWith('127.'))).toBe(true);
  });

  test('returns empty array when no external IPv4 interfaces exist', () => {
    os.networkInterfaces.mockReturnValueOnce({
      lo: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    });
    const ips = diagnostics.getLocalIPs();
    expect(ips).toHaveLength(0);
  });
});

// ── runDiagnostics ────────────────────────────────────────────────────────────

describe('runDiagnostics', () => {
  test('returns expected shape with all ports available', async () => {
    const result = await diagnostics.runDiagnostics(2);

    expect(result).toMatchObject({
      ip: { ok: true },
      udpPort: { ok: true, port: 45678 },
      wsPort: { ok: true, port: 45679 },
      filePort: { ok: true, port: 45680 },
      usersDetected: { ok: true, count: 2 },
      multipleInterfaces: { warn: false, count: 1 },
    });
    expect(result.ip.value).toContain('192.168.1.10');
  });

  test('usersDetected.ok is false when count = 0', async () => {
    const result = await diagnostics.runDiagnostics(0);
    expect(result.usersDetected.ok).toBe(false);
    expect(result.usersDetected.count).toBe(0);
  });

  test('ip.ok is false when no network interfaces are found', async () => {
    os.networkInterfaces.mockReturnValueOnce({});
    const result = await diagnostics.runDiagnostics(0);
    expect(result.ip.ok).toBe(false);
  });

  test('multipleInterfaces.warn is true when more than one interface exists', async () => {
    os.networkInterfaces.mockReturnValueOnce({
      eth0: [{ family: 'IPv4', address: '192.168.1.10', netmask: '255.255.255.0', internal: false }],
      wlan0: [{ family: 'IPv4', address: '10.0.0.5', netmask: '255.0.0.0', internal: false }],
    });
    const result = await diagnostics.runDiagnostics(1);
    expect(result.multipleInterfaces.warn).toBe(true);
    expect(result.multipleInterfaces.count).toBe(2);
  });
});

// ── addFirewallRules ──────────────────────────────────────────────────────────

describe('addFirewallRules', () => {
  test('runs exactly 3 commands and returns ok: true for each', async () => {
    const results = await diagnostics.addFirewallRules();
    expect(results).toHaveLength(3);
    results.forEach(r => expect(r.ok).toBe(true));
  });

  test('returns ok: false with error message when exec fails', async () => {
    exec.mockImplementationOnce((_cmd, cb) => cb(new Error('Access denied')));
    const results = await diagnostics.addFirewallRules();
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('Access denied');
  });

  test('continues running remaining rules after one failure', async () => {
    exec.mockImplementationOnce((_cmd, cb) => cb(new Error('fail')));
    const results = await diagnostics.addFirewallRules();
    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
    expect(results[2].ok).toBe(true);
  });
});
