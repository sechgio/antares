'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function session(backend, extra = {}) {
  const stored = new Map([
    ['connections/demo-tokens.json', { access_token: 'old', refresh_token: 'R1', expiry_date: 1 }],
    ['connections/demo-oauth-config.json', { client_id: 'client', client_secret: 'secret' }],
  ]);
  const calls = [];
  const module = { exports: {} };
  const deps = {
    './autoimg-secure-storage': {
      readSecureJson: (file) => stored.get(file) || null,
      writeSecureJson: (file, ns, value) => stored.set(file, value),
      clearSecureJson: (file) => stored.delete(file),
    },
    './autoimg-google-fetch': { fetchWithRetry: async (url, options) => {
      assert.equal(url, 'https://example.com/account');
      assert.equal(options.headers.Authorization, 'Bearer new');
      return { ok: true, json: async () => ({ name: 'Cuenta' }) };
    } },
    './autoimg-security': { maskClientId: (id) => id },
    './autoimg-oauth-flow': {},
    './connections-providers': { getProvider: () => ({ auth: { scopes: ['read'], callback_port: 42831, callback_path: '/callback' }, status: {
      url: 'https://example.com/account', account_field: 'name',
    } }) },
    './ipc-router': { _callBackend: async (method, params) => {
      calls.push(method);
      return backend(method, params);
    } },
    './app-log': { appendLogEvent: () => {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/connections-session.js'), 'utf8'), {
    module, require: (name) => deps[name] || require(name), Buffer, URLSearchParams, console, ...extra,
  });
  return { api: module.exports, stored, calls };
}

async function main() {
  const fresh = { access_token: 'new', refresh_token: 'R2', expiry_date: Date.now() + 3600000 };
  const current = session(async (method) => {
    assert.equal(method, 'connections_token_refresh');
    return { tokens: fresh };
  });
  const [first, second] = await Promise.all([current.api.getValidTokens('demo'), current.api.getValidTokens('demo')]);
  assert.equal(first.refresh_token, 'R2');
  assert.equal(second.access_token, 'new');
  assert.equal(current.calls.length, 1);
  await current.api.probeAccount('demo');
  assert.equal(current.stored.get('connections/demo-tokens.json').account, 'Cuenta');
  assert.ok(current.calls.every((method) => method === 'connections_token_refresh'));

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const changed = session(async (method) => method === 'connections_token_refresh' ? pending : {});
  const refreshing = changed.api.getValidTokens('demo');
  await Promise.resolve();
  await changed.api.disconnect('demo');
  release({ tokens: fresh });
  assert.equal(await refreshing, null);
  assert.equal(changed.api.loadTokens('demo'), null);
  assert.ok(!changed.stored.has('connections/demo-tokens.json'));

  const unavailable = session(async () => { throw new Error('Backend no disponible'); });
  assert.equal(await unavailable.api.getValidTokens('demo'), null);
  assert.equal(unavailable.api.loadTokens('demo').refresh_token, 'R1');
  const blocked = await unavailable.api.getStatus('demo');
  assert.equal(blocked.connected, false);
  assert.equal(blocked.state, 'unavailable');
  const valid = session(async () => ({ tokens: fresh }));
  valid.stored.set('connections/demo-tokens.json', { ...fresh, scope: 'read', account: 'Cuenta' });
  assert.equal((await valid.api.getStatus('demo')).state, 'connected');
  const partial = session(async () => ({ tokens: fresh }));
  partial.stored.set('connections/demo-tokens.json', { ...fresh, scope: 'other' });
  const missing = await partial.api.getStatus('demo');
  assert.equal(missing.connected, false);
  assert.deepEqual(Array.from(missing.missing_scopes), ['read']);
  assert.equal(missing.state, 'missing_scopes');
  const expired = session(async () => ({}));
  expired.stored.set('connections/demo-tokens.json', { access_token: 'old', expiry_date: 1, scope: 'read' });
  assert.equal((await expired.api.getStatus('demo')).state, 'reauth_required');
  await valid.api.disconnect('demo');
  assert.equal((await valid.api.getStatus('demo')).state, 'disconnected');
  console.log('[PASS] OAuth usa el token rotado del backend, comparte el refresco y respeta la desconexión.');

  const resources = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'oauth-public-'));
  fs.writeFileSync(path.join(resources, 'oauth-clients.json'), JSON.stringify({ demo: { client_id: 'antares-public', client_secret: 'pub' } }));
  const fakeProcess = { env: {}, resourcesPath: resources };
  const publicApp = session(async () => ({ tokens: fresh }), { process: fakeProcess });
  publicApp.stored.delete('connections/demo-oauth-config.json');
  publicApp.stored.delete('connections/demo-tokens.json');
  const status = await publicApp.api.getStatus('demo');
  assert.equal(status.configured, true);
  assert.equal(status.public_app, true);
  assert.equal(status.state, 'disconnected');
  assert.equal(publicApp.api.loadOAuthConfig('demo').clientId, 'antares-public');
  const env = session(async () => ({ tokens: fresh }), { process: { env: { ANTARES_DEMO_OAUTH_CLIENT_ID: 'desde-build' }, resourcesPath: resources } });
  env.stored.delete('connections/demo-oauth-config.json');
  assert.equal(env.api.loadOAuthConfig('demo').clientId, 'desde-build');
  const own = session(async () => ({ tokens: fresh }), { process: fakeProcess });
  assert.equal(own.api.loadOAuthConfig('demo').clientId, 'client');
  assert.equal((await own.api.getStatus('demo')).public_app, false);
  const none = session(async () => ({ tokens: fresh }), { process: { env: {}, resourcesPath: path.join(resources, 'falta') } });
  none.stored.delete('connections/demo-oauth-config.json');
  assert.equal((await none.api.getStatus('demo')).state, 'unconfigured');
  fs.rmSync(resources, { recursive: true, force: true });
  console.log('[PASS] La app OAuth pública evita pedir Client ID sin reemplazar la configuración propia.');

  const google = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];
  for (const scope of ['openid', 'email', 'profile']) assert.ok(own.api.scopeGranted(google, scope), `Google concede ${scope}`);
  const microsoft = ['https://graph.microsoft.com/User.Read', 'Files.ReadWrite', 'openid'];
  for (const scope of ['offline_access', 'User.Read', 'Files.ReadWrite']) assert.ok(own.api.scopeGranted(microsoft, scope), `Microsoft concede ${scope}`);
  assert.ok(!own.api.scopeGranted(microsoft, 'Tasks.ReadWrite'), 'un permiso ausente sigue faltando');
  assert.ok(!own.api.scopeGranted(['Files.ReadWrite.All'], 'Files.ReadWrite') , 'un scope parecido no cuenta como concedido');
  console.log('[PASS] Los scopes concedidos se reconocen con las formas que devuelve cada proveedor.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
