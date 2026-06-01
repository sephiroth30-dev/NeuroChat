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

// ── Session state ─────────────────────────────────────────────────────────────

let pc             = null;   // RTCPeerConnection — only set after ensureInit() resolves
let dc             = null;   // DataChannel from host
let statsInterval  = null;
let toolbarTimer   = null;
let connectTimer   = null;
let videoTimer     = null;   // secondary timer: video must arrive after ICE connects
let inputEnabled   = false;
let _videoActivated = false; // guard: _activateVideo runs at most once

// ICE candidate buffer (candidates arriving before setRemoteDescription)
let _pendingIce    = [];
let _remoteDescSet = false;

// ── init() MUTEX: prevents any concurrent or duplicate PC creation ─────────────
// Only set once. If the session ends and cleanup() resets it, it can be re-set
// for an ICE-restart re-offer. Using a Promise so concurrent callers all wait.
let _initPromise = null;

function ensureInit() {
  if (!_initPromise) _initPromise = _createPC();
  return _initPromise;
}

async function _createPC() {
  const iceServers = await remoteViewer.getIceServers().catch(() => [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]);

  pc = new RTCPeerConnection({
    iceServers,
    iceCandidatePoolSize: 6,
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  });

  // ── Receive remote video track ──────────────────────────────────────────────
  pc.ontrack = e => {
    if (e.track.kind !== 'video') return;
    video.srcObject = e.streams[0];
    // Both events assigned to the SAME function reference so the guard flag
    // prevents double-activation even when both events fire (which is normal).
    video.onloadedmetadata = _activateVideo;
    video.oncanplay        = _activateVideo;
  };

  // ── Receive DataChannel from host ───────────────────────────────────────────
  pc.ondatachannel = e => {
    dc = e.channel;
    dc.onopen = () => console.log('[remote-viewer] DataChannel open');
  };

  // ── ICE candidates → relay to host via WS ──────────────────────────────────
  // Use .toJSON() for safe serialization through Electron IPC; RTCIceCandidate
  // DOM objects are not guaranteed to serialize their properties via structuredClone.
  pc.onicecandidate = e => {
    if (!e.candidate) return;
    console.log('[remote-viewer] ICE candidate:', e.candidate.candidate.slice(0, 80));
    remoteViewer.sendSignaling({
      type: 'REMOTE_ICE',
      sessionId: SESSION_ID,
      toUuid: PEER_UUID,
      candidate: e.candidate.toJSON(),
    });
  };

  pc.onicegatheringstatechange = () =>
    console.log('[remote-viewer] ICE gathering:', pc.iceGatheringState);

  pc.onconnectionstatechange = () =>
    console.log('[remote-viewer] connection state:', pc.connectionState);

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log('[remote-viewer] ICE state:', state);

    if (state === 'connected' || state === 'completed') {
      _updateOverlayMsg('ICE conectado — esperando vídeo…');

      // Replace the main timeout with a shorter video-arrival window
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
        videoTimer = setTimeout(() => {
          videoTimer = null;
          if (!inputEnabled) {
            _endWithError(
              'Conexión establecida pero el vídeo no llegó desde <strong>' + PEER_NAME + '</strong>.<br>' +
              'Causa probable: el equipo remoto no tiene permiso de <strong>Grabación de pantalla</strong>.<br>' +
              '<small style="opacity:.7">macOS: Sistema → Privacidad → Grabación de pantalla → activar NeuroChat.</small>'
            );
          }
        }, 12_000);
      }

    } else if (state === 'disconnected') {
      // Transient — WebRTC will attempt self-recovery; do not terminate
      console.log('[remote-viewer] ICE disconnected (transient)');

    } else if (state === 'failed') {
      _endWithError(
        'No se pudo establecer conexión directa con <strong>' + PEER_NAME + '</strong>.<br>' +
        'ICE falló. Posibles causas:<br>' +
        '&bull; Firewall bloqueando tráfico UDP (Windows Defender, antivirus)<br>' +
        '&bull; Redes distintas sin servidor TURN configurado<br>' +
        '<small style="opacity:.7">En Windows: Firewall → Permitir una app → busca NeuroChat → habilita Privado y Público.</small>'
      );
    }
  };
}

// ── Video activation (at most once per session) ───────────────────────────────

function _activateVideo() {
  if (_videoActivated) return;   // guard against onloadedmetadata + oncanplay both firing
  _videoActivated = true;
  clearTimeout(connectTimer);
  clearTimeout(videoTimer);
  connectTimer = null;
  videoTimer   = null;
  overlay.style.display = 'none';
  inputEnabled = true;
  video.play().catch(() => {});
  startStats();
}

// ── Overlay helpers ───────────────────────────────────────────────────────────

function showConnectError(msg) {
  clearTimeout(connectTimer);
  clearTimeout(videoTimer);
  connectTimer = null;
  videoTimer   = null;
  const spinner = document.getElementById('overlay-spinner');
  const msgEl   = document.getElementById('overlay-msg');
  if (spinner) spinner.style.display = 'none';
  if (msgEl)   { msgEl.innerHTML = msg; msgEl.style.color = '#e07070'; }
  overlay.style.display = 'flex';
  const btn = document.getElementById('cancel-connect-btn');
  if (btn) btn.textContent = 'Cerrar';
}

function _updateOverlayMsg(text) {
  const msgEl = document.getElementById('overlay-msg');
  if (msgEl && !msgEl.style.color) msgEl.textContent = text;
}

// Terminate the session and show an error to the user
function _endWithError(html) {
  cleanup();
  showConnectError(html);
  remoteViewer.endSession(SESSION_ID).catch(() => {});
}

function startConnectTimeout() {
  connectTimer = setTimeout(() => {
    connectTimer = null;
    _endWithError(
      'No se pudo conectar con <strong>' + PEER_NAME + '</strong> en 45 segundos.<br>' +
      'El equipo remoto no respondió o el firewall bloqueó la conexión UDP.<br>' +
      '<small style="opacity:.7">Windows: Firewall de Windows Defender → Permitir app → NeuroChat → Privado y Público.</small>'
    );
  }, 45_000);
}

// ── Overlay buttons (connecting phase) ───────────────────────────────────────

document.getElementById('overlay-hide-btn').addEventListener('click', () => {
  remoteViewer.minimizeWindow();
});

document.getElementById('cancel-connect-btn').addEventListener('click', async () => {
  clearTimeout(connectTimer);
  clearTimeout(videoTimer);
  connectTimer = null;
  videoTimer   = null;
  cleanup();
  await remoteViewer.endSession(SESSION_ID).catch(() => {});
  window.close();
});

// ── Toolbar auto-hide ─────────────────────────────────────────────────────────

function showToolbar() {
  toolbar.classList.add('visible');
  clearTimeout(toolbarTimer);
  toolbarTimer = setTimeout(() => toolbar.classList.remove('visible'), 3000);
}
document.addEventListener('mousemove', showToolbar);
document.addEventListener('keydown',   showToolbar);

// ── Incoming signaling ────────────────────────────────────────────────────────

remoteViewer.on('remote:signaling', async msg => {
  if (msg.sessionId !== SESSION_ID) return;
  try {
    if (msg.type === 'REMOTE_SDP' && msg.sdpType === 'offer') {
      // ensureInit() creates the PC exactly once (mutex); concurrent calls
      // all wait on the same Promise and see the same pc when it resolves.
      await ensureInit();

      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      _remoteDescSet = true;

      // Flush ICE candidates that arrived before setRemoteDescription completed
      for (const c of _pendingIce) {
        await pc.addIceCandidate(c).catch(err =>
          console.warn('[remote-viewer] pending ICE error:', err.message));
      }
      _pendingIce = [];

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
      if (!_remoteDescSet) {
        _pendingIce.push(msg.candidate);
      } else if (pc) {
        await pc.addIceCandidate(msg.candidate);
      }
    }
  } catch (err) {
    console.error('[remote-viewer] signaling error:', err);
    showConnectError('Error al establecer conexión WebRTC: ' + err.message);
  }
});

remoteViewer.on('remote:session-ended', () => {
  cleanup();
  if (inputEnabled) {
    window.close();
  } else {
    showConnectError(
      'El equipo remoto terminó la sesión antes de que el vídeo llegara.<br>' +
      'Si es un Mac, verifica que NeuroChat tenga permiso de <strong>Grabación de pantalla</strong>.'
    );
  }
});

// ── Input capture & forwarding ────────────────────────────────────────────────

function sendInput(ev) {
  if (!dc || dc.readyState !== 'open') return;
  try { dc.send(JSON.stringify(ev)); } catch {}
}

// Throttle mousemove to ≤33fps — prevents robotjs backlog on the host that
// makes the cursor feel "sticky" when mouse events arrive faster than they can be executed.
let _lastMouseMove = 0;
video.addEventListener('mousemove', e => {
  if (!inputEnabled) return;
  const now = Date.now();
  if (now - _lastMouseMove < 30) return;
  _lastMouseMove = now;
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

video.setAttribute('tabindex', '0');
video.addEventListener('click',  () => video.focus());
video.addEventListener('keydown', e => {
  if (!inputEnabled) return;
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
  sendInput({ type: 'quality', preset: e.target.value });
});

// ── Toolbar buttons ───────────────────────────────────────────────────────────

document.getElementById('end-btn').addEventListener('click', async () => {
  clearTimeout(connectTimer);
  clearTimeout(videoTimer);
  connectTimer = null;
  videoTimer   = null;
  cleanup();
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

document.getElementById('hide-btn').addEventListener('click', () => {
  remoteViewer.minimizeWindow();
});

// ── Stats ─────────────────────────────────────────────────────────────────────

function startStats() {
  // Clear any existing interval before starting a new one (prevents leaks if
  // called more than once, though _videoActivated guard should prevent that)
  clearInterval(statsInterval);
  statsInterval = setInterval(async () => {
    if (!pc) { clearInterval(statsInterval); return; }
    try {
      const stats = await pc.getStats();
      let fps = 0, bitrate = 0;
      stats.forEach(r => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          fps     = Math.round(r.framesPerSecond || 0);
          bitrate = r.bytesReceived || 0;
        }
      });
      tbStats.textContent = bitrate
        ? `${fps} fps · ${((bitrate * 8) / 1_000_000).toFixed(1)} Mb/s`
        : `${fps} fps`;
    } catch {}
  }, 1000);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanup() {
  clearInterval(statsInterval);
  clearTimeout(toolbarTimer);
  statsInterval  = null;
  toolbarTimer   = null;
  _videoActivated = false;
  _pendingIce     = [];
  _remoteDescSet  = false;
  _initPromise    = null;   // allow re-init if the session is somehow restarted
  if (dc) { try { dc.close(); } catch {} dc = null; }
  if (pc) { try { pc.close(); } catch {} pc = null; }  // null pc AFTER close so
  // no subsequent event handler (oniceconnectionstatechange etc.) can fire on it
}

// ── Boot ──────────────────────────────────────────────────────────────────────
// IMPORTANT: init / ensureInit() is NOT called here. It is called lazily the
// first time the SDP offer arrives via the signaling handler. This eliminates
// the double-init race condition where the offer could arrive while the boot
// init() was suspended inside the async getIceServers() IPC call, causing a
// second RTCPeerConnection to be created and overwriting the first mid-flight.

startConnectTimeout();
showToolbar();
