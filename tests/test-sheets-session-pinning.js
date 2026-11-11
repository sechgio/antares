const { assertOrExit: assert, evictModule, stubModule } = require('./helpers/harness');

const SESSION_CHANGED = 'La sesión de Google cambió durante la operación.';

async function main() {
  const sheetsPath = require.resolve('../electron/google-sheets-service');
  const storePath = require.resolve('../electron/autoimg-user-store');
  const scopePath = require.resolve('../electron/autoimg-user-scope');
  const rowsPath = require.resolve('../electron/autoimg-sheet-rows');
  const previousFetch = global.fetch;

  let activeUserKey = 'user-a';
  let activeUserGeneration = 1;
  const userChangeListeners = [];
  const persistedByScope = new Map();
  const sentRequests = [];

  persistedByScope.set('user-a', {
    access_token: 'access-a',
    refresh_token: 'refresh-a',
    expiry_date: Date.now() + 3600000,
  });
  persistedByScope.set('user-b', {
    access_token: 'access-b',
    refresh_token: 'refresh-b',
    expiry_date: Date.now() + 3600000,
  });

  const fakeStore = {
    loadTokens: () => ({ ...persistedByScope.get(activeUserKey) }),
    loadTokensForUserKey: (userKey) => {
      const saved = persistedByScope.get(userKey);
      return saved ? { ...saved } : null;
    },
    saveTokens: (tokens) => persistedByScope.set(activeUserKey, { ...tokens }),
    saveTokensForUserKey: (userKey, tokens) => persistedByScope.set(userKey, { ...tokens }),
    clearTokensForUserKey: (userKey) => persistedByScope.delete(userKey),
    clearTokens: () => {},
    clearTokensLegacyPaths: () => {},
    loadOAuthConfigFromDisk: () => ({ clientId: '', clientSecret: '' }),
    saveOAuthConfig: () => ({ success: true }),
    loadSheetConfig: () => ({ sheet_id: '', name: '' }),
    saveSheetConfig: () => {},
  };

  const fakeScope = {
    setActiveUser: (email) => {
      const nextKey = email === 'b@example.com' ? 'user-b' : 'user-a';
      const previousKey = activeUserKey;
      activeUserKey = nextKey;
      if (previousKey !== nextKey) {
        activeUserGeneration += 1;
        for (const listener of userChangeListeners) listener({ previousKey, nextKey });
      }
      return activeUserKey;
    },
    clearActiveUser: () => {},
    getActiveUserPublic: () => ({ active: true }),
    getActiveEmail: () => (activeUserKey === 'user-b' ? 'b@example.com' : 'a@example.com'),
    normalizeEmail: (email) => String(email || '').trim().toLowerCase(),
    maskEmail: (email) => email,
    getActiveUserSnapshot: () => ({ userKey: activeUserKey, generation: activeUserGeneration }),
    isActiveUserSnapshotCurrent: (snapshot) => (
      snapshot?.userKey === activeUserKey && snapshot?.generation === activeUserGeneration
    ),
    onActiveUserChange: (listener) => {
      userChangeListeners.push(listener);
      return () => {};
    },
  };

  function changeUser(userKey) {
    const previousKey = activeUserKey;
    activeUserKey = userKey;
    activeUserGeneration += 1;
    for (const listener of userChangeListeners) listener({ previousKey, nextKey: userKey });
  }

  const tabNames = Object.keys(require(rowsPath).AUTOIMG_SHEET_TABS);
  function sheetMetadata(sheetId, title) {
    return {
      properties: { title },
      sheets: tabNames.map((name) => ({ properties: { title: name } })),
    };
  }

  stubModule(storePath, fakeStore);
  stubModule(scopePath, fakeScope);
  evictModule('electron/google-sheets-service');

  process.env.AUTOIMG_GOOGLE_CLIENT_ID = '123456789012-testclientid.apps.googleusercontent.com';
  process.env.AUTOIMG_GOOGLE_CLIENT_SECRET = 'test-secret-value';
  const sheets = require(sheetsPath);

  try {
    global.fetch = async (url, options = {}) => {
      const record = { method: options.method || 'GET', url, auth: options.headers?.Authorization || '' };
      sentRequests.push(record);
      if (url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/') && !options.method) {
        const sheetId = url.slice('https://sheets.googleapis.com/v4/spreadsheets/'.length).split('?')[0];
        const data = sheetId === 'SHEETID-B-0012' ? sheetMetadata(sheetId, 'Hoja B') : sheetMetadata(sheetId, 'Hoja A');
        return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
      }
      if (url.includes('/values')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ updatedCells: 5, totalUpdatedCells: 9, updates: { updatedRange: 'LOGS!A12' } }),
          text: async () => '{}',
        };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    };

    // Escenario 1: escritura simple lleva el Bearer de la cuenta activa; tras un
    // cambio de cuenta, una llamada NUEVA se acredita a la cuenta nueva (los
    // lotes dentro de una operación son los que quedan protegidos, escenarios 2-3).
    await sheets.openSpreadsheet('SHEETID-A-0012');
    await sheets.writeRange('LOGS!A2:E2', [['atribucion-a']]);
    const writes = sentRequests.filter((r) => r.method === 'PUT');
    assert(writes.length === 1 && writes[0].auth === 'Bearer access-a', 'la escritura usa el token de la cuenta que la inició');

    changeUser('user-b');
    await sheets.openSpreadsheet('SHEETID-A-0012');
    await sheets.writeRange('LOGS!A3:E3', [['atribucion-b']]);
    const writesAfterFlip = sentRequests.filter((r) => r.method === 'PUT');
    assert(
      writesAfterFlip.length === 2 && writesAfterFlip[1].auth === 'Bearer access-b',
      'una llamada nueva tras el cambio se acredita a la cuenta activa nueva',
    );

    // Escenario 2: openSpreadsheet dentro del pin no secuestra el Sheet con la
    // cuenta nueva: falla cerrado y no deja la hoja enlazada a la cuenta nueva.
    changeUser('user-a');
    await sheets.openSpreadsheet('SHEETID-A-0012');
    const beforePinnedOpen = sentRequests.length;
    await sheets.withPinnedGoogleSession(async () => {
      changeUser('user-b');
      let openThrew = null;
      try {
        await sheets.openSpreadsheet('SHEETID-B-0012');
      } catch (error) {
        openThrew = error;
      }
      assert(openThrew instanceof Error, 'apertura de otro Sheet dentro del pin no salta de cuenta');
    });
    assert(
      !sentRequests.slice(beforePinnedOpen).some((r) => r.url.includes('SHEETID-B-0012')),
      'la apertura dentro del pin abortada nunca llega a la API con el token de otra cuenta',
    );
    assert(
      sheets.getStoredSheetConfig().sheet_id !== 'SHEETID-B-0012',
      'la apertura abortada no deja el Sheet enlazado a la cuenta nueva',
    );

    // Escenario 3: un lote completo de sincronización comparte un pin: la
    // primera parte se acredita a A y, tras el cambio, la segunda parte no se
    // ejecuta (sin mezcla de filas de dos cuentas).
    changeUser('user-a');
    await sheets.openSpreadsheet('SHEETID-A-0012');
    const beforeBatch = sentRequests.length;
    let batchThrew = null;
    await sheets.withPinnedGoogleSession(async () => {
      await sheets.batchWriteRanges([{ range: 'BD_IMG!A1:M1', values: [['lote-a']] }]);
      changeUser('user-b');
      try {
        await sheets.batchWriteRanges([{ range: 'BD_IMG!A2:M2', values: [['lote-b']] }]);
      } catch (error) {
        batchThrew = error;
      }
    });
    assert(batchThrew instanceof Error, 'el lote falla cerrado al cambiar la cuenta a mitad');
    const batchWrites = sentRequests
      .slice(beforeBatch)
      .filter((r) => r.url.includes('values:batchUpdate') && r.method === 'POST');
    assert(batchWrites.length === 1 && batchWrites[0].auth === 'Bearer access-a', 'solo el lote de la cuenta original sale por el wire');

    // Escenario 4: el pin no queda pegado al módulo: fuera del pin, la sesión
    // activa nueva funciona con normalidad.
    const tokensB = await sheets.getValidTokens();
    assert(tokensB?.access_token === 'access-b', 'fuera del pin la cuenta nueva opera con normalidad');

    console.log('[PASS] Google Sheets: escrituras fijan sesión y fallan cerrado con cambio de cuenta.');
  } finally {
    global.fetch = previousFetch;
  }
}

main().catch((error) => {
  console.error('[FAIL]', error);
  process.exit(1);
});
