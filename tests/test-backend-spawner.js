// Regression test for dev-mode startup when Python is resolved from PATH.
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

async function run() {
  console.log('Testing backend spawner PATH fallback...\n');

  const backendCommandPath = require.resolve('../electron/backend-command.js');
  require.cache[backendCommandPath] = {
    id: backendCommandPath,
    filename: backendCommandPath,
    loaded: true,
    exports: {
      getBackendCommand: () => ({
        cmd: 'python',
        args: [path.join(__dirname, '..', 'backend', 'main.py')],
      }),
    },
  };

  const backendSpawnerPath = require.resolve('../electron/backend-spawner.js');
  delete require.cache[backendSpawnerPath];
  const { startPythonBackend, getState, isReady, killPython } = require('../electron/backend-spawner.js');

  await startPythonBackend(true);
  assert(isReady(), 'Dev mode should start with Python resolved from PATH');
  assert(getState() === 'ready', 'Spawner state should become ready');

  killPython();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
