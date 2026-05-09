'use strict';

// Manual mock for the 'electron' package — used by Jest via moduleNameMapper.
// Provides enough surface area for all modules under src/main/.

const BrowserWindow = {
  getAllWindows: jest.fn(() => []),
};

const app = {
  getPath: jest.fn(() => require('os').tmpdir()),
  getVersion: jest.fn(() => '0.0.0-test'),
  on: jest.fn(),
  quit: jest.fn(),
  requestSingleInstanceLock: jest.fn(() => true),
};

const nativeTheme = {
  themeSource: 'system',
  shouldUseDarkColors: false,
  on: jest.fn(),
};

const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeAllListeners: jest.fn(),
};

const shell = { openExternal: jest.fn(), openPath: jest.fn() };
const dialog = { showOpenDialog: jest.fn() };

const Tray = jest.fn(() => ({
  setToolTip: jest.fn(),
  setContextMenu: jest.fn(),
  on: jest.fn(),
  destroy: jest.fn(),
}));

const Menu = { buildFromTemplate: jest.fn(() => ({})) };

const nativeImage = {
  createFromPath: jest.fn(() => ({})),
  createEmpty: jest.fn(() => ({})),
};

const Notification = Object.assign(jest.fn(() => ({ on: jest.fn(), show: jest.fn() })), {
  isSupported: jest.fn(() => true),
});

module.exports = {
  BrowserWindow,
  app,
  nativeTheme,
  ipcMain,
  shell,
  dialog,
  Tray,
  Menu,
  nativeImage,
  Notification,
};
