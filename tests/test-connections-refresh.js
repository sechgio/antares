'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function session(backend) {
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
    './connections-providers': { getProvider: () => ({ auth: {}, status: {
      url: 'https://example.com/account', account_field: 'name',
    } }) },
    './ipc-router': { _callBackend: async (method, params) => {
      calls.push(method);
      return backend(method, params);
    } },
    './app-log': { appendLogEvent: () => {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/connections-session.js'), 'utf8'), {
    module, require: (name) => deps[name] || require(name), Buffer, URLSearchParams, console,
  });
  return { api: module.exports, stored, calls };
}

async function main() {
  const fresh = { access_token: 'new', refresh_token: 'R2', expiry_date: Date.now() + 3600000 };
  const current = session(async (method) => {
    assert.equal(method, 'flows_connection_token_refresh');
    return { tokens: fresh };
  });
  const [first, second] = await Promise.all([current.api.getValidTokens('demo'), current.api.getValidTokens('demo')]);
  assert.equal(first.refresh_token, 'R2');
  assert.equal(second.access_token, 'new');
  assert.equal(current.calls.length, 1);
  await current.api.probeAccount('demo');
  assert.equal(current.stored.get('connections/demo-tokens.json').account, 'Cuenta');
  assert.ok(current.calls.every((method) => method === 'flows_connection_token_refresh'));

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const changed = session(async (method) => method === 'flows_connection_token_refresh' ? pending : {});
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
  console.log('[PASS] OAuth usa el token rotado del backend, comparte el refresco y respeta la desconexión.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
