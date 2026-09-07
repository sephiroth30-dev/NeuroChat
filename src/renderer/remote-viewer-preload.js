'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('remoteViewer', {
  // Send WebRTC signaling (SDP/ICE) to peer via main process → WS
  sendSignaling: msg => ipcRenderer.send('remote:sendSignaling', msg),

  // Get ICE server list (includes TURN if configured in settings)
  getIceServers: () => ipcRenderer.invoke('remote:getIceServers'),

  // End this session. keepWindow: true tears down the session but leaves this
  // window open so an error message stays readable.
  endSession: (sessionId, keepWindow = false) =>
    ipcRenderer.invoke('remote:end', { sessionId, keepWindow }),

  // Close this window (used after the session is already gone)
  closeWindow: () => ipcRenderer.send('remote:closeWindow'),

  // Minimize (hide) the viewer window without ending the session
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
