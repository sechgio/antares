// Regression: late close from a replaced backend must not detach the live process.
const { EventEmitter } = require('events');
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

function makeFakeProc(pid) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  proc.killed = false;
  proc.pid = pid;
  proc.kill = () => {
    proc.killed = true;
  };
  return proc;
}

function loadIpcRouter({ currentProc, clearJobActivity }) {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      ipcMain: { handle: () => {}, removeHandler: () => {} },
      dialog: {},
      app: { isPackaged: true },
    },
  };

  const spawnerPath = require.resolve('../electron/backend-spawner');
  require.cache[spawnerPath] = {
    id: spawnerPath,
    filename: spawnerPath,
    loaded: true,
    exports: {
      getProcess: () => currentProc.ref,
      isReady: () => true,
      waitForReady: async () => true,
      getState: () => 'ready',
      getLastError: () => null,
      getStderrTail: () => '',
      manualRestart: async () => true,
      incrementPendingRequests: () => {},
      decrementPendingRequests: () => {},
      noteJobActivity: () => {},
      clearJobActivity,
      STATE: { READY: 'ready' },
    },
  };

  const wmPath = require.resolve('../electron/window-manager');
  require.cache[wmPath] = {
    id: wmPath,
    filename: wmPath,
    loaded: true,
    exports: {
      getMainWindow: () => null,
      buildAppMenu: () => ({ popup: () => {} }),
      getIsDev: () => true,
    },
  };

  // Bust ipc-router cache so mocks apply.
  const routerPath = require.resolve('../electron/ipc-router');
  delete require.cache[routerPath];
  return require(routerPath);
}

function run() {
  console.log('Testing ipc-router process close identity...\n');

  const currentProc = { ref: null };
  let clearCalls = 0;
  const { _ensureListeners } = loadIpcRouter({
    currentProc,
    clearJobActivity: () => {
      clearCalls++;
    },
  });

  const procA = makeFakeProc(1001);
  const procB = makeFakeProc(1002);

  currentProc.ref = procA;
  assert(_ensureListeners() === true, 'attach listeners to process A');
  assert(procA.listenerCount('close') === 1, 'process A has one close listener');

  currentProc.ref = procB;
  assert(_ensureListeners() === true, 'attach listeners to process B');
  assert(procB.listenerCount('close') === 1, 'process B has one close listener');

  // Late close from A must not clear attachment for B.
  clearCalls = 0;
  procA.emit('close', 1, null);
  assert(clearCalls === 0, 'late close of A does not clear job activity');

  // Re-ensure should still see B as attached (no second close listener).
  assert(_ensureListeners() === true, 'ensureListeners still true for B after A close');
  assert(procB.listenerCount('close') === 1, 'process B still has exactly one close listener');

  // Close of current attached process B should clear job activity once.
  clearCalls = 0;
  procB.emit('close', 0, null);
  assert(clearCalls === 1, 'close of attached process clears job activity');

  // After B dies, ensureListeners re-attaches when a new process appears.
  const procC = makeFakeProc(1003);
  currentProc.ref = procC;
  assert(_ensureListeners() === true, 're-attach after real death');
  assert(procC.listenerCount('close') === 1, 'process C has one close listener');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
