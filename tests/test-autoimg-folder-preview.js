/**
 * Preview de carpeta Drive: pageSize=4, thumbs pequeños, cache en memoria.
 */
function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

const sheetsPath = require.resolve('../electron/google-sheets-service');
const drivePath = require.resolve('../electron/google-drive-service');
const scopePath = require.resolve('../electron/autoimg-user-scope');

delete require.cache[sheetsPath];
delete require.cache[drivePath];

const sheets = require('../electron/google-sheets-service');
const originalGetValidTokens = sheets.getValidTokens;
let activeTokens = { access_token: 'tok', refresh_token: 'r' };
sheets.getValidTokens = async () => activeTokens;

let activeUserKey = 'user-a';
let activeUserGeneration = 1;
const userChangeListeners = [];
const fakeScope = {
  getActiveUserSnapshot: () => ({ userKey: activeUserKey, generation: activeUserGeneration }),
  isActiveUserSnapshotCurrent: (snapshot) => (
    snapshot?.userKey === activeUserKey && snapshot?.generation === activeUserGeneration
  ),
  onActiveUserChange: (listener) => {
    userChangeListeners.push(listener);
    return () => {
      const index = userChangeListeners.indexOf(listener);
      if (index >= 0) userChangeListeners.splice(index, 1);
    };
  },
};
require.cache[scopePath] = { id: scopePath, filename: scopePath, loaded: true, exports: fakeScope };

function changeUser(userKey) {
  const previousKey = activeUserKey;
  activeUserKey = userKey;
  activeUserGeneration += 1;
  for (const listener of userChangeListeners.slice()) listener({ previousKey, nextKey: userKey });
}

const drive = require('../electron/google-drive-service');

const FOLDER_ID = '1AbCdEfGhIjKlMnOpQrSt';
let listCalls = 0;
let thumbCalls = 0;
let delayNextList = false;
let delayedListStarted;
let releaseDelayedList;
const originalFetch = global.fetch;

global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('googleapis.com/drive/v3/files')) {
    listCalls += 1;
    assert(u.includes('pageSize=4'), 'pageSize debe ser 4');
    assert(u.includes('thumbnailLink'), 'fields debe pedir thumbnailLink');
    if (delayNextList) {
      delayNextList = false;
      delayedListStarted?.();
      await new Promise((resolve) => { releaseDelayedList = resolve; });
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          files: [
            { id: '1', name: 'a.jpg', thumbnailLink: 'https://lh3.googleusercontent.com/x=s220' },
            { id: '2', name: 'b.jpg', thumbnailLink: 'https://lh3.googleusercontent.com/y=s220' },
          ],
        }),
      headers: { get: () => 'application/json' },
    };
  }
  if (u.includes('googleusercontent.com')) {
    thumbCalls += 1;
    assert(u.endsWith('=s96'), `thumb debe pedir s96, got ${u}`);
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      headers: { get: (h) => (h === 'content-type' ? 'image/jpeg' : null) },
    };
  }
  throw new Error(`Unexpected fetch: ${u}`);
};

(async () => {
  try {
    const first = await drive.previewFolder(FOLDER_ID);
    assert(first.folder_id === FOLDER_ID, 'folder_id');
    assert(first.thumbs.length === 2, '2 thumbs');
    assert(first.thumbs[0].dataUrl.startsWith('data:image/jpeg;base64,'), 'dataUrl');
    assert(listCalls === 1, 'una lista');
    assert(thumbCalls === 2, 'dos thumbs');

    const second = await drive.previewFolder(FOLDER_ID);
    assert(listCalls === 1, 'cache evita segunda lista');
    assert(second.thumbs.length === first.thumbs.length, 'cache same');

    drive.invalidateFolderPreview(FOLDER_ID);
    await drive.previewFolder(FOLDER_ID);
    assert(listCalls === 2, 'invalidate fuerza relista');

    changeUser('user-b');
    await drive.previewFolder(FOLDER_ID);
    assert(listCalls === 3, 'cambiar de usuario no reutiliza preview anterior');

    activeTokens = null;
    let unauthorized = false;
    try {
      await drive.previewFolder(FOLDER_ID);
    } catch {
      unauthorized = true;
    }
    assert(unauthorized, 'un usuario no autenticado no recibe un hit de caché');
    assert(listCalls === 3, 'la validación de auth ocurre antes de consultar Drive');
    activeTokens = { access_token: 'tok', refresh_token: 'r' };

    changeUser('user-c');
    delayNextList = true;
    const delayedList = new Promise((resolve) => { delayedListStarted = resolve; });
    const staleRequest = drive.previewFolder(FOLDER_ID);
    await delayedList;
    changeUser('user-d');
    releaseDelayedList();
    let staleRejected = false;
    try {
      await staleRequest;
    } catch {
      staleRejected = true;
    }
    assert(staleRejected, 'una preview iniciada antes del cambio de usuario se descarta');

    await drive.previewFolder(FOLDER_ID);
    assert(listCalls === 5, 'la respuesta descartada no repuebla la caché de la nueva sesión');

    console.log('[PASS] test-autoimg-folder-preview');
  } catch (e) {
    console.error('[FAIL]', e);
    process.exit(1);
  } finally {
    global.fetch = originalFetch;
    sheets.getValidTokens = originalGetValidTokens;
  }
})();
