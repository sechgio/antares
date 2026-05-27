// Regression test: preload must allow app-used native IPC methods and reject unknown ones.
const Module = require('module');

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
  console.log('Testing preload IPC allowlist...\n');

  const originalLoad = Module._load;
  let exposedApi = null;
  const invokeCalls = [];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld(_name, api) {
            exposedApi = api;
          },
        },
        ipcRenderer: {
          invoke(method, ...args) {
            invokeCalls.push([method, ...args]);
            return Promise.resolve({ ok: true });
          },
          on() {},
          removeListener() {},
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  global.window = {
    addEventListener() {},
  };

  try {
    delete require.cache[require.resolve('../electron/preload.js')];
    require('../electron/preload.js');

    await exposedApi.invoke('dialog_files');
    assert(invokeCalls[0][0] === 'ipc-call', 'dialog_files should be forwarded through ipc-call');
    assert(invokeCalls[0][1] === 'dialog_files', 'dialog_files should stay allowlisted');

    await exposedApi.invoke('db_columns');
    assert(invokeCalls[1][0] === 'ipc-call', 'db_columns should be forwarded through ipc-call');
    assert(invokeCalls[1][1] === 'db_columns', 'db_columns should stay allowlisted');

    let rejected = false;
    try {
      await exposedApi.invoke('totally_unknown_method');
    } catch (err) {
      rejected = /not allowed/i.test(err.message);
    }
    assert(rejected, 'unknown methods should be rejected');
  } finally {
    Module._load = originalLoad;
    delete global.window;
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
