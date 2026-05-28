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
let dc = null;
let statsInterval = null;
let toolbarTimer = null;
let connectTimer = null;
let videoTimer = null;    // secondary timer: video must arrive after ICE connects
let iceRestartTimer = null;
let inputEnabled = false;
let iceConnected = false;

// ICE candidates that arrive before setRemoteDescription completes are buffered here
let _pendingIce = [];
let _remoteDescSet = false;

const CONNECT_TIMEOUT_MS  = 45_000;  // 45 s to get ICE + video
const VIDEO_WAIT_AFTER_ICE = 12_000; // extra grace once ICE is 'connected'

// ── Connecting overlay helpers ────────────────────────────────────────────────

function showConnectError(msg) {
  clearTimeout(connectTimer);
  clearTimeout(videoTimer);
  clearTimeout(iceRestartTimer);
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

function setOverlayStatus(text) {
  const msgEl = document.getElementById('overlay-msg');
  if (msgEl && !msgEl.style.color) msgEl.textContent = text;
}

function startConnectTimeout() {
  connectTimer = setTimeout(() => {
    connectTimer = null;
    cleanup();
    showConnectError(
      'No se pudo conectar con <strong>' + PEER_NAME + '</strong>.<br>' +
      'El equipo remoto no respondió a tiempo o el firewall bloqueó la conexión UDP.<br>' +
      '<small style="opacity:.7">Tip: en Windows, permite NeuroChat en el Firewall de Windows Defender.</small>'
    );
    remoteViewer.endSession(SESSION_ID).catch(() => {});
  }, CONNECT_TIMEOUT_MS);
}

// ── Cancel button (visible while connecting) ──────────────────────────────────

document.getElementById('cancel-connect-btn').addEventListener('click', async () => {
  clearTimeout(connectTimer);
  clearTimeout(videoTimer);
  clearTimeout(iceRestartTimer);
  connectTimer = null;
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
document.addEventListener('keydown', showToolbar);

// ── WebRTC setup ──────────────────────────────────────────────────────────────

async function init() {
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

  // Receive remote video track
  pc.ontrack = e => {
    if (e.track.kind === 'video') {
      video.srcObject = e.streams[0];

      const _activateVideo = () => {
        clearTimeout(connectTimer);
        clearTimeout(videoTimer);
        connectTimer = null;
        videoTimer   = null;
        overlay.style.display = 'none';
        inputEnabled = true;
        video.play().catch(() => {});
        startStats();
      };

      video.onloadedmetadata = _activateVideo;
      video.oncanplay        = _activateVideo;  // fallback if metadata fires late
    }
  };

  // Receive DataChannel from host
  pc.ondatachannel = e => {
    dc = e.channel;
    dc.onopen = () => console.log('[remote-viewer] DataChannel open');
  };

  pc.onicegatheringstatechange = () => {
    console.log('[remote-viewer] ICE gathering:', pc.iceGatheringState);
  };

  pc.onconnectionstatechange = () => {
    console.log('[remote-viewer] connection state:', pc.connectionState);
  };

  // ICE candidates → relay to host via WS
  pc.onicecandidate = e => {
    if (!e.candidate) return;
    console.log('[remote-viewer] ICE candidate:', e.candidate.candidate);
    remoteViewer.sendSignaling({
      type: 'REMOTE_ICE',
      sessionId: SESSION_ID,
      toUuid: PEER_UUID,
      candidate: e.candidate,
    });
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log('[remote-viewer] ICE state:', state);

    if (state === 'connected' || state === 'completed') {
      iceConnected = true;
      clearTimeout(iceRestartTimer);
      iceRestartTimer = null;
      setOverlayStatus('ICE conectado — esperando vídeo…');

      // Give extra time for the video track to arrive and render after ICE connects
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
        videoTimer = setTimeout(() => {
          videoTimer = null;
          if (!inputEnabled) {
            cleanup();
            showConnectError(
              'ICE establecido pero el vídeo no llegó desde <strong>' + PEER_NAME + '</strong>.<br>' +
              'Puede que el equipo remoto no tenga permiso de captura de pantalla.<br>' +
              '<small style="opacity:.7">En macOS: Sistema → Privacidad → Grabación de pantalla → activar NeuroChat.</small>'
            );
            remoteViewer.endSession(SESSION_ID).catch(() => {});
          }
        }, VIDEO_WAIT_AFTER_ICE);
      }

    } else if (state === 'disconnected') {
      // Transient — attempt ICE restart after 3 s
      clearTimeout(iceRestartTimer);
      iceRestartTimer = setTimeout(() => {
        if (pc && pc.iceConnectionState === 'disconnected') {
          console.log('[remote-viewer] ICE restart after disconnected');
          try { pc.restartIce(); } catch {}
        }
      }, 3000);

    } else if (state === 'failed') {
      clearTimeout(iceRestartTimer);
      cleanup();
      showConnectError(
        'No se pudo establecer conexión con <strong>' + PEER_NAME + '</strong>.<br>' +
        'ICE falló — ambos equipos deben estar en la misma LAN o necesitas un servidor TURN.<br>' +
        '<small style="opacity:.7">Tip: comprueba que el Firewall de Windows permite el tráfico UDP de NeuroChat.</small>'
      );
      remoteViewer.endSession(SESSION_ID).catch(() => {});
    }
  };
}

// Handle incoming signaling (offer + ICE from host)
remoteViewer.on('remote:signaling', async msg => {
  if (msg.sessionId !== SESSION_ID) return;
  try {
    if (msg.type === 'REMOTE_SDP' && msg.sdpType === 'offer') {
      if (!pc) await init();
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      _remoteDescSet = true;
      // Flush any ICE candidates that arrived before remote description was ready
      for (const c of _pendingIce) {
        await pc.addIceCandidate(c).catch(e => console.warn('[remote-viewer] pending ICE error:', e.message));
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
    console.warn('[remote-viewer] signaling error:', err.message);
    showConnectError('Error al establecer conexión: ' + err.message);
  }
});

remoteViewer.on('remote:session-ended', () => {
  clearTimeout(iceRestartTimer);
  cleanup();
  if (inputEnabled) {
    // Was fully connected — peer ended the session normally
    window.close();
  } else {
    // Ended before video arrived — likely a permission or capture error on the host
    showConnectError(
      'El equipo remoto no pudo iniciar la sesión.<br>' +
      'Si es un Mac, verifica que tiene permiso de <strong>Grabación de pantalla</strong> ' +
      'en Configuración del Sistema → Privacidad y Seguridad, y reinicia NeuroChat.'
    );
  }
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
  clearTimeout(iceRestartTimer);
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
  clearTimeout(iceRestartTimer);
  iceRestartTimer = null;
  if (dc) { try { dc.close(); } catch {} }
  if (pc) { try { pc.close(); } catch {} }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[remote-viewer] init error:', err);
  showConnectError('Error al inicializar: ' + err.message);
});
startConnectTimeout();
showToolbar();
