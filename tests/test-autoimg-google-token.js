
function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const sheetsPath = require.resolve('../electron/google-sheets-service');
  const storePath = require.resolve('../electron/autoimg-user-store');
  const scopePath = require.resolve('../electron/autoimg-user-scope');
  const previousEnv = {
    clientId: process.env.AUTOIMG_GOOGLE_CLIENT_ID,
    clientSecret: process.env.AUTOIMG_GOOGLE_CLIENT_SECRET,
  };
  const previousFetch = global.fetch;
  let refreshCalls = 0;
  let currentTokens = { access_token: 'expired', refresh_token: 'refresh-token', expiry_date: 0 };
  let activeUserKey = 'user-key';
  let activeUserGeneration = 1;
  const userChangeListeners = [];
  const savedScopes = [];
  const clearedScopes = [];
  const persistedByScope = new Map();

  const fakeStore = {
    loadTokens: () => ({ ...currentTokens }),
    saveTokens: (tokens) => {
      const saved = { ...tokens };
      persistedByScope.set(activeUserKey, saved);
      savedScopes.push({ userKey: activeUserKey, tokens: saved });
    },
    clearTokens: () => {},
    saveTokensForUserKey: (userKey, tokens) => {
      const saved = { ...tokens };
      persistedByScope.set(userKey, saved);
      savedScopes.push({ userKey, tokens: saved });
    },
    clearTokensForUserKey: (userKey) => clearedScopes.push(userKey),
    clearTokensLegacyPaths: () => {},
    loadOAuthConfigFromDisk: () => ({ clientId: '', clientSecret: '' }),
    saveOAuthConfig: () => ({ success: true }),
  };
  const fakeScope = {
    setActiveUser: (email) => {
      const nextKey = email === 'b@example.com' ? 'user-b' : activeUserKey;
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
    getActiveUserSnapshot: () => ({ userKey: activeUserKey, generation: activeUserGeneration }),
    isActiveUserSnapshotCurrent: (snapshot) => (
      snapshot?.userKey === activeUserKey && snapshot?.generation === activeUserGeneration
    ),
    onActiveUserChange: (listener) => {
      userChangeListeners.push(listener);
      return () => {};
    },
    maskEmail: (email) => email,
  };

  function changeUser(userKey) {
    const previousKey = activeUserKey;
    activeUserKey = userKey;
    activeUserGeneration += 1;
    for (const listener of userChangeListeners) listener({ previousKey, nextKey: userKey });
  }

  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };
  require.cache[scopePath] = { id: scopePath, filename: scopePath, loaded: true, exports: fakeScope };
  delete require.cache[sheetsPath];

  process.env.AUTOIMG_GOOGLE_CLIENT_ID = '123456789012-testclientid.apps.googleusercontent.com';
  process.env.AUTOIMG_GOOGLE_CLIENT_SECRET = 'test-secret-value';
  const sheets = require(sheetsPath);

  try {
    global.fetch = async (_url, options = {}) => {
      assert(options.signal, 'refresh token recibe timeout cancelable');
      refreshCalls += 1;
      await delay(20);
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }),
      };
    };

    const tokens = await Promise.all([
      sheets.getValidTokens(),
      sheets.getValidTokens(),
      sheets.getValidTokens(),
    ]);

    assert(refreshCalls === 1, 'refresh concurrente se deduplica en una sola llamada');
    assert(tokens.every((value) => value?.access_token === 'fresh-token'), 'todos reciben el token nuevo');
    assert(savedScopes.length === 1 && savedScopes[0].userKey === 'user-key', 'refresh guarda en el scope capturado');

    currentTokens = { access_token: 'expired-a', refresh_token: 'refresh-a', expiry_date: 0 };
    savedScopes.length = 0;
    let releaseA;
    let startedA;
    const startedAPromise = new Promise((resolve) => { startedA = resolve; });
    let holdNextRefresh = true;
    global.fetch = async (_url, options = {}) => {
      assert(options.signal, 'refresh token recibe timeout cancelable');
      refreshCalls += 1;
      if (holdNextRefresh) {
        holdNextRefresh = false;
        startedA();
        await new Promise((resolve) => { releaseA = resolve; });
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }),
      };
    };
    const refreshA = sheets.getValidTokens();
    await startedAPromise;
    changeUser('user-b');
    currentTokens = { access_token: 'expired-b', refresh_token: 'refresh-b', expiry_date: 0 };
    const refreshB = await sheets.getValidTokens();
    assert(refreshB?.access_token === 'fresh-token', 'B puede refrescar sin unirse al vuelo de A');
    releaseA();
    assert((await refreshA) === null, 'A obsoleto no se entrega después del cambio de sesión');
    assert(savedScopes.length === 1 && savedScopes[0].userKey === 'user-b', 'A obsoleto no se guarda en B');

    changeUser('user-a');
    currentTokens = { access_token: 'expired-a', refresh_token: 'refresh-a', expiry_date: 0 };
    clearedScopes.length = 0;
    let releaseInvalid;
    let startedInvalid;
    const startedInvalidPromise = new Promise((resolve) => { startedInvalid = resolve; });
    holdNextRefresh = true;
    global.fetch = async (_url, options = {}) => {
      assert(options.signal, 'refresh token recibe timeout cancelable');
      refreshCalls += 1;
      if (holdNextRefresh) {
        holdNextRefresh = false;
        startedInvalid();
        await new Promise((resolve) => { releaseInvalid = resolve; });
      }
      return {
        ok: false,
        status: 400,
        text: async () => '{"error":"invalid_grant"}',
      };
    };
    const invalidA = sheets.getValidTokens();
    await startedInvalidPromise;
    changeUser('user-b');
    releaseInvalid();
    assert((await invalidA) === null, 'invalid_grant obsoleto no rompe la sesión B');
    assert(clearedScopes.length === 1 && clearedScopes[0] === 'user-a', 'invalid_grant limpia solo A');

    // OAuth A -> B: si el intercambio no trae refresh_token, no se debe
    // importar el refresh token de A ni activar/escribir la sesión B.
    activeUserKey = 'user-a';
    activeUserGeneration += 1;
    currentTokens = { access_token: 'access-a', refresh_token: 'refresh-A', expiry_date: Date.now() + 3600000 };
    persistedByScope.clear();
    persistedByScope.set('user-a', { ...currentTokens });
    savedScopes.length = 0;
    global.fetch = async (url, options = {}) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(options.body);
        assert(params.get('grant_type') === 'authorization_code', 'el caso A -> B usa intercambio de código');
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'access-B', expires_in: 3600 }),
        };
      }
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
        return { ok: true, status: 200, json: async () => ({ email: 'b@example.com' }) };
      }
      throw new Error(`URL inesperada: ${url}`);
    };
    sheets.getAuthUrl();
    let exchangeError = null;
    try {
      await sheets.exchangeCode('code-b', 'http://127.0.0.1:42813');
    } catch (error) {
      exchangeError = error;
    }
    assert(exchangeError instanceof Error && /refresh token/i.test(exchangeError.message), 'OAuth sin refresh falla cerrado');
    assert(activeUserKey === 'user-a', 'OAuth sin refresh no cambia la cuenta activa');
    assert(!persistedByScope.has('user-b'), 'OAuth sin refresh no crea tokens para B');
    assert(persistedByScope.get('user-a')?.refresh_token === 'refresh-A', 'el refresh token de A permanece aislado');
    sheets.cancelBrowserOAuthFlow();

    // El flujo normal con refresh token conserva su funcionalidad.
    activeUserKey = 'user-a';
    activeUserGeneration += 1;
    currentTokens = { access_token: 'access-a', refresh_token: 'refresh-A', expiry_date: Date.now() + 3600000 };
    persistedByScope.clear();
    persistedByScope.set('user-a', { ...currentTokens });
    global.fetch = async (url, options = {}) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(options.body);
        assert(params.get('grant_type') === 'authorization_code', 'el caso normal usa intercambio de código');
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'access-B', refresh_token: 'refresh-B', expires_in: 3600 }),
        };
      }
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
        return { ok: true, status: 200, json: async () => ({ email: 'b@example.com' }) };
      }
      throw new Error(`URL inesperada: ${url}`);
    };
    sheets.getAuthUrl();
    const connected = await sheets.exchangeCode('code-b-with-refresh', 'http://127.0.0.1:42813');
    assert(connected.refresh_token === 'refresh-B', 'OAuth normal conserva el refresh token nuevo');
    assert(persistedByScope.get('user-b')?.refresh_token === 'refresh-B', 'OAuth normal guarda el token de B en B');

    // Una renovación posterior de B debe enviar solo el refresh token de B.
    currentTokens = { access_token: 'expired-b', refresh_token: 'refresh-B', expiry_date: 0 };
    let refreshBody = null;
    global.fetch = async (url, options = {}) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        refreshBody = new URLSearchParams(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'fresh-B', expires_in: 3600 }),
        };
      }
      throw new Error(`URL inesperada: ${url}`);
    };
    const refreshedB = await sheets.getValidTokens();
    assert(refreshedB?.access_token === 'fresh-B', 'B sigue pudiendo renovar su sesión');
    assert(refreshBody?.get('refresh_token') === 'refresh-B', 'B nunca renueva con el refresh token de A');
    assert(persistedByScope.get('user-a')?.refresh_token === 'refresh-A', 'la renovación de B no altera A');

    console.log('[PASS] Google token refresh single-flight.');
  } finally {
    global.fetch = previousFetch;
    if (previousEnv.clientId === undefined) delete process.env.AUTOIMG_GOOGLE_CLIENT_ID;
    else process.env.AUTOIMG_GOOGLE_CLIENT_ID = previousEnv.clientId;
    if (previousEnv.clientSecret === undefined) delete process.env.AUTOIMG_GOOGLE_CLIENT_SECRET;
    else process.env.AUTOIMG_GOOGLE_CLIENT_SECRET = previousEnv.clientSecret;
  }
}

main().catch((error) => {
  console.error('[FAIL]', error);
  process.exit(1);
});
