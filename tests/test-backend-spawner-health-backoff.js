const {
  assert, finish, flushAsyncTurns, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn,
} = require('./helpers/harness');

async function run() {
  console.log('Testing backend health recovery backoff...\n');

  stubBackendCommand();

  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let activeInterval = null;
  const timers = [];

  let lastProc = null;
  const spawn = patchSpawn(() => {
    lastProc = makeFakeProc({ pid: 32000 + spawn.count, closeOnKill: false });
    return lastProc;
  });

  global.setTimeout = (fn, delay, ...args) => {
    const timer = { fn, delay, args, cleared: false };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer && typeof timer === 'object') timer.cleared = true;
    else originalClearTimeout(timer);
  };
  global.setInterval = (fn, delay, ...args) => {
    activeInterval = { fn, delay, args };
    return activeInterval;
  };
  global.clearInterval = (timer) => {
    if (timer === activeInterval) activeInterval = null;
    else originalClearInterval(timer);
  };

  evictModule('electron/backend-spawner.js');
  const {
    startPythonBackend,
    runHealthCheckOnce,
    getState,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    const expectedBackoffs = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
    for (let index = 0; index < expectedBackoffs.length; index++) {
      const activeProc = lastProc;
      activeProc.stdin.write = () => true;

      const recovery = runHealthCheckOnce();
      await flushAsyncTurns(3);
      const probeTimer = timers.find((timer) => timer.delay === 3_000 && !timer.cleared);
      assert(Boolean(probeTimer), `health check ${index + 1} should arm its probe timeout`);
      probeTimer.fn(...probeTimer.args);
      await flushAsyncTurns(3);

      const expectedSpawnCount = index + 1;
      assert(
        spawn.count === expectedSpawnCount,
        `health recovery ${index + 1} must not spawn before recovery backoff`,
      );
      const backoffTimer = timers.find(
        (timer) => timer.delay === expectedBackoffs[index] && !timer.cleared,
      );
      assert(
        Boolean(backoffTimer),
        `health recovery ${index + 1} should use ${expectedBackoffs[index]}ms backoff`,
      );
      assert(getState() === 'starting', `spawner should remain starting during recovery ${index + 1} backoff`);

      backoffTimer.fn(...backoffTimer.args);
      await recovery;
      assert(spawn.count === expectedSpawnCount + 1, `health recovery ${index + 1} should spawn one replacement`);
      assert(getState() === 'ready', `spawner should return to ready after recovery ${index + 1}`);
    }
  } finally {
    killPython();
    spawn.restore();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    if (activeInterval) clearInterval(activeInterval);
  }

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
