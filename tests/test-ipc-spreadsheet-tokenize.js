const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadRouter() {
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
      isReady: () => false,
      waitForReady: async () => false,
      getState: () => 'starting',
      getLastError: () => null,
      getStderrTail: () => '',
      manualRestart: async () => false,
      incrementPendingRequests: () => {},
      decrementPendingRequests: () => {},
      noteJobActivity: () => {},
      clearJobActivity: () => {},
      STATE: { READY: 'ready', FATAL: 'fatal', STARTING: 'starting', EXITED: 'exited' },
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

  const routerPath = require.resolve('../electron/ipc-router');
  delete require.cache[routerPath];
  return require(routerPath);
}

async function main() {
  console.log('Testing spreadsheet spill tokenization...\n');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-spill-tok-'));
  const spillPath = path.join(tmp, 'result.json');
  fs.writeFileSync(spillPath, JSON.stringify({ workbookName: 'x.xlsx', sheets: [{ name: 'S', rows: [['A']] }], warnings: [] }), 'utf8');

  const { _maybeTokenizeResultPaths } = loadRouter();
  assert.strictEqual(typeof _maybeTokenizeResultPaths, 'function');

  const tokenized = _maybeTokenizeResultPaths(
    'spreadsheet_parse',
    {
      workbookName: 'x.xlsx',
      sheets: [],
      warnings: [],
      result_path: spillPath,
      sheet_meta: [{ name: 'S', rowCount: 1 }],
    },
    null,
  );

  assert.ok(tokenized.result_file_token, 'must expose result_file_token');
  assert.ok(
    String(tokenized.result_file_token).startsWith('antares-read'),
    'token must be a read capability',
  );
  assert.strictEqual(tokenized.result_path, undefined, 'absolute result_path must not leak to renderer');
  assert.deepStrictEqual(tokenized.sheets, []);

  const { resolveCapability, revokeCapability } = require('../electron/file-capabilities');
  const spillResolved = resolveCapability(tokenized.result_file_token, 'read', null);
  assert.strictEqual(spillResolved.path, spillPath);
  assert.strictEqual(spillResolved.name, 'spreadsheet-result.json');
  revokeCapability(tokenized.result_file_token);

  const named = _maybeTokenizeResultPaths(
    'informes_v2_export_consolidated_pdf',
    { success: true, filename: 'informe_consolidado.pdf', result_path: spillPath },
    null,
  );
  assert.strictEqual(named.result_path, undefined, 'result_path stripped for named export');
  assert.ok(typeof named.result_file_token === 'string');
  const resolved = resolveCapability(named.result_file_token, 'read', null);
  assert.strictEqual(resolved.path, spillPath);
  assert.strictEqual(resolved.name, 'informe_consolidado.pdf', 'custom filename reaches capability');
  revokeCapability(named.result_file_token);

  const passthrough = { version: '1' };
  assert.strictEqual(_maybeTokenizeResultPaths('version', passthrough, null), passthrough);
  assert.strictEqual(_maybeTokenizeResultPaths('version', null, null), null);
  assert.strictEqual(_maybeTokenizeResultPaths('version', 'string', null), 'string');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('  ✓ spill result_path → result_file_token (path stripped)');
  console.log('\nAll spreadsheet tokenize tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
