const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function stubElectronAndDeps() {
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
      getProcess: () => null,
      isReady: () => true,
      waitForReady: async () => true,
      getState: () => 'ready',
      getLastError: () => null,
      getStderrTail: () => '',
      manualRestart: async () => true,
      incrementPendingRequests: () => {},
      decrementPendingRequests: () => {},
      noteJobActivity: () => {},
      clearJobActivity: () => {},
      STATE: { READY: 'ready', FATAL: 'fatal', STARTING: 'starting', EXITED: 'exited' },
    },
  };
}

async function run() {
  stubElectronAndDeps();
  const { _maybeTokenizeResultPaths } = require('../electron/ipc-router');
  const { resolveCapability, revokeCapability } = require('../electron/file-capabilities');

  const tmpFile = path.join(os.tmpdir(), `antares-test-tokenize-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify({ ok: true, data: [1, 2, 3] }));

  try {
    {
      const rawResult = {
        workbookName: 'test.xlsx',
        result_path: tmpFile,
        sheets: [],
      };
      const tokenized = _maybeTokenizeResultPaths('spreadsheet_parse', rawResult, null);

      assert.strictEqual(tokenized.workbookName, 'test.xlsx');
      assert.strictEqual(tokenized.result_path, undefined, 'result_path must be stripped');
      assert.ok(typeof tokenized.result_file_token === 'string', 'result_file_token must be a string');
      assert.ok(tokenized.result_file_token.startsWith('antares-'), 'token must start with antares-');

      const resolved = resolveCapability(tokenized.result_file_token, 'read', null);
      assert.strictEqual(resolved.path, tmpFile);
      assert.strictEqual(resolved.name, 'spreadsheet-result.json');
      revokeCapability(tokenized.result_file_token);
    }

    {
      const rawResult = {
        success: true,
        filename: 'informe_consolidado.pdf',
        result_path: tmpFile,
      };
      const tokenized = _maybeTokenizeResultPaths('informes_v2_export_consolidated_pdf', rawResult, null);

      assert.strictEqual(tokenized.success, true);
      assert.strictEqual(tokenized.result_path, undefined, 'result_path must be stripped');
      assert.ok(typeof tokenized.result_file_token === 'string');

      const resolved = resolveCapability(tokenized.result_file_token, 'read', null);
      assert.strictEqual(resolved.path, tmpFile);
      assert.strictEqual(resolved.name, 'informe_consolidado.pdf');
      revokeCapability(tokenized.result_file_token);
    }

    {
      const passthrough = { count: 42 };
      assert.strictEqual(_maybeTokenizeResultPaths('any_method', passthrough, null), passthrough);
      assert.strictEqual(_maybeTokenizeResultPaths('any_method', null, null), null);
      assert.strictEqual(_maybeTokenizeResultPaths('any_method', 'string', null), 'string');
    }

    console.log('✓ All IPC result tokenize tests passed');
  } finally {
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
