
function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  } catch {
    /* expected */
  }
}

function main() {
  const { assertAllowedSheetRange } = require('../electron/autoimg-sheet-ranges');
  const drive = require('../electron/google-drive-service');

  assert(assertAllowedSheetRange('BD_IMG!A:M') === 'BD_IMG!A:M', 'BD_IMG!A:M permitido');
  assert(assertAllowedSheetRange('LOGS!A:E') === 'LOGS!A:E', 'LOGS!A:E permitido');
  assert(assertAllowedSheetRange('CONFIG!A:B') === 'CONFIG!A:B', 'CONFIG!A:B permitido');
  assertThrows(
    () => assertAllowedSheetRange('SECRET!A1'),
    'hoja no permitida debe rechazarse',
  );
  assertThrows(
    () => assertAllowedSheetRange('BD_IMG'),
    'rango sin celda debe rechazarse',
  );
  assertThrows(
    () => assertAllowedSheetRange(''),
    'rango vacío debe rechazarse',
  );

  assert(
    drive.assertValidFolderId('1abcDEFghijklmnop') === '1abcDEFghijklmnop',
    'folder id válido aceptado',
  );
  assert(
    drive.assertValidFolderId('https://drive.google.com/drive/folders/1abcDEFghijklmnop')
      === '1abcDEFghijklmnop',
    'URL de carpeta parseada y validada',
  );
  assertThrows(
    () => drive.assertValidFolderId("1abc' OR 1=1"),
    'folder id con comilla debe rechazarse',
  );
  assertThrows(
    () => drive.assertValidFolderId('short'),
    'folder id corto debe rechazarse',
  );

  const sumMap = drive.mergeNisMaps([
    { '4210801': { count: 2, files: [], folders: ['A'] } },
    { '4210801': { count: 1, files: [], folders: ['B'] } },
  ], 'SUM');
  assert(sumMap['4210801'].count === 3, 'mergeNisMaps SUM suma conteos');

  const maxMap = drive.mergeNisMaps([
    { '4210801': { count: 2, files: [], folders: ['A'] } },
    { '4210801': { count: 1, files: [], folders: ['B'] } },
  ], 'MAX');
  assert(maxMap['4210801'].count === 2, 'mergeNisMaps MAX toma el máximo');

  assert(drive.parseDedupStrategy('max') === 'MAX', 'parseDedupStrategy acepta max');
  assert(drive.parseDedupStrategy('') === 'SUM', 'parseDedupStrategy default SUM');

  console.log('[PASS] AutoIMG sheet ranges + folder validation OK.');
}

main();