
const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

const scope = require('../electron/autoimg-user-scope');
const store = require('../electron/autoimg-user-store');

scope.clearActiveUser();
scope.setActiveUser('prefs-test@example.com');

store.saveLocalFolders([
  { name: 'A', folder_id: 'folderAAA111', activo: true, ultimo_scan: '', cant_archivos: 3 },
  { name: 'B', folder_id: 'folderBBB222', activo: false, ultimo_scan: '', cant_archivos: 0 },
]);
store.saveRenameDest('rootFOLDER999', 'Raiz export');

const loaded = store.loadLocalFolders();
assert(loaded.length === 2, 'guarda 2 carpetas');
assert(loaded[0].folder_id === 'folderAAA111', 'folder id A');

store.saveSheetConfig('199VwTc4WCVuFfNN93UTI8wVxDvoMT4KzqNm6s_AsXPk', 'BD test');
assert(store.loadSheetConfig().sheet_id.startsWith('199VwTc4'), 'sheet id persistido');

store.saveTokens({ access_token: 'x', refresh_token: 'y', expiry_date: Date.now() });
store.clearTokens();
assert(!store.loadTokens(), 'tokens limpios');
assert(store.loadSheetConfig().sheet_id.startsWith('199VwTc4'), 'sheet sobrevive clearTokens');
assert(store.loadLocalFolders().length === 2, 'carpetas sobreviven clearTokens');
assert(store.loadRenameDest().folder_id === 'rootFOLDER999', 'rename dest sobrevive clearTokens');

scope.clearActiveUser();
assert(!store.loadSheetConfig().sheet_id, 'sin usuario no expone sheet');
assert(store.loadLocalFolders().length === 0, 'sin usuario no expone carpetas');

const sheetsSvcPath = path.join(__dirname, '..', 'electron', 'google-sheets-service.js');
const src = fs.readFileSync(sheetsSvcPath, 'utf8');
const revokeBody = src.slice(src.indexOf('async function revokeAuth'), src.indexOf('async function _apiFetch'));
assert(revokeBody.includes('clearActiveUser'), 'revoke limpia usuario activo');
assert(!revokeBody.includes('clearSheetConfig()'), 'revokeAuth no debe llamar clearSheetConfig');

console.log('[PASS] autoimg local prefs + sheet persistence');
