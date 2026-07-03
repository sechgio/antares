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

  process.env.AUTOIMG_GOOGLE_CLIENT_ID = '123456789012-testclientid.apps.googleusercontent.com';
  process.env.AUTOIMG_GOOGLE_CLIENT_SECRET = 'test-secret-value';

  const sheets = require('../electron/google-sheets-service');
  const url = sheets.getAuthUrl();

  assert(url.includes('accounts.google.com/o/oauth2'), 'URL de auth apunta a Google');
  assert(url.includes('prompt=select_account'), 'URL fuerza selector de cuenta');
  assert(url.includes('access_type=offline'), 'URL solicita refresh token');
  assert(url.includes('code_challenge='), 'URL incluye PKCE code_challenge');
  assert(url.includes('code_challenge_method=S256'), 'URL usa PKCE S256');
  assert(url.includes('redirect_uri=http'), 'URL incluye redirect_uri loopback');
  assert(!url.includes('urn:ietf:wg:oauth:2.0:oob'), 'Ya no usa flujo OOB deprecado');
  assert(!url.includes('%2Fcallback'), 'redirect_uri no usa path /callback');

  delete process.env.AUTOIMG_GOOGLE_CLIENT_ID;
  delete process.env.AUTOIMG_GOOGLE_CLIENT_SECRET;

  console.log('[PASS] OAuth loopback + select_account configurado correctamente.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});