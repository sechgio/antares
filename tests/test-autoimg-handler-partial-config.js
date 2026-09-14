const assert = require('assert/strict');

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
  const enginePath = require.resolve('../electron/autoimg-sync-engine');
  const windowManagerPath = require.resolve('../electron/window-manager');
  const handlersPath = require.resolve('../electron/autoimg-handlers');

  installMock(sheetsPath, {
    openSpreadsheet: async () => ({ success: true, sheet_id: 'sheet-1', name: 'AutoIMG' }),
  });
  installMock(drivePath, {});
  installMock(enginePath, {
    persistSheetIdConfig: async () => ({
      success: false,
      persisted: false,
      error: 'configuración de solo lectura',
    }),
  });
  installMock(windowManagerPath, { getMainWindow: () => null });
  delete require.cache[handlersPath];

  const { handleAutoimgCall } = require('../electron/autoimg-handlers');
  const response = await handleAutoimgCall('autoimg_sheets_open', { sheet_id: 'sheet-1' });

  assert.equal(response.handled, true);
  assert.equal(response.result.success, true, 'abrir el Sheet sí tuvo éxito');
  assert.equal(response.result.config_persisted, false, 'la persistencia parcial debe ser visible');
  assert.match(response.result.config_error, /solo lectura/);
}

main().catch((error) => {
  console.error('[FAIL]', error);
  process.exitCode = 1;
});
