const {
  assert, finish, waitFor, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn, installInertTimers,
} = require('./helpers/harness');

async function run() {
  console.log('Testing backend spawner health recovery...\n');

  stubBackendCommand();

  let activeProc = null;
  const spawn = patchSpawn(() => {
    activeProc = makeFakeProc({ pid: 20000 + spawn.count });
    return activeProc;
  });
  const timers = installInertTimers();

  evictModule('electron/backend-spawner.js');
  const {
    startPythonBackend,
    runHealthCheckOnce,
    getHealthStatus,
    getState,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);

    if (activeProc) {
      activeProc.stdin.write = (chunk) => {
        try {
          const msg = JSON.parse(chunk.toString().trim());
          if (msg.id && String(msg.id).startsWith('health-')) {
            const hugePayload = JSON.stringify({
              jsonrpc: '2.0',
              id: 'large-canvas-123',
              result: { layers: new Array(100).fill({ type: 'shape', data: 'x'.repeat(2000) }) },
            });
            activeProc.stdout.emit('data', Buffer.from(hugePayload + '\n'));
            const probeResponse = JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { version: '0.11.9' },
            });
            activeProc.stdout.emit('data', Buffer.from(probeResponse + '\n'));
          }
        } catch {}
      };
    }
    await runHealthCheckOnce();
    assert(spawn.count === 1, 'Responsive backend should not restart when handling concurrent traffic');
    assert(getState() === 'ready', 'Backend should remain in ready state');
    const healthyStatus = getHealthStatus();
    assert(healthyStatus.successes_total === 1, 'Health status counts successful probes');
    assert(typeof healthyStatus.last_success_at === 'string', 'Health status records last successful probe time');
    assert(typeof healthyStatus.last_probe_ms === 'number', 'Health status records probe latency');
    assert(healthyStatus.consecutive_failures === 0, 'Successful probe clears consecutive failures');

    if (activeProc) {
      activeProc.stdin.write = () => {};
    }
    await runHealthCheckOnce();
    assert(spawn.count === 1, 'A single failed probe should not restart the backend');
    assert(getState() === 'ready', 'Backend should remain ready after one failed probe');
    const firstFailureStatus = getHealthStatus();
    assert(firstFailureStatus.consecutive_failures === 1, 'First failed probe records one consecutive failure');

    await runHealthCheckOnce();
    const restarted = await waitFor(() => spawn.count >= 2 && getState() === 'ready');

    assert(restarted, 'Unresponsive backend should restart after consecutive probe failures');
    assert(getState() === 'ready', 'Spawner should return to ready after health recovery');
    const recoveredStatus = getHealthStatus();
    assert(recoveredStatus.failures_total === 2, 'Health status counts failed probes');
    assert(recoveredStatus.last_failure_reason === 'probe_timeout', 'Health status classifies probe timeout');
    assert(recoveredStatus.consecutive_failures === 2, 'Health status preserves failure streak until a probe succeeds');
  } finally {
    killPython();
    spawn.restore();
    timers.restore();
    if (timers.activeInterval) clearInterval(timers.activeInterval);
  }

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
