const { stubModule, evictModule } = require('./harness');

function stubIpcDependencies({ ready = true, electron = {}, backend = {}, windowManager = {} } = {}) {
  stubModule('electron', {
    ipcMain: { handle: () => {}, removeHandler: () => {} },
    dialog: {},
    app: { isPackaged: true },
    ...electron,
  });
  stubModule('electron/backend-spawner', {
    getProcess: () => null,
    isReady: () => ready,
    waitForReady: async () => ready,
    getState: () => ready ? 'ready' : 'starting',
    getLastError: () => null,
    getStderrTail: () => '',
    manualRestart: async () => ready,
    incrementPendingRequests: () => {},
    decrementPendingRequests: () => {},
    noteJobActivity: () => {},
    clearJobActivity: () => {},
    STATE: { READY: 'ready', FATAL: 'fatal', STARTING: 'starting', EXITED: 'exited' },
    ...backend,
  });
  stubModule('electron/window-manager', {
    getMainWindow: () => null,
    getIsDev: () => true,
    ...windowManager,
  });
}

function loadIpcRouter(options) {
  stubIpcDependencies(options);
  evictModule('electron/ipc-router');
  return require('../../electron/ipc-router');
}

module.exports = { loadIpcRouter, stubIpcDependencies };
