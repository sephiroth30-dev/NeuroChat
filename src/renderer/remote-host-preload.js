'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('remoteHost', {
  // Send WebRTC signaling (SDP/ICE) to peer via main process → WS
  sendSignaling: msg => ipcRenderer.send('remote:sendSignaling', msg),

  // Send input event received from DataChannel to main process → robotjs
  executeInput: ev => ipcRenderer.send('remote:executeInput', ev),

  // End this session
  endSession: sessionId => ipcRenderer.invoke('remote:end', { sessionId }),

  // Listen for incoming WebRTC signaling or session end
  on: (channel, fn) => {
    const allowed = ['remote:signaling', 'remote:session-ended'];
    if (!allowed.includes(channel)) return;
    const listener = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
