// Regression test for the renderer-authenticated Canvas flush before quit.
const Module = require('module');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function installStub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return { resolved, previous };
}

async function run() {
  console.log('Testing Electron Canvas flush authentication...\n');

  const mainWindow = {
    isDestroyed: () => false,
    webContents: {
      id: 42,
      send: () => {},
      mainFrame: { url: 'http://localhost:5173/', parent: null },
    },
  };
  let quitCalls = 0;
  let killedPython = 0;
  const app = new EventEmitter();
  app.isPackaged = false;
  app.getVersion = () => '0.0.0-test';
  app.whenReady = () => new Promise(() => {});
  app.quit = () => { quitCalls += 1; };

  const ipcHandlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      ipcHandlers.set(channel, handler);
    },
  };
  const electronMock = {
    app,
    BrowserWindow: { getAllWindows: () => [] },
    Menu: { setApplicationMenu: () => {} },
    ipcMain,
  };

  const stubs = [
    installStub('../electron/window-manager.js', {
      createWindow: () => {},
      getMainWindow: () => mainWindow,
    }),
    installStub('../electron/backend-spawner.js', {
      startPythonBackend: async () => {},
      killPython: () => { killedPython += 1; },
    }),
    installStub('../electron/ipc-router.js', { registerIpcHandlers: () => {} }),
    installStub('../electron/renderer-observability.js', { registerRendererObservability: () => {} }),
    installStub('../electron/app-log.js', {
      appendLogEvent: () => {},
      appendLogLine: () => {},
      cleanStaleTempDirs: () => 0,
      initAppLogs: () => 'test-logs',
      installConsoleLogTee: () => {},
      setAppContext: () => {},
    }),
    installStub('../electron/file-capabilities.js', { cleanupAllStaged: async () => {} }),
    installStub('../electron/autoimg-sync-engine.js', { cleanupAutoSync: () => {} }),
    installStub('../electron/auto-updater.js', {
      cleanupAutoUpdater: () => {},
      setupAutoUpdater: () => {},
    }),
  ];
  const mainPath = require.resolve('../electron/main.js');
  const previousMain = require.cache[mainPath];
  const originalLoad = Module._load;
  const processEvents = ['unhandledRejection', 'exit', 'SIGINT', 'SIGTERM'];
  const previousProcessListeners = new Map(
    processEvents.map((event) => [event, process.listeners(event)]),
  );

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[mainPath];
    require('../electron/main.js');

    const flushAck = ipcHandlers.get('canvas-flush-ack');
    const beforeQuit = app.listeners('before-quit')[0];
    assert(typeof flushAck === 'function', 'canvas flush ACK handler is registered');
    assert(typeof beforeQuit === 'function', 'before-quit handler is registered');

    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
    const timeoutMatch = mainSource.match(/const CANVAS_FLUSH_TIMEOUT_MS = (\d+);/);
    assert(
      timeoutMatch && Number(timeoutMatch[1]) >= 100_000,
      'flush grace period must outlive the renderer IPC save backstop',
    );

    let prevented = 0;
    const quitPromise = beforeQuit({ preventDefault: () => { prevented += 1; } });
    beforeQuit({ preventDefault: () => { prevented += 1; } });
    const rejected = await flushAck({
      sender: { id: 99, mainFrame: { url: 'http://localhost:5173/', parent: null } },
      senderFrame: { url: 'http://localhost:5173/', parent: null },
    });

    assert(rejected.ok === false, 'ACK from a different renderer is rejected');
    assert(prevented === 2, 'repeated quit requests remain deferred while the flush is pending');
    assert(quitCalls === 0, 'untrusted ACK cannot trigger app quit');

    const wrongOriginFrame = { url: 'file:///C:/evil.html', parent: null };
    const wrongOrigin = await flushAck({
      sender: { id: mainWindow.webContents.id, mainFrame: wrongOriginFrame },
      senderFrame: wrongOriginFrame,
    });
    assert(wrongOrigin.ok === false, 'ACK from the main renderer with an untrusted origin is rejected');
    assert(quitCalls === 0, 'wrong-origin ACK cannot trigger app quit');

    const accepted = await flushAck({
      sender: { id: mainWindow.webContents.id, mainFrame: mainWindow.webContents.mainFrame },
      senderFrame: mainWindow.webContents.mainFrame,
    });
    await quitPromise;
    assert(accepted.ok === true, 'ACK from the main renderer is accepted');
    assert(quitCalls === 1, 'accepted ACK allows deferred quit to complete');
    assert(killedPython === 1, 'shutdown is run exactly once');
  } finally {
    Module._load = originalLoad;
    if (previousMain) require.cache[mainPath] = previousMain;
    else delete require.cache[mainPath];
    for (const { resolved, previous } of stubs) {
      if (previous) require.cache[resolved] = previous;
      else delete require.cache[resolved];
    }
    for (const event of processEvents) {
      const keep = new Set(previousProcessListeners.get(event));
      for (const listener of process.listeners(event)) {
        if (!keep.has(listener)) process.removeListener(event, listener);
      }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
