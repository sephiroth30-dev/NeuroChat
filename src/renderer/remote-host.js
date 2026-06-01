'use strict';

const params = new URLSearchParams(window.location.search);
const SESSION_ID  = params.get('sessionId');
const PEER_NAME   = params.get('peerName') || 'Usuario';
const MY_UUID     = params.get('myUuid')   || '';
const PEER_UUID   = params.get('peerUuid') || '';

// Quality presets: maxBitrate (bps), maxFramerate, scaleResolutionDownBy
const QUALITY = {
  auto: { maxBitrate: undefined, maxFramerate: 30, scale: 1 },
  hd:   { maxBitrate: 8_000_000, maxFramerate: 30, scale: 1 },
  bal:  { maxBitrate: 3_000_000, maxFramerate: 20, scale: 1 },
  perf: { maxBitrate: 1_200_000, maxFramerate: 15, scale: 1.5 },
  low:  { maxBitrate: 600_000,   maxFramerate: 10, scale: 2 },
};

let pc            = null;
let dc            = null;   // DataChannel (receives input from viewer)
let _stream       = null;   // keep a module-level ref so the stream is never GC'd
let videoSender   = null;
let statsInterval = null;
let startTime     = Date.now();

// ICE candidates from viewer arriving before setRemoteDescription(answer) completes
let _pendingIce    = [];
let _remoteDescSet = false;

document.getElementById('peer-name').textContent = PEER_NAME;
document.getElementById('end-btn').onclick = async () => {
  await remoteHost.endSession(SESSION_ID);
  window.close();
};
document.getElementById('hide-btn').onclick = () => remoteHost.minimizeWindow();

function _showSessionActive() {
  document.getElementById('host-title').textContent = 'Sesión remota activa';
  document.getElementById('rec-dot').style.display = '';
  document.getElementById('host-notice').style.display = 'none';
  document.getElementById('host-peer-line').style.display = '';
  document.getElementById('host-stats').style.display = '';
  document.getElementById('end-btn').textContent = 'Terminar sesión';
}

async function init() {
  // ── Step 1: get screen source IDs via IPC ─────────────────────────────────
  let sources;
  try {
    sources = await remoteHost.getScreenSources();
  } catch (err) {
    console.error('[remote-host] getScreenSources failed:', err);
    sources = [];
  }

  if (!sources?.length) {
    console.error('[remote-host] No screen sources — Screen Recording permission denied');
    await remoteHost.endSession(SESSION_ID).catch(() => {});
    window.close();
    return;
  }

  // ── Step 2: capture screen stream ────────────────────────────────────────
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
          maxFrameRate: 30,
        },
      },
      audio: false,
    });
    if (!_stream.getVideoTracks().length) {
      _stream.getTracks().forEach(t => t.stop());
      _stream = null;
      throw new Error('getUserMedia: sin tracks de vídeo en el stream.');
    }
  } catch (err) {
    console.error('[remote-host] getUserMedia failed:', err);
    await remoteHost.endSession(SESSION_ID).catch(() => {});
    window.close();
    return;
  }

  _showSessionActive();

  // ── Step 3: build RTCPeerConnection ───────────────────────────────────────
  const iceServers = await remoteHost.getIceServers().catch(() => [
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

  // Add video track — stored module-level to prevent GC
  _stream.getTracks().forEach(t => {
    const sender = pc.addTrack(t, _stream);
    if (t.kind === 'video') videoSender = sender;
  });

  // DataChannel for input events (unreliable = lowest latency)
  dc = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
  dc.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'quality') {
        applyQuality(msg.preset);
      } else {
        remoteHost.executeInput(msg);
      }
    } catch {}
  };

  // ── ICE handlers ─────────────────────────────────────────────────────────
  // Use .toJSON() for safe serialization through Electron IPC; RTCIceCandidate
  // DOM objects are not guaranteed to serialize their properties via structuredClone.
  pc.onicecandidate = e => {
    if (!e.candidate) return;
    console.log('[remote-host] ICE candidate:', e.candidate.candidate.slice(0, 80));
    remoteHost.sendSignaling({
      type: 'REMOTE_ICE',
      sessionId: SESSION_ID,
      toUuid: PEER_UUID,
      candidate: e.candidate.toJSON(),
    });
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log('[remote-host] ICE state:', state);

    if (state === 'connected' || state === 'completed') {
      _showSessionActive();

    } else if (state === 'disconnected') {
      // Transient — WebRTC self-recovery; do not terminate
      console.log('[remote-host] ICE disconnected (transient — waiting for recovery)');

    } else if (state === 'failed') {
      // Permanent failure — notify viewer so it can show the error, then clean up
      console.error('[remote-host] ICE failed — ending session');
      remoteHost.endSession(SESSION_ID).catch(() => {});
      window.close();
    }
  };

  pc.onicegatheringstatechange = () =>
    console.log('[remote-host] ICE gathering:', pc.iceGatheringState);

  pc.onconnectionstatechange = () =>
    console.log('[remote-host] connection state:', pc.connectionState);

  // ── onnegotiationneeded: handles ICE-restart re-offers ONLY ───────────────
  // The initial offer is created manually below. When pc.restartIce() is called
  // after ICE failure, this handler fires (because _remoteDescSet is true by then)
  // and creates a new offer, restarting ICE credentials on both sides.
  pc.onnegotiationneeded = async () => {
    // Skip initial negotiation — handled manually; only act on renegotiation
    if (!_remoteDescSet) return;
    if (!pc || pc.signalingState !== 'stable') return;
    try {
      const offer = await pc.createOffer();
      // Re-check state after the async createOffer() — another negotiation might
      // have started in the meantime
      if (!pc || pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      remoteHost.sendSignaling({
        type: 'REMOTE_SDP',
        sessionId: SESSION_ID,
        toUuid: PEER_UUID,
        sdp: offer.sdp,
        sdpType: offer.type,
      });
      console.log('[remote-host] Re-offer sent (ICE restart)');
    } catch (err) {
      console.warn('[remote-host] onnegotiationneeded error:', err.message);
    }
  };

  // ── Step 4: create and send SDP offer ────────────────────────────────────
  let offer;
  try {
    offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
  } catch (err) {
    console.error('[remote-host] createOffer failed:', err);
    await remoteHost.endSession(SESSION_ID).catch(() => {});
    window.close();
    return;
  }

  remoteHost.sendSignaling({
    type: 'REMOTE_SDP',
    sessionId: SESSION_ID,
    toUuid: PEER_UUID,
    sdp: offer.sdp,
    sdpType: offer.type,
  });

  startTime = Date.now();
  statsInterval = setInterval(updateStats, 1000);
  setInterval(updateDuration, 1000);
}

// ── Incoming signaling (answer + ICE from viewer) ─────────────────────────────

remoteHost.on('remote:signaling', async msg => {
  if (msg.sessionId !== SESSION_ID) return;
  if (!pc) return;
  try {
    if (msg.type === 'REMOTE_SDP' && msg.sdpType === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      _remoteDescSet = true;
      for (const c of _pendingIce) {
        await pc.addIceCandidate(c).catch(err =>
          console.warn('[remote-host] pending ICE error:', err.message));
      }
      _pendingIce = [];

    } else if (msg.type === 'REMOTE_ICE' && msg.candidate) {
      if (!_remoteDescSet) {
        _pendingIce.push(msg.candidate);
      } else {
        await pc.addIceCandidate(msg.candidate);
      }
    }
  } catch (err) {
    console.warn('[remote-host] signaling error:', err.message);
  }
});

remoteHost.on('remote:session-ended', () => {
  cleanup();
  window.close();
});

// ── Quality control ───────────────────────────────────────────────────────────

async function applyQuality(preset) {
  if (!videoSender || !QUALITY[preset]) return;
  const q = QUALITY[preset];
  try {
    const params = videoSender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    const enc = params.encodings[0];
    enc.maxBitrate         = q.maxBitrate;
    enc.maxFramerate       = q.maxFramerate;
    enc.scaleResolutionDownBy = q.scale;
    await videoSender.setParameters(params);
  } catch (err) {
    console.warn('[remote-host] setParameters failed:', err.message);
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function updateStats() {
  if (!pc || !videoSender) return;
  try {
    const stats = await pc.getStats(videoSender.track);
    stats.forEach(report => {
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        const fps     = Math.round(report.framesPerSecond || 0);
        const bitrate = report.bytesSent
          ? `${((report.bytesSent * 8) / 1_000_000).toFixed(1)} Mb/s`
          : '—';
        document.getElementById('host-fps').textContent     = `${fps} fps`;
        document.getElementById('host-bitrate').textContent = bitrate;
      }
    });
  } catch {}
}

function updateDuration() {
  const s   = Math.floor((Date.now() - startTime) / 1000);
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  document.getElementById('host-duration').textContent =
    `${m}:${String(sec).padStart(2, '0')}`;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanup() {
  clearInterval(statsInterval);
  statsInterval  = null;
  _pendingIce    = [];
  _remoteDescSet = false;
  if (_stream) {
    try { _stream.getTracks().forEach(t => t.stop()); } catch {}
    _stream = null;
  }
  if (dc) { try { dc.close(); } catch {} dc = null; }
  if (pc) { try { pc.close(); } catch {} pc = null; } // null AFTER close so
  // onnegotiationneeded / oniceconnectionstatechange cannot re-fire after cleanup
}

init().catch(err => console.error('[remote-host] init error:', err));
