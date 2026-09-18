const { EventEmitter } = require('events');
const childProcess = require('child_process');

const {
  assert, finish, stubBackendCommand, evictModule, makeFakeProc, patchSpawn,
} = require('./helpers/harness');

async function run() {
  console.log('Testing backend spawner shutdown path...\n');

  stubBackendCommand();

  const originalExecFileSync = childProcess.execFileSync;
  const originalExecFile = childProcess.execFile;
  const originalPlatform = process.platform;
  let syncTaskkillCalls = 0;
  let asyncTaskkillCalls = 0;

  Object.defineProperty(process, 'platform', { value: 'win32' });

  const spawn = patchSpawn(() => makeFakeProc({ pid: 54321 + spawn.count, closeOnKill: false }));

  childProcess.execFileSync = () => {
    syncTaskkillCalls++;
  };
  childProcess.execFile = (_cmd, _args, _opts, callback) => {
    asyncTaskkillCalls++;
    callback?.(null);
    return new EventEmitter();
  };

  evictModule('electron/backend-spawner.js');
  const {
    startPythonBackend,
    killPython,
    manualRestart,
    isReady,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    killPython();

    assert(syncTaskkillCalls === 0, 'Shutdown should not use blocking taskkill');
    assert(asyncTaskkillCalls === 1, 'Shutdown should schedule taskkill asynchronously on Windows');

    const spawnBefore = spawn.count;
    const restarted = await manualRestart(true, { force: true });
    assert(restarted === false, 'manualRestart aborts when shutdown is in progress');
    assert(!isReady(), 'backend stays not-ready after quit + aborted restart');
    assert(spawn.count === spawnBefore, 'manualRestart does not spawn after killPython');
  } finally {
    spawn.restore();
    childProcess.execFileSync = originalExecFileSync;
    childProcess.execFile = originalExecFile;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
