'use strict';

const params = new URLSearchParams(window.location.search);
const SESSION_ID = params.get('sessionId');
const PEER_NAME = params.get('peerName') || 'Usuario';
const MY_UUID = params.get('myUuid') || '';

// Quality presets: maxBitrate (bps), maxFramerate, scaleResolutionDownBy
const QUALITY = {
  auto: { maxBitrate: undefined, maxFramerate: 30, scale: 1 },
  hd:   { maxBitrate: 8_000_000, maxFramerate: 30, scale: 1 },
  bal:  { maxBitrate: 3_000_000, maxFramerate: 20, scale: 1 },
  perf: { maxBitrate: 1_200_000, maxFramerate: 15, scale: 1.5 },
  low:  { maxBitrate: 600_000,   maxFramerate: 10, scale: 2 },
};

let pc = null;
let dc = null; // DataChannel (receives input from viewer)
let videoSender = null;
let currentQuality = 'auto';
let statsInterval = null;
let startTime = Date.now();

document.getElementById('peer-name').textContent = PEER_NAME;
document.getElementById('end-btn').onclick = async () => {
  await remoteHost.endSession(SESSION_ID);
  window.close();
};

function _showSessionActive() {
  document.getElementById('host-title').textContent = 'Sesión remota activa';
  document.getElementById('rec-dot').style.display = '';
  document.getElementById('host-notice').style.display = 'none';
  document.getElementById('host-peer-line').style.display = '';
  document.getElementById('host-stats').style.display = '';
  document.getElementById('end-btn').textContent = 'Terminar sesión';
}

async function init() {
  // Step 1: get screen source IDs via IPC (main process runs desktopCapturer, which
  // carries the macOS Screen Recording permission check — no OS picker dialog needed).
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

  // Step 2: capture stream using the source ID directly — avoids getDisplayMedia()
  // which can trigger the macOS system picker or hang on Sonoma.
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
          maxFrameRate: 30,
        },
      },
      audio: false,
    });
    if (!stream.getVideoTracks().length) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('getUserMedia: sin tracks de vídeo en el stream.');
    }
  } catch (err) {
    console.error('[remote-host] getUserMedia failed:', err);
    await remoteHost.endSession(SESSION_ID).catch(() => {});
    window.close();
    return;
  }

  _showSessionActive();

  // LAN-only. No STUN needed for same-subnet peers, but including it as fallback
  // helps when the two machines are on different VLANs that still route to each other.
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  // Add video track
  stream.getTracks().forEach(t => {
    const sender = pc.addTrack(t, stream);
    if (t.kind === 'video') videoSender = sender;
  });

  // Create DataChannel for input events from viewer (unreliable = max speed)
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

  // ICE candidates → relay to viewer via WS
  pc.onicecandidate = e => {
    if (!e.candidate) return;
    console.log('[remote-host] ICE candidate:', e.candidate.candidate);
    remoteHost.sendSignaling({
      type: 'REMOTE_ICE',
      sessionId: SESSION_ID,
      toUuid: params.get('peerUuid') || '',
      candidate: e.candidate,
    });
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[remote-host] ICE state:', pc.iceConnectionState);
  };

  // Create and send SDP offer
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
    toUuid: params.get('peerUuid') || '',
    sdp: offer.sdp,
    sdpType: offer.type,
  });

  startTime = Date.now();
  statsInterval = setInterval(updateStats, 1000);
  setInterval(updateDuration, 1000);
}

// Handle incoming signaling (answer + ICE from viewer)
remoteHost.on('remote:signaling', async msg => {
  if (msg.sessionId !== SESSION_ID) return;
  if (!pc) return;
  try {
    if (msg.type === 'REMOTE_SDP' && msg.sdpType === 'answer') {
      await pc.setRemoteDescription({ type: msg.sdpType, sdp: msg.sdp });
    } else if (msg.type === 'REMOTE_ICE' && msg.candidate) {
      await pc.addIceCandidate(msg.candidate);
    }
  } catch (err) {
    console.warn('[remote-host] signaling error:', err.message);
  }
});

remoteHost.on('remote:session-ended', () => {
  cleanup();
  window.close();
});

async function applyQuality(preset) {
  if (!videoSender || !QUALITY[preset]) return;
  currentQuality = preset;
  const q = QUALITY[preset];
  try {
    const params = videoSender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    const enc = params.encodings[0];
    enc.maxBitrate = q.maxBitrate;
    enc.maxFramerate = q.maxFramerate;
    enc.scaleResolutionDownBy = q.scale;
    await videoSender.setParameters(params);
  } catch (err) {
    console.warn('[remote-host] setParameters failed:', err.message);
  }
}

async function updateStats() {
  if (!pc || !videoSender) return;
  try {
    const stats = await pc.getStats(videoSender.track);
    stats.forEach(report => {
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        const fps = Math.round(report.framesPerSecond || 0);
        const bitrate = report.bytesSent
          ? `${((report.bytesSent * 8) / 1_000_000).toFixed(1)} Mb/s`
          : '—';
        document.getElementById('host-fps').textContent = `${fps} fps`;
        document.getElementById('host-bitrate').textContent = bitrate;
      }
    });
  } catch {}
}

function updateDuration() {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  document.getElementById('host-duration').textContent =
    `${m}:${String(sec).padStart(2, '0')}`;
}

function cleanup() {
  clearInterval(statsInterval);
  if (dc) { try { dc.close(); } catch {} }
  if (pc) { try { pc.close(); } catch {} }
}

init().catch(err => console.error('[remote-host] init error:', err));
