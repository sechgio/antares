// Mock electron module for testing
const path = require('path');

const mockApp = {
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  quit: () => {},
  on: () => {},
  getVersion: () => '1.0.0'
};

const mockBrowserWindow = function (opts) {
  return {
    loadURL: () => {},
    loadFile: () => {},
    webContents: {
      openDevTools: () => {},
      send: () => {},
    },
    maximize: () => {},
    show: () => {},
    on: () => {},
    once: () => {},
    isDestroyed: () => false,
  };
};

const mockIpcMain = {
  handle: () => {},
  on: () => {},
};

const mockDialog = {
  showErrorBox: () => {},
};

const mockAutoUpdater = {
  checkForUpdates: () => {},
  on: () => {},
  quitAndInstall: () => {},
};

module.exports = {
  app: mockApp,
  BrowserWindow: mockBrowserWindow,
  ipcMain: mockIpcMain,
  dialog: mockDialog,
  autoUpdater: mockAutoUpdater,
};
