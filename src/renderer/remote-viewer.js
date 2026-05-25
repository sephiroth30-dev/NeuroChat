'use strict';

const params = new URLSearchParams(window.location.search);
const SESSION_ID = params.get('sessionId');
const PEER_UUID  = params.get('peerUuid') || '';
const PEER_NAME  = params.get('peerName') || 'Usuario';
const PEER_IP    = params.get('peerIp') || '';

const video      = document.getElementById('remote-video');
const overlay    = document.getElementById('connecting-overlay');
const toolbar    = document.getElementById('toolbar');
const tbStats    = document.getElementById('tb-stats');

document.getElementById('overlay-peer-name').textContent = PEER_NAME;
document.title = `NeuroChat Remote — ${PEER_NAME} (${PEER_IP})`;

let pc = null;
let dc = null; // DataChannel to host (input + quality commands)
let statsInterval = null;
let toolbarTimer = null;
let inputEnabled = false; // only after stream arrives

// ── Toolbar auto-hide ─────────────────────────────────────────────────────────

function showToolbar() {
  toolbar.classList.add('visible');
  clearTimeout(toolbarTimer);
  toolbarTimer = setTimeout(() => toolbar.classList.remove('visible'), 3000);
}

document.addEventListener('mousemove', showToolbar);
document.addEventListener('keydown', showToolbar);

// ── WebRTC setup ──────────────────────────────────────────────────────────────

async function init() {
  pc = new RTCPeerConnection({ iceServers: [] }); // LAN-only: no STUN needed

  // Receive remote video track
  pc.ontrack = e => {
    if (e.track.kind === 'video') {
      video.srcObject = e.streams[0];
      video.onloadedmetadata = () => {
        overlay.style.display = 'none';
        inputEnabled = true;
        video.play().catch(() => {});
        startStats();
      };
    }
  };

  // Receive DataChannel from host
  pc.ondatachannel = e => {
    dc = e.channel;
    dc.onopen = () => console.log('[remote-viewer] DataChannel open');
  };

  // ICE candidates → relay to host via WS
  pc.onicecandidate = e => {
    if (!e.candidate) return;
    remoteViewer.sendSignaling({
      type: 'REMOTE_ICE',
      sessionId: SESSION_ID,
      toUuid: PEER_UUID,
      candidate: e.candidate,
    });
  };
}

// Handle incoming signaling (offer + ICE from host)
remoteViewer.on('remote:signaling', async msg => {
  if (msg.sessionId !== SESSION_ID) return;
  try {
    if (msg.type === 'REMOTE_SDP' && msg.sdpType === 'offer') {
      if (!pc) await init();
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      remoteViewer.sendSignaling({
        type: 'REMOTE_SDP',
        sessionId: SESSION_ID,
        toUuid: PEER_UUID,
        sdp: answer.sdp,
        sdpType: answer.type,
      });
    } else if (msg.type === 'REMOTE_ICE' && msg.candidate) {
      if (pc) await pc.addIceCandidate(msg.candidate);
    }
  } catch (err) {
    console.warn('[remote-viewer] signaling error:', err.message);
  }
});

remoteViewer.on('remote:session-ended', () => {
  cleanup();
  window.close();
});

// ── Input capture & forwarding ────────────────────────────────────────────────

function sendInput(ev) {
  if (!dc || dc.readyState !== 'open') return;
  try { dc.send(JSON.stringify(ev)); } catch {}
}

// Mouse — capture on video element, normalize coordinates to 0-1 range
video.addEventListener('mousemove', e => {
  if (!inputEnabled) return;
  const r = video.getBoundingClientRect();
  sendInput({ type: 'mousemove', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
});

video.addEventListener('mousedown', e => {
  if (!inputEnabled) return;
  e.preventDefault();
  const r = video.getBoundingClientRect();
  sendInput({ type: 'mousedown', button: e.button, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
});

video.addEventListener('mouseup', e => {
  if (!inputEnabled) return;
  const r = video.getBoundingClientRect();
  sendInput({ type: 'mouseup', button: e.button, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
});

video.addEventListener('dblclick', e => {
  if (!inputEnabled) return;
  const r = video.getBoundingClientRect();
  sendInput({ type: 'dblclick', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
});

video.addEventListener('wheel', e => {
  if (!inputEnabled) return;
  e.preventDefault();
  sendInput({ type: 'wheel', dx: e.deltaX, dy: e.deltaY });
}, { passive: false });

video.addEventListener('contextmenu', e => e.preventDefault());

// Keyboard — capture on document when video is focused/clicked
video.setAttribute('tabindex', '0');
video.addEventListener('click', () => video.focus());

video.addEventListener('keydown', e => {
  if (!inputEnabled) return;
  // Let Escape pass through to show toolbar / exit fullscreen
  if (e.key === 'Escape') return;
  e.preventDefault();
  const mods = [];
  if (e.ctrlKey)  mods.push('ctrl');
  if (e.altKey)   mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  if (e.metaKey)  mods.push('meta');
  sendInput({ type: 'keydown', key: e.key, modifiers: mods });
});

// ── Quality control ───────────────────────────────────────────────────────────

document.getElementById('quality-select').addEventListener('change', e => {
  const preset = e.target.value;
  sendInput({ type: 'quality', preset });
});

// ── Toolbar buttons ───────────────────────────────────────────────────────────

document.getElementById('end-btn').addEventListener('click', async () => {
  await remoteViewer.endSession(SESSION_ID);
  window.close();
});

document.getElementById('fs-btn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

function startStats() {
  statsInterval = setInterval(async () => {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      let fps = 0, bitrate = 0;
      stats.forEach(r => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          fps = Math.round(r.framesPerSecond || 0);
          bitrate = r.bytesReceived || 0;
        }
      });
      tbStats.textContent = bitrate
        ? `${fps} fps · ${((bitrate * 8) / 1_000_000).toFixed(1)} Mb/s`
        : `${fps} fps`;
    } catch {}
  }, 1000);
}

function cleanup() {
  clearInterval(statsInterval);
  clearTimeout(toolbarTimer);
  if (dc) { try { dc.close(); } catch {} }
  if (pc) { try { pc.close(); } catch {} }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Initialize PC immediately so we're ready to receive the SDP offer from host
init().catch(err => console.error('[remote-viewer] init error:', err));
showToolbar();
