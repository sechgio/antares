/**
 * Regresión: varios consumidores no deben refrescar el mismo token en paralelo.
 */

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

  const fakeStore = {
    loadTokens: () => ({ access_token: 'expired', refresh_token: 'refresh-token', expiry_date: 0 }),
    saveTokens: () => {},
    clearTokens: () => {},
    clearTokensLegacyPaths: () => {},
    loadOAuthConfigFromDisk: () => ({ clientId: '', clientSecret: '' }),
    saveOAuthConfig: () => ({ success: true }),
  };
  const fakeScope = {
    setActiveUser: () => 'user-key',
    clearActiveUser: () => {},
    getActiveUserPublic: () => ({ active: true }),
    onActiveUserChange: () => () => {},
    maskEmail: (email) => email,
  };

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
