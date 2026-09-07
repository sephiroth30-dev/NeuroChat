'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('remoteHost', {
  // Send WebRTC signaling (SDP/ICE) to peer via main process → WS
  sendSignaling: msg => ipcRenderer.send('remote:sendSignaling', msg),

  // Send input event received from DataChannel to main process → robotjs
  executeInput: ev => ipcRenderer.send('remote:executeInput', ev),

  // Get available screen sources (main process → desktopCapturer)
  getScreenSources: () => ipcRenderer.invoke('remote:getScreenSources'),

  // Get ICE server list (includes TURN if configured in settings)
  getIceServers: () => ipcRenderer.invoke('remote:getIceServers'),

  // End this session. reason is forwarded to the viewer so it can explain why
  // the session aborted instead of showing a generic timeout.
  endSession: (sessionId, reason = null) =>
    ipcRenderer.invoke('remote:end', { sessionId, reason }),

  // Minimize (hide) the host notification window without ending the session
  minimizeWindow: () => ipcRenderer.send('remote:minimize'),

  // Listen for incoming WebRTC signaling or session end
  on: (channel, fn) => {
    const allowed = ['remote:signaling', 'remote:session-ended'];
    if (!allowed.includes(channel)) return;
    const listener = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
