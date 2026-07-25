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

function loadPreload({ packaged = false, allowedMethods } = {}) {
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
        webUtils: { getPathForFile: () => '' },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  global.window = { addEventListener() {} };
  process.env.NODE_ENV = packaged ? 'production' : 'development';
  const allowedArg = `--allowed-ipc-methods=${JSON.stringify(allowedMethods || ['dialog_files', 'db_columns'])}`;
  const packagedArg = `--app-is-packaged=${packaged ? '1' : '0'}`;
  const prevArgv = process.argv;
  process.argv = [process.argv[0], allowedArg, packagedArg];

  try {
    delete require.cache[require.resolve('../electron/preload.js')];
    require('../electron/preload.js');
    return { exposedApi, invokeCalls };
  } finally {
    process.argv = prevArgv;
    Module._load = originalLoad;
    delete global.window;
  }
}

async function run() {
  console.log('Testing preload IPC allowlist...\n');

  {
    const { exposedApi, invokeCalls } = loadPreload({ packaged: false });
    await exposedApi.invoke('dialog_files');
    assert(invokeCalls[0][0] === 'ipc-call', 'dialog_files should be forwarded through ipc-call');
    assert(invokeCalls[0][1] === 'dialog_files', 'dialog_files should stay allowlisted');

    invokeCalls.length = 0;
    await exposedApi.invoke('db_columns');
    assert(invokeCalls[0][1] === 'db_columns', 'db_columns should stay allowlisted');

    invokeCalls.length = 0;
    await exposedApi.invoke('totally_unknown_method');
    assert(invokeCalls[0][0] === 'ipc-call', 'unknown methods should still be forwarded in dev');
    assert(invokeCalls[0][1] === 'totally_unknown_method', 'unknown method name should be preserved in dev');
  }

  {
    const { exposedApi, invokeCalls } = loadPreload({ packaged: true });
    let rejected = false;
    try {
      await exposedApi.invoke('totally_unknown_method');
    } catch (err) {
      rejected = /not allowed/i.test(err.message);
    }
    assert(rejected, 'packaged builds should hard-reject unknown IPC methods');
    assert(invokeCalls.length === 0, 'rejected methods should not reach ipcRenderer.invoke');
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
