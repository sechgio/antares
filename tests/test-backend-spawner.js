const path = require('path');

const { assert, finish, stubBackendCommand, evictModule } = require('./helpers/harness');

async function run() {
  console.log('Testing backend spawner PATH fallback...\n');

  stubBackendCommand({
    getBackendCommand: () => ({
      cmd: 'python',
      args: [path.join(__dirname, '..', 'backend', 'main.py')],
    }),
  });

  evictModule('electron/backend-spawner.js');
  const { startPythonBackend, getState, isReady, killPython } = require('../electron/backend-spawner.js');

  await startPythonBackend(true);
  assert(isReady(), 'Dev mode should start with Python resolved from PATH');
  assert(getState() === 'ready', 'Spawner state should become ready');

  killPython();

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
