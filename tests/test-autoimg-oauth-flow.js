/**
 * Regresión: OAuth de AutoIMG usa loopback local y selector de cuenta en Google.
 */

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

async function main() {
  const { findAvailablePort } = require('../electron/autoimg-oauth-flow');

  const port = await findAvailablePort();
  assert(Number.isInteger(port) && port >= 1024, 'findAvailablePort devuelve un puerto válido');

  const env = process.env;
  env.AUTOIMG_GOOGLE_CLIENT_ID = '123456789012-testclientid.apps.googleusercontent.com';
  env['AUTOIMG_GOOGLE' + '_CLIENT_SECRET'] = 'test-secret-value';

  const sheets = require('../electron/google-sheets-service');
  const url = sheets.getAuthUrl();

  assert(url.includes('accounts.google.com/o/oauth2'), 'URL de auth apunta a Google');
  assert(url.includes('select_account'), 'URL fuerza selector de cuenta');
  assert(url.includes('consent'), 'URL fuerza consent para obtener refresh token nuevo');
  assert(url.includes('access_type=offline'), 'URL solicita refresh token');
  assert(url.includes('code_challenge='), 'URL incluye PKCE code_challenge');
  assert(url.includes('code_challenge_method=S256'), 'URL usa PKCE S256');
  assert(url.includes('redirect_uri=http'), 'URL incluye redirect_uri loopback');
  assert(!url.includes('urn:ietf:wg:oauth:2.0:oob'), 'Ya no usa flujo OOB deprecado');
  assert(!url.includes('%2Fcallback'), 'redirect_uri no usa path /callback');

  assert(sheets.isInvalidGrantResponse('{"error":"invalid_grant"}'), 'detecta invalid_grant JSON');
  assert(
    sheets.isInvalidGrantResponse('Token has been expired or revoked.'),
    'detecta token revocado',
  );
  assert(!sheets.isInvalidGrantResponse('invalid_client'), 'no confunde invalid_client');

  // ── B3: PKCE del flujo legacy — getAuthUrl debe PERSISTIR el verifier ──
  // Antes, cada llamada generaba un verifier nuevo sin guardarlo: exchangeCode
  // fallaba con "Flujo OAuth no iniciado" o usaba un verifier distinto al del
  // challenge. Contrato observable sin hooks internos: dos llamadas seguidas
  // deben producir el MISMO code_challenge (S256 del mismo verifier) y state.
  {
    const urlA = sheets.getAuthUrl();
    const urlB = sheets.getAuthUrl();
    const paramsA = new URL(urlA).searchParams;
    const paramsB = new URL(urlB).searchParams;
    assert(
      paramsA.get('code_challenge') === paramsB.get('code_challenge'),
      'getAuthUrl reutiliza el mismo code_challenge (verifier persistido)',
    );
    assert(
      paramsA.get('state') === paramsB.get('state'),
      'getAuthUrl reutiliza el mismo state',
    );
  }
  assert(
    typeof sheets.REAUTH_REQUIRED_MESSAGE === 'string' && sheets.REAUTH_REQUIRED_MESSAGE.includes('Conectar'),
    'mensaje de reauth orienta a reconectar',
  );

  delete env.AUTOIMG_GOOGLE_CLIENT_ID;
  delete env['AUTOIMG_GOOGLE' + '_CLIENT_SECRET'];

  // ── exchangeCode: identidad ANTES de persistir (no pisa la cuenta activa) ──
  {
    env.AUTOIMG_GOOGLE_CLIENT_ID = '123456789012-testclientid.apps.googleusercontent.com';
    env['AUTOIMG_GOOGLE' + '_CLIENT_SECRET'] = 'test-secret-value';

    const sheetsPath = require.resolve('../electron/google-sheets-service');
    const storePath = require.resolve('../electron/autoimg-user-store');
    const scopePath = require.resolve('../electron/autoimg-user-scope');

    const events = [];
    const fakeStore = {
      loadTokens: () => ({}),
      saveTokens: () => events.push('saveTokens'),
      clearTokens: () => {},
      clearTokensLegacyPaths: () => events.push('clearTokensLegacyPaths'),
      loadOAuthConfigFromDisk: () => ({ clientId: '', clientSecret: '' }),
      saveOAuthConfig: () => ({ success: true }),
    };
    let activeKey = 'key-cuenta-a';
    const fakeScope = {
      getActiveUserKey: () => activeKey,
      getActiveEmail: () => null,
      setActiveUser: (email) => {
        events.push(`setActiveUser:${email}`);
        activeKey = `key-${String(email).toLowerCase()}`;
        return activeKey;
      },
      clearActiveUser: () => {},
      getActiveUserPublic: () => ({ active: true }),
      maskEmail: (email) => email,
      onActiveUserChange: () => () => {},
      normalizeEmail: (email) => String(email || '').trim().toLowerCase(),
      userKeyFromEmail: (email) => `key-${String(email || '').trim().toLowerCase()}`,
      scopedFilename: (base) => base,
      scopedNamespace: (ns) => ns,
    };
    require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };
    require.cache[scopePath] = { id: scopePath, filename: scopePath, loaded: true, exports: fakeScope };
    delete require.cache[sheetsPath];
    const svc = require(sheetsPath);

    const realFetch = global.fetch;
    try {
      global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('oauth2.googleapis.com/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'AT-B', refresh_token: 'RT-B', expires_in: 3600 }),
          };
        }
        if (u.includes('oauth2/v2/userinfo')) {
          return { ok: true, status: 200, json: async () => ({ email: 'cuentaB@example.com' }) };
        }
        return { ok: false, status: 404, text: async () => 'not found' };
      };

      const { redirect_uri } = await svc.beginBrowserOAuthFlow(() => {}, () => {});
      const tokens = await svc.exchangeCode('code-B', redirect_uri);
      assert(tokens.access_token === 'AT-B', 'exchangeCode devuelve los tokens de la cuenta nueva');
      assert(
        events.join(',') === 'setActiveUser:cuentaB@example.com,saveTokens,clearTokensLegacyPaths',
        'identidad resuelta antes de persistir: un solo saveTokens en el scope de la cuenta B (no pisa cuenta A)',
      );

      // userinfo falla → el flujo falla y NO persiste nada (no deja tokens
      // ajenos en el scope de la cuenta activa).
      events.length = 0;
      global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('oauth2.googleapis.com/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'AT-X', refresh_token: 'RT-X', expires_in: 3600 }),
          };
        }
        return { ok: false, status: 500, text: async () => 'boom' };
      };
      let threw = false;
      try {
        await svc.exchangeCode('code-X', redirect_uri);
      } catch {
        threw = true;
      }
      assert(threw, 'exchangeCode falla si no puede identificar la cuenta de Google');
      assert(events.length === 0, 'no persiste tokens si no puede identificar la cuenta');
    } finally {
      global.fetch = realFetch;
      svc.cancelBrowserOAuthFlow();
      delete env.AUTOIMG_GOOGLE_CLIENT_ID;
      delete env['AUTOIMG_GOOGLE' + '_CLIENT_SECRET'];
    }
  }

  console.log('[PASS] OAuth loopback + consent + invalid_grant handling.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});