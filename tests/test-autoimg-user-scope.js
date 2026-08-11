/**
 * Aislamiento multi-usuario AutoIMG + no filtrar secretos.
 */

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

const {
  userKeyFromEmail,
  maskEmail,
  setActiveUser,
  clearActiveUser,
  getActiveUserKey,
  scopedFilename,
  scopedNamespace,
} = require('../electron/autoimg-user-scope');
const {
  saveTokens, loadTokens, clearTokens,
  saveSheetConfig, loadSheetConfig, clearSheetConfig,
  saveLocalFolders, loadLocalFolders, clearLocalPrefs,
} = require('../electron/autoimg-user-store');
const { assertNoSecretInObject } = require('../electron/autoimg-security');

function resetUser(email) {
  setActiveUser(email);
  clearTokens();
  clearSheetConfig();
  clearLocalPrefs();
}

// Keys distintos por usuario
const keyA = userKeyFromEmail('alice@example.com');
const keyB = userKeyFromEmail('bob@example.com');
assert(keyA && keyB && keyA !== keyB, 'hashes de usuario distintos');
assert(!keyA.includes('@'), 'key no contiene email');
assert(maskEmail('alice@example.com').includes('…@'), 'email enmascarado');
assert(!maskEmail('alice@example.com').includes('alice@example.com'), 'mask no filtra email completo');

// Perfil Alice limpio
clearActiveUser();
resetUser('alice@example.com');
assert(getActiveUserKey() === keyA, 'active key A');
saveTokens({ access_token: 'tok-A', refresh_token: 'ref-A', expiry_date: Date.now() + 99999 });
saveSheetConfig('SheetIdAlice0001', 'Sheet Alice');
saveLocalFolders([{ name: 'CarpetaA', folder_id: 'folderAlice01xx', activo: true }]);

assert(loadTokens()?.access_token === 'tok-A', 'tokens de Alice');
assert(loadSheetConfig().sheet_id === 'SheetIdAlice0001', 'sheet de Alice');
assert(loadLocalFolders()[0].folder_id === 'folderAlice01xx', 'folder de Alice');
assert(scopedFilename('sheet.json').includes(keyA), 'path scoped a Alice');
assert(scopedNamespace('sheet').includes(keyA), 'namespace scoped a Alice');

// Cambiar a Bob limpio — no debe ver datos de Alice
resetUser('bob@example.com');
assert(getActiveUserKey() === keyB, 'active key B');
assert(!loadTokens(), 'Bob no tiene tokens');
assert(!loadSheetConfig().sheet_id, 'Bob no hereda sheet de Alice');
assert(loadLocalFolders().length === 0, 'Bob no hereda carpetas de Alice');

saveTokens({ access_token: 'tok-B', refresh_token: 'ref-B', expiry_date: Date.now() + 99999 });
saveSheetConfig('SheetIdBob0000002', 'Sheet Bob');
saveLocalFolders([{ name: 'CarpetaB', folder_id: 'folderBob02xxxx', activo: true }]);

// Volver a Alice — restaura su perfil (sin reset)
setActiveUser('alice@example.com');
assert(loadTokens()?.access_token === 'tok-A', 'Alice recupera tokens');
assert(loadSheetConfig().sheet_id === 'SheetIdAlice0001', 'Alice recupera sheet');
assert(loadLocalFolders()[0].folder_id === 'folderAlice01xx', 'Alice recupera carpetas');

// Bob intacto
setActiveUser('bob@example.com');
assert(loadTokens()?.access_token === 'tok-B', 'Bob conserva tokens');
assert(loadSheetConfig().sheet_id === 'SheetIdBob0000002', 'Bob conserva sheet');

// Logout no debe devolver sheet de nadie
clearTokens();
clearActiveUser();
assert(!getActiveUserKey(), 'sin usuario activo');
assert(!loadSheetConfig().sheet_id, 'sin active no se expone sheet');

// Seguridad: assertNoSecretInObject
let threw = false;
try {
  assertNoSecretInObject({ refresh_token: 'x' });
} catch {
  threw = true;
}
assert(threw, 'assertNoSecretInObject bloquea refresh_token');

threw = false;
try {
  assertNoSecretInObject({ note: 'ya29.a0AfH6SMB-secret-looking-token-value' });
} catch {
  threw = true;
}
assert(threw, 'assertNoSecretInObject bloquea patrón de access token');

// revokeAuth no limpia sheet del usuario (código)
const sheetsSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'google-sheets-service.js'), 'utf8');
const revokeBody = sheetsSrc.slice(
  sheetsSrc.indexOf('async function revokeAuth'),
  sheetsSrc.indexOf('async function _apiFetch'),
);
assert(revokeBody.includes('clearActiveUser'), 'revoke limpia usuario activo');
assert(!revokeBody.includes('clearSheetConfig()'), 'revoke no borra sheet del usuario');
assert(sheetsSrc.includes('onActiveUserChange'), 'sheets registra listener de cambio de usuario');
assert(sheetsSrc.includes('_sheetId = null'), 'cambio de usuario limpia _sheetId');

const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'autoimg-sync-engine.js'), 'utf8');
assert(engineSrc.includes('clearSessionCaches'), 'engine expone clearSessionCaches');
assert(engineSrc.includes('onActiveUserChange'), 'engine limpia caché al cambiar usuario');
assert(engineSrc.includes('fuera_padron'), 'scan summary usa fuera_padron');

const { onActiveUserChange, setActiveUser: setUser, clearActiveUser: clearUser } = require('../electron/autoimg-user-scope');
let notified = 0;
const unsub = onActiveUserChange(() => { notified += 1; });
clearUser();
setUser('notify-a@example.com');
setUser('notify-b@example.com');
setUser('notify-b@example.com'); // same user — no notify
assert(notified >= 2, 'onActiveUserChange dispara al cambiar/cerrar usuario');
unsub();

const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
assert(
  gitignore.includes('autoimg') || gitignore.includes('autoimg-*.json'),
  'gitignore cubre artefactos autoimg',
);

console.log('[PASS] autoimg multi-user scope + no secret leak guards');
