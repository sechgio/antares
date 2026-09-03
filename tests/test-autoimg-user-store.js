
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
const secure = require('../electron/autoimg-secure-storage');

scope.clearActiveUser();

store.saveOAuthConfig('123456789012-abc.apps.googleusercontent.com', 'secret-de-prueba');
const cfg = store.loadOAuthConfigFromDisk();
assert(cfg.clientId === '123456789012-abc.apps.googleusercontent.com', 'oauth client id round-trip');
assert(cfg.clientSecret === 'secret-de-prueba', 'oauth client secret round-trip');

let threw = false;
try {
  store.saveOAuthConfig('no-es-client-id', 'secret-de-prueba');
} catch {
  threw = true;
}
assert(threw, 'oauth client id inválido lanza error');

assert(store.loadLocalPrefs().folders.length === 0, 'sin usuario devuelve prefs default');
assert(store.loadLocalFolders().length === 0, 'sin usuario no expone carpetas');

scope.setActiveUser('user-store-test@example.com');

store.saveLocalFolders([
  { name: 'A', folder_id: 'folderAAA111', activo: true, ultimo_scan: '', cant_archivos: 3 },
  { name: 'B', folder_id: 'folderBBB222', activo: false, ultimo_scan: '', cant_archivos: 0 },
  { name: 'invalida', folder_id: 'x', activo: true }, // folder_id < 10 chars: se filtra
  { name: 'sin-id', activo: true }, // sin folder_id: se filtra
]);
const folders = store.loadLocalFolders();
assert(folders.length === 2, 'folders válidos guardados, inválidos filtrados');
assert(folders[0].folder_id === 'folderAAA111', 'folder id A persistido');

const merged = store.saveLocalPrefs({ rename_dest_name: 'Destino' });
assert(merged.rename_dest_name === 'Destino', 'merge parcial actualiza rename_dest_name');
assert(merged.folders.length === 2, 'merge parcial conserva folders');
store.saveRenameDest('rootFOLDER999', 'Raiz export');
assert(store.loadRenameDest().folder_id === 'rootFOLDER999', 'rename dest round-trip');

store.saveSheetConfig('199VwTc4WCVuFfNN93UTI8wVxDvoMT4KzqNm6s_AsXPk', 'BD test');
assert(store.loadSheetConfig().sheet_id.startsWith('199VwTc4'), 'sheet id persistido');

threw = false;
try {
  store.saveSheetConfig('corto');
} catch {
  threw = true;
}
assert(threw, 'sheet id inválido lanza error');

store.saveTokens({ access_token: 'a', refresh_token: 'r', expiry_date: 123, id_token: 'no-debe-guardarse' });
let tokens = store.loadTokens();
assert(tokens.access_token === 'a' && tokens.refresh_token === 'r' && tokens.expiry_date === 123, 'tokens round-trip');
assert(tokens.id_token === undefined, 'campos extra de tokens descartados');

const capturedUserKey = scope.userKeyFromEmail('captured-scope@example.com');
store.saveTokensForUserKey(capturedUserKey, { access_token: 'captured', refresh_token: 'r2', expiry_date: 456 });
assert(store.loadTokens()?.access_token === 'a', 'guardar en scope capturado no altera el usuario activo');
assert(
  store.loadTokensForUserKey(capturedUserKey)?.access_token === 'captured',
  'tokens se pueden leer desde el scope capturado',
);
store.clearTokensForUserKey(capturedUserKey);
assert(!store.loadTokensForUserKey(capturedUserKey), 'limpiar scope capturado elimina solo ese usuario');

store.clearTokens();
assert(!store.loadTokens(), 'tokens limpios tras clearTokens');
assert(store.loadSheetConfig().sheet_id.startsWith('199VwTc4'), 'sheet sobrevive clearTokens');
assert(store.loadLocalFolders().length === 2, 'carpetas sobreviven clearTokens');
assert(store.loadRenameDest().folder_id === 'rootFOLDER999', 'rename dest sobrevive clearTokens');

scope.clearActiveUser();
store.saveTokens({ access_token: 'anon', refresh_token: 'r', expiry_date: 1 });
secure.writeSecureJson('autoimg-tokens.json', 'tokens', { access_token: 'legacy', refresh_token: 'r', expiry_date: 1 });
assert(store.loadTokens()?.access_token === 'anon', 'sin usuario, tokens viven en anonymous');
store.clearTokensLegacyPaths();
assert(!store.loadTokens(), 'anonymous tokens borrados');
assert(!secure.readSecureJson('autoimg-tokens.json', 'tokens'), 'legacy root tokens borrados');

assert(!store.loadSheetConfig().sheet_id, 'sin usuario no expone sheet');
assert(store.loadLocalFolders().length === 0, 'sin usuario no expone carpetas');

store.saveSheetConfig('Xx1234567890AbCdEf');
store.saveLocalPrefs({ rename_dest_name: 'no-debe-guardarse' });
scope.setActiveUser('user-store-test@example.com');
assert(store.loadSheetConfig().sheet_id.startsWith('199VwTc4'), 'saveSheetConfig no-op sin usuario (sheet previo intacto)');
assert(store.loadLocalFolders().length === 2, 'saveLocalPrefs no-op sin usuario (prefs previas intactas)');

store.saveTokens({ access_token: 't1', refresh_token: 'r1', expiry_date: 1 });
store.clearSheetConfig();
store.clearLocalPrefs();
assert(store.loadTokens()?.access_token === 't1', 'clearSheetConfig/clearLocalPrefs no tocan tokens');
assert(!store.loadSheetConfig().sheet_id, 'clearSheetConfig borra sheet');
assert(store.loadLocalFolders().length === 0, 'clearLocalPrefs borra prefs');
store.clearTokens();

const sheetsSvcPath = path.join(__dirname, '..', 'electron', 'google-sheets-service.js');
const src = fs.readFileSync(sheetsSvcPath, 'utf8');
const revokeBody = src.slice(src.indexOf('async function revokeAuth'), src.indexOf('async function _apiFetch'));
assert(revokeBody.includes('clearActiveUser'), 'revoke limpia usuario activo');
assert(!revokeBody.includes('clearSheetConfig()'), 'revokeAuth no debe llamar clearSheetConfig');

scope.clearActiveUser();
console.log('[PASS] autoimg consolidated user store (tokens/sheet/prefs/oauth)');
