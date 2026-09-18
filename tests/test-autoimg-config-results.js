const assert = require('assert/strict');

const { evictModule } = require('./helpers/harness');

function installMock(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
}

async function main() {
  const sheetsPath = require.resolve('../electron/google-sheets-service');
  const drivePath = require.resolve('../electron/google-drive-service');
  const windowManagerPath = require.resolve('../electron/window-manager');
    const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  installMock(sheetsPath, {
    getSheetId: () => 'sheet-1',
    getStoredSheetConfig: () => ({ sheet_id: 'sheet-1', name: 'AutoIMG', linked: true }),
    getAuthStatus: async () => ({ authenticated: true, email: 'user@example.com' }),
    readRange: async () => ({ values: [['Clave', 'Valor']] }),
    readRanges: async () => { throw new Error('estado remoto no disponible'); },
    writeRange: async () => { throw new Error('configuración de solo lectura'); },
  });
  installMock(drivePath, {});
  installMock(windowManagerPath, { getMainWindow: () => null });
  evictModule('electron/autoimg-sync-engine');

  global.setInterval = () => ({ fake: true });
  global.clearInterval = () => {};

  const engine = require('../electron/autoimg-sync-engine');
  try {
    const sheetResult = await engine.persistSheetIdConfig('sheet-1');
    assert.equal(sheetResult.success, false);
    assert.equal(sheetResult.persisted, false);
    assert.match(sheetResult.error, /solo lectura/);

    const autoSyncResult = await engine.setAutoSync(true);
    assert.equal(autoSyncResult.enabled, true);
    assert.equal(autoSyncResult.persisted, false);
    assert.match(autoSyncResult.error, /solo lectura/);

    const status = await engine.getStatus();
    assert.equal(status.connected, true);
    assert.equal(status.stale, true);
    assert.equal(status.error_code, 'STATUS_REFRESH_FAILED');
    assert.match(status.error, /estado remoto no disponible/);
  } finally {
    engine.cleanupAutoSync();
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
}

main().catch((error) => {
  console.error('[FAIL]', error);
  process.exitCode = 1;
});
