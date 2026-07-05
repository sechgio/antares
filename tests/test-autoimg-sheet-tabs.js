/**
 * Regresión: provisión de pestañas AutoIMG y headers de FOLDERS.
 */

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function main() {
  const { AUTOIMG_SHEET_TABS, listMissingAutoImgTabs } = require('../electron/autoimg-sheet-rows');

  const allTabs = Object.keys(AUTOIMG_SHEET_TABS);
  assert(allTabs.length === 6, 'AutoIMG define 6 pestañas requeridas');

  const missingFromBdImgOnly = listMissingAutoImgTabs(['BD_IMG']);
  assert(missingFromBdImgOnly.includes('FOLDERS'), 'FOLDERS falta cuando solo existe BD_IMG');
  assert(!missingFromBdImgOnly.includes('BD_IMG'), 'BD_IMG existente no debe recrearse');
  assert(missingFromBdImgOnly.length === 5, '5 pestañas faltan cuando solo hay BD_IMG');

  const missingWhenComplete = listMissingAutoImgTabs(allTabs);
  assert(missingWhenComplete.length === 0, 'ninguna pestaña falta si todas existen');

  const foldersHeader = AUTOIMG_SHEET_TABS.FOLDERS;
  assert(
    foldersHeader.join('|') === 'NOMBRE|FOLDER_ID|ACTIVO|ULTIMO_SCAN|CANT_ARCHIVOS',
    'headers FOLDERS coinciden con addFolder/removeFolder',
  );

  console.log('[PASS] AutoIMG sheet tabs provisioning OK.');
}

main();
