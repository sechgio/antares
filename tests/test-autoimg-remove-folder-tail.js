const path = require('path');

const { assertOrExit: assert, evictModule } = require('./helpers/harness');

function installMock(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
}

const HEADER = ['NOMBRE', 'FOLDER_ID', 'ACTIVO', 'ULTIMO_SCAN', 'CANT_ARCHIVOS'];

// Hoja de trabajo que imita spreadsheets.values.update: solo se reemplazan las
// filas del rango enviado, las que siguen quedan intactas.
function makeSheet(initialRows) {
  let rows = initialRows.map((row) => row.slice());

  function visible() {
    const out = rows.map((row) => row.slice());
    while (out.length && out[out.length - 1].every((cell) => cell === '')) out.pop();
    return out;
  }

  return {
    visible,
    writeRange(range, values) {
      const match = /A(\d+):E\d+/.exec(String(range));
      const startRow = match ? Number(match[1]) - 1 : 0;
      for (let i = 0; i < values.length; i += 1) {
        rows[startRow + i] = values[i].slice();
      }
      for (let i = 0; i < rows.length; i += 1) {
        if (!rows[i]) rows[i] = new Array(HEADER.length).fill('');
      }
      return { success: true };
    },
  };
}

async function main() {
  const sheetsPath = require.resolve('../electron/google-sheets-service');
  const drivePath = require.resolve('../electron/google-drive-service');
  const wmPath = require.resolve('../electron/window-manager');

  const sheet = makeSheet([
    HEADER,
    ['JUAN', 'folder-juan', '✅', '2026-07-03', '12'],
    ['PEDRO', 'folder-pedro', '✅', '2026-07-03', '7'],
    ['ANA', 'folder-ana', '✅', '2026-07-03', '3'],
  ]);

  installMock(sheetsPath, {
    getSheetId: () => 'sheet-1',
    getStoredSheetConfig: () => ({ sheet_id: 'sheet-1', name: 'AutoIMG', linked: true }),
    getAuthStatus: async () => ({ authenticated: true, email: 'u@x.com' }),
    readRange: async (range) => {
      if (String(range).startsWith('FOLDERS')) return { values: sheet.visible() };
      return { values: [] };
    },
    writeRange: async (range, values) => sheet.writeRange(range, values),
    appendRow: async () => ({ success: true }),
    batchWriteRanges: async (updates) => {
      for (const update of updates) sheet.writeRange(update.range, update.values);
      return { success: true };
    },
    batchReadRanges: async () => ({}),
  });

  installMock(drivePath, {
    assertDriveFolder: async (folder_id) => ({ folder_id, name: folder_id.toUpperCase() }),
  });

  installMock(wmPath, { getMainWindow: () => null });

  evictModule('electron/autoimg-sync-engine');
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}electron${path.sep}autoimg-`)) {
      delete require.cache[key];
    }
  }

  const engine = require('../electron/autoimg-sync-engine');

  await engine.removeFolder({ folder_id: 'folder-pedro' });

  const remaining = sheet.visible().slice(1).filter((row) => row[1]).map((row) => row[1]);
  assert(
    !remaining.includes('folder-pedro'),
    `removeFolder debe sacar la fila de la hoja (quedó: ${remaining.join(',')})`,
  );

  const listed = await engine.listFolders({ force: true });
  const ids = listed.folders.map((f) => f.folder_id);
  assert(
    ids.length === 2 && ids.includes('folder-juan') && ids.includes('folder-ana'),
    `tras borrar PEDRO deben quedar JUAN y ANA sin duplicados (got ${ids.join(',')})`,
  );

  console.log('[PASS] AutoIMG removeFolder limpia el remanente de la hoja.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
