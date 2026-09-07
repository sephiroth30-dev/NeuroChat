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

// Check if Windows Firewall rules for NeuroChat are already in place.
// BOTH matter: the fixed-port rules cover chat/discovery/file transfer, while
// the app-level rule is what lets WebRTC (remote support) through — it binds
// random ephemeral UDP ports, so the fixed-port rules do nothing for it.
// Checking only "NeuroChat WS" made this return true on GPO-managed machines
// (the GPO script creates it) so the app-level rule was never added.
async function checkFirewallRules() {
  if (process.platform !== 'win32') return true;

  const showRule = async (name, verbose = false) => {
    try {
      const { stdout } = await execAsync(
        `netsh advfirewall firewall show rule name="${name}"${verbose ? ' verbose' : ''}`,
        { timeout: 5000 }
      );
      return stdout.includes('No rules match') ? null : stdout;
    } catch {
      return null;
    }
  };

  const [wsOut, appOut] = await Promise.all([
    showRule('NeuroChat WS'),
    showRule('NeuroChat App', true),
  ]);
  if (!wsOut || !appOut) return false;

  // The app rule must point at THIS user's executable. Several profiles can
  // each have their own per-user install, and netsh keeps multiple rules under
  // the same name — matching on the name alone would report "all good" while
  // the only rule present authorises somebody else's exe, silently blocking
  // WebRTC with no prompt and no diagnostic.
  try {
    const { app } = require('electron');
    const exePath = app.getPath('exe').toLowerCase();
    return appOut.toLowerCase().includes(exePath);
  } catch {
    return true; // can't resolve our own path — don't nag the user
  }
}

// Add Windows Firewall rules with UAC elevation via PowerShell.
// Writes a batch file to %TEMP% then runs it elevated so netsh gets admin rights.
async function addFirewallRules() {
  if (process.platform !== 'win32') return [{ ok: false, error: 'Solo disponible en Windows' }];

  const path = require('path');
  const fs = require('fs');
  const { app } = require('electron');

  const exePath = app.getPath('exe');
  const batchPath = path.join(os.tmpdir(), 'nc-fw.bat');

  // Note: the port rules are deleted before being re-added (they're identical
  // for every user), but the app rule is NOT — on a shared PC each profile has
  // its own exe path, and deleting them all would silently break remote
  // support for every other user of that machine. netsh allows several rules
  // under the same name, so adding ours is enough.
  const lines = [
    '@echo off',
    `netsh advfirewall firewall delete rule name="NeuroChat UDP"  >nul 2>&1`,
    `netsh advfirewall firewall delete rule name="NeuroChat WS"   >nul 2>&1`,
    `netsh advfirewall firewall delete rule name="NeuroChat File" >nul 2>&1`,
    `netsh advfirewall firewall delete rule name="NeuroChat App" program="${exePath}" >nul 2>&1`,
    `netsh advfirewall firewall add rule name="NeuroChat UDP"  protocol=UDP localport=${PORTS.udp} action=allow dir=in`,
    `netsh advfirewall firewall add rule name="NeuroChat WS"   protocol=TCP localport=${PORTS.ws}  action=allow dir=in`,
    `netsh advfirewall firewall add rule name="NeuroChat File" protocol=TCP localport=${PORTS.file} action=allow dir=in`,
    `netsh advfirewall firewall add rule name="NeuroChat App"  program="${exePath}" action=allow dir=in protocol=any`,
  ];

  fs.writeFileSync(batchPath, lines.join('\r\n'));

  // Run elevated: encode the PowerShell command as UTF-16LE base64 to avoid
  // all quoting issues when the path contains spaces or special characters.
  const safeBatch = batchPath.replace(/'/g, "''");
  const psCmd = `Start-Process -FilePath '${safeBatch}' -Verb RunAs -Wait`;
  const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');

  try {
    await execAsync(`powershell -WindowStyle Hidden -EncodedCommand ${encoded}`, { timeout: 30_000 });
  } catch (e) {
    return [{ ok: false, error: e.message }];
  }

  // Do NOT trust the exit code: declining the UAC prompt makes Start-Process
  // raise a non-terminating error, so powershell.exe still exits 0. Reporting
  // success there would stop the caller's retry counter from ever advancing
  // and the user would be prompted for credentials on every single launch.
  const applied = await checkFirewallRules();
  return applied
    ? [{ ok: true }]
    : [{ ok: false, error: 'Las reglas no se crearon (elevación cancelada o denegada)' }];
}

module.exports = { runDiagnostics, checkFirewallRules, addFirewallRules, getLocalIPs };

