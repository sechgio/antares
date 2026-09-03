
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

  const fakeStore = {
    loadTokens: () => ({ ...currentTokens }),
    saveTokens: () => {},
    clearTokens: () => {},
    saveTokensForUserKey: (userKey, tokens) => savedScopes.push({ userKey, tokens }),
    clearTokensForUserKey: (userKey) => clearedScopes.push(userKey),
    clearTokensLegacyPaths: () => {},
    loadOAuthConfigFromDisk: () => ({ clientId: '', clientSecret: '' }),
    saveOAuthConfig: () => ({ success: true }),
  };
  const fakeScope = {
    setActiveUser: () => activeUserKey,
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
