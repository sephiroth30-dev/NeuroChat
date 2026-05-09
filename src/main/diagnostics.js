'use strict';

const os = require('os');
const net = require('net');
const dgram = require('dgram');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const PORTS = { udp: 45678, ws: 45679, file: 45680 };

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const results = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        results.push({ name, address: addr.address, netmask: addr.netmask });
      }
    }
  }
  return results;
}

async function checkPortFree(protocol, port) {
  return new Promise(resolve => {
    if (protocol === 'tcp') {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '0.0.0.0', () => {
        srv.close(() => resolve(true));
      });
    } else {
      const sock = dgram.createSocket('udp4');
      sock.once('error', () => resolve(false));
      sock.bind(port, () => {
        sock.close(() => resolve(true));
      });
    }
  });
}

async function runDiagnostics(onlineUserCount = 0) {
  const ips = getLocalIPs();
  const [udpFree, wsFree, fileFree] = await Promise.all([
    checkPortFree('udp', PORTS.udp),
    checkPortFree('tcp', PORTS.ws),
    checkPortFree('tcp', PORTS.file),
  ]);

  return {
    ip: {
      ok: ips.length > 0,
      value: ips.map(i => i.address).join(', ') || null,
      interfaces: ips,
    },
    udpPort: { ok: udpFree, port: PORTS.udp },
    wsPort: { ok: wsFree, port: PORTS.ws },
    filePort: { ok: fileFree, port: PORTS.file },
    usersDetected: { ok: onlineUserCount > 0, count: onlineUserCount },
    multipleInterfaces: { warn: ips.length > 1, count: ips.length },
  };
}

async function addFirewallRules() {
  const rules = [
    `netsh advfirewall firewall add rule name="NeuroChat UDP"  protocol=UDP localport=${PORTS.udp} action=allow dir=in`,
    `netsh advfirewall firewall add rule name="NeuroChat WS"   protocol=TCP localport=${PORTS.ws}  action=allow dir=in`,
    `netsh advfirewall firewall add rule name="NeuroChat File" protocol=TCP localport=${PORTS.file} action=allow dir=in`,
  ];
  const results = [];
  for (const cmd of rules) {
    try {
      await execAsync(cmd);
      results.push({ cmd, ok: true });
    } catch (e) {
      results.push({ cmd, ok: false, error: e.message });
    }
  }
  return results;
}

module.exports = { runDiagnostics, addFirewallRules, getLocalIPs };
