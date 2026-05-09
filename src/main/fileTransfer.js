'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { BrowserWindow } = require('electron');

const FILE_PORT = 45680;
const CHUNK_SIZE = 64 * 1024; // 64 KB read chunks
const MAX_FILESIZE = 500 * 1024 * 1024; // 500 MB

let tcpServer = null;
let db = null;
let store = null;

// transferId → transfer record
const transfers = new Map();

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start() {
  db = require('./database');
  store = require('./store');

  tcpServer = net.createServer(onSenderSocket);
  tcpServer.listen(FILE_PORT, () => {
    console.log(`[fileTransfer] TCP en puerto ${FILE_PORT}`);
  });
  tcpServer.on('error', err => {
    const msg = err.code === 'EADDRINUSE' ? `Puerto ${FILE_PORT} ocupado` : err.message;
    console.error('[fileTransfer]', msg);
  });
}

function stop() {
  for (const t of transfers.values()) {
    try {
      t.socket?.destroy();
    } catch {}
    try {
      t.writeStream?.destroy();
    } catch {}
  }
  transfers.clear();
  if (tcpServer) {
    tcpServer.close();
    tcpServer = null;
  }
}

// ── Sender side ───────────────────────────────────────────────────────────────

// Called by ipcHandlers. Returns { transferId, hash } when the offer is sent.
async function sendFile({ filePath, name, size, mimeType, messageId, chatId, chatType }) {
  if (!fs.existsSync(filePath)) throw new Error('Archivo no encontrado');
  if (size > MAX_FILESIZE) throw new Error('Archivo demasiado grande (máx 500 MB)');

  const profile = db.getProfile();
  if (!profile) throw new Error('Sin perfil');

  const transferId = crypto.randomUUID();
  const hash = await computeHash(filePath);

  const toUuid = chatType === 'dm' ? chatId : null;
  const channelId = chatType === 'channel' ? chatId : null;

  transfers.set(transferId, {
    role: 'sender',
    state: 'offering',
    filePath,
    name,
    size,
    mimeType,
    hash,
    messageId,
    fromUuid: profile.uuid,
    toUuid,
    channelId,
    bytesSent: 0,
  });

  // Send FILE_OFFER via WebSocket to recipient(s)
  const wsClient = require('./wsClient');
  const payload = {
    type: 'FILE_OFFER',
    transferId,
    messageId,
    fromUuid: profile.uuid,
    senderName: profile.name,
    toUuid,
    channelId,
    name,
    size,
    mimeType,
    hash,
  };

  const targets = toUuid
    ? store.getOnlineUsers().filter(u => u.uuid === toUuid)
    : store.getOnlineUsers();
  targets.forEach(peer => wsClient.sendTo(peer, payload));

  return { transferId, hash };
}

// TCP server handler — receiver connects here to trigger the actual file stream
function onSenderSocket(socket) {
  let buf = '';
  let headerDone = false;
  let transfer = null;
  let readStream = null;

  socket.on('data', chunk => {
    if (headerDone) return; // all further data from socket is ignored (receiver only reads)

    buf += chunk.toString('utf8');
    const nl = buf.indexOf('\n');
    if (nl < 0) return;

    let hdr;
    try {
      hdr = JSON.parse(buf.slice(0, nl));
    } catch {
      socket.destroy();
      return;
    }

    transfer = transfers.get(hdr.transferId);
    if (!transfer || transfer.role !== 'sender') {
      socket.destroy();
      return;
    }

    transfer.state = 'sending';
    transfer.socket = socket;
    headerDone = true;

    readStream = fs.createReadStream(transfer.filePath, { highWaterMark: CHUNK_SIZE });

    readStream.on('data', buf => {
      transfer.bytesSent += buf.length;
      socket.write(buf);
      const pct = Math.round((transfer.bytesSent / transfer.size) * 100);
      notify('file:progress', { transferId: hdr.transferId, percent: pct, role: 'sender' });
    });

    readStream.on('end', () => {
      socket.end();
      transfer.state = 'done';
      notify('file:progress', {
        transferId: hdr.transferId,
        percent: 100,
        role: 'sender',
        done: true,
      });
      transfers.delete(hdr.transferId);
    });

    readStream.on('error', err => {
      console.error('[fileTransfer] readStream error:', err.message);
      socket.destroy();
      transfers.delete(hdr.transferId);
    });
  });

  socket.on('error', err => {
    console.warn('[fileTransfer] sender socket error:', err.message);
    readStream?.destroy();
  });
}

// ── Receiver side ─────────────────────────────────────────────────────────────

// Called by wsServer when a FILE_OFFER WS message arrives
function onOffer(offer) {
  transfers.set(offer.transferId, {
    role: 'receiver',
    state: 'pending',
    ...offer,
    bytesReceived: 0,
  });
  notify('file:offer', {
    transferId: offer.transferId,
    messageId: offer.messageId,
    name: offer.name,
    size: offer.size,
    mimeType: offer.mimeType,
    fromUuid: offer.fromUuid,
    senderName: offer.senderName || 'Alguien',
  });
}

function accept(transferId) {
  const transfer = transfers.get(transferId);
  if (!transfer || transfer.state !== 'pending') return;

  const peer = store.getOnlineUsers().find(u => u.uuid === transfer.fromUuid);
  if (!peer?.ip) {
    notify('file:error', { transferId, message: 'El remitente ya no está disponible' });
    transfers.delete(transferId);
    return;
  }

  transfer.state = 'receiving';

  const settings = db.getAllSettings();
  const downloadDir = settings.downloadDir || path.join(os.homedir(), 'NeuroChat', 'Archivos');
  fs.mkdirSync(downloadDir, { recursive: true });

  const destPath = uniquePath(downloadDir, transfer.name);
  transfer.destPath = destPath;

  const socket = net.connect(FILE_PORT, peer.ip);
  const writeStream = fs.createWriteStream(destPath);
  transfer.socket = socket;
  transfer.writeStream = writeStream;

  socket.once('connect', () => {
    // Send transfer ID header so sender knows which transfer this is
    socket.write(JSON.stringify({ transferId }) + '\n');
  });

  socket.on('data', chunk => {
    transfer.bytesReceived += chunk.length;
    writeStream.write(chunk);
    const pct = Math.min(Math.round((transfer.bytesReceived / transfer.size) * 100), 99);
    notify('file:progress', { transferId, percent: pct, role: 'receiver' });
  });

  socket.on('end', () => {
    writeStream.end(() => {
      transfer.state = 'done';

      // Save to files table
      db.saveFile({
        id: transferId,
        message_id: transfer.messageId || null,
        original_name: transfer.name,
        local_path: destPath,
        size: transfer.size,
        mime_type: transfer.mimeType,
        sha256: transfer.hash || null,
        timestamp: Date.now(),
      });

      notify('file:complete', {
        transferId,
        messageId: transfer.messageId || null,
        name: transfer.name,
        mimeType: transfer.mimeType,
        localPath: destPath,
      });
      notify('file:progress', { transferId, percent: 100, role: 'receiver', done: true });
      transfers.delete(transferId);
    });
  });

  socket.on('error', err => {
    console.error('[fileTransfer] receiver socket error:', err.message);
    writeStream.destroy();
    fs.unlink(destPath, () => {});
    notify('file:error', { transferId, message: err.message });
    transfers.delete(transferId);
  });
}

function reject(transferId) {
  const transfer = transfers.get(transferId);
  if (!transfer) return;
  transfers.delete(transferId);

  const peer = store.getOnlineUsers().find(u => u.uuid === transfer.fromUuid);
  const profile = db.getProfile();
  if (peer && profile) {
    require('./wsClient').sendTo(peer, {
      type: 'FILE_REJECT',
      transferId,
      fromUuid: profile.uuid,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', c => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let dest = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${base} (${i++})${ext}`);
  }
  return dest;
}

function notify(event, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(event, data);
  });
}

module.exports = { start, stop, sendFile, accept, reject, onOffer };
