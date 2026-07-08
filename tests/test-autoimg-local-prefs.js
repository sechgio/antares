/**
 * Preferencias locales por usuario: Sheet/carpetas no se borran al limpiar tokens.
 */

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

const scope = require('../electron/autoimg-user-scope');
const prefs = require('../electron/autoimg-local-prefs');
const sheetsStore = require('../electron/autoimg-sheet-storage');
const tokens = require('../electron/autoimg-token-storage');

scope.clearActiveUser();
scope.setActiveUser('prefs-test@example.com');

prefs.saveLocalFolders([
  { name: 'A', folder_id: 'folderAAA111', activo: true, ultimo_scan: '', cant_archivos: 3 },
  { name: 'B', folder_id: 'folderBBB222', activo: false, ultimo_scan: '', cant_archivos: 0 },
]);
prefs.saveRenameDest('rootFOLDER999', 'Raiz export');

const loaded = prefs.loadLocalFolders();
assert(loaded.length === 2, 'guarda 2 carpetas');
assert(loaded[0].folder_id === 'folderAAA111', 'folder id A');

sheetsStore.saveSheetConfig('199VwTc4WCVuFfNN93UTI8wVxDvoMT4KzqNm6s_AsXPk', 'BD test');
assert(sheetsStore.loadSheetConfig().sheet_id.startsWith('199VwTc4'), 'sheet id persistido');

tokens.saveTokens({ access_token: 'x', refresh_token: 'y', expiry_date: Date.now() });
tokens.clearTokens();
assert(!tokens.loadTokens(), 'tokens limpios');
assert(sheetsStore.loadSheetConfig().sheet_id.startsWith('199VwTc4'), 'sheet sobrevive clearTokens');
assert(prefs.loadLocalFolders().length === 2, 'carpetas sobreviven clearTokens');
assert(prefs.loadRenameDest().folder_id === 'rootFOLDER999', 'rename dest sobrevive clearTokens');

// Sin usuario activo no se exponen datos de perfil
scope.clearActiveUser();
assert(!sheetsStore.loadSheetConfig().sheet_id, 'sin usuario no expone sheet');
assert(prefs.loadLocalFolders().length === 0, 'sin usuario no expone carpetas');

// revokeAuth no limpia sheet del usuario
const sheetsSvcPath = path.join(__dirname, '..', 'electron', 'google-sheets-service.js');
const src = fs.readFileSync(sheetsSvcPath, 'utf8');
const revokeBody = src.slice(src.indexOf('async function revokeAuth'), src.indexOf('async function _apiFetch'));
assert(revokeBody.includes('clearActiveUser'), 'revoke limpia usuario activo');
assert(!revokeBody.includes('clearSheetConfig()'), 'revokeAuth no debe llamar clearSheetConfig');

console.log('[PASS] autoimg local prefs + sheet persistence');
