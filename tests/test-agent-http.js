'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {
  check,
  validate,
  MAX_RETRY_AFTER_MS,
  isRetryableStatus,
  retryAfterMs,
  retryDelayMs,
  clampRetryAfterMs,
} = require('../electron/agent-http');

async function rejects(promise, pattern) {
  try {
    await promise;
  } catch (err) {
    assert.match(String(err && err.message || err), pattern);
    return;
  }
  throw new Error(`Se esperaba un rechazo ${pattern}`);
}

async function main() {
  assert.equal(MAX_RETRY_AFTER_MS, 30_000);
  for (const status of [429, 500, 501, 502, 503, 504, 529, 599]) {
    assert.equal(isRetryableStatus(status), true, `${status} es reintentable`);
  }
  for (const status of [400, 401, 404, 408, 600]) {
    assert.equal(isRetryableStatus(status), false, `${status} no es reintentable`);
  }
  const retryHeader = (value) => ({ get: (name) => (name.toLowerCase() === 'retry-after' ? value : null) });
  assert.equal(retryAfterMs(retryHeader('2')), 2_000);
  assert.equal(retryAfterMs(retryHeader('45')), MAX_RETRY_AFTER_MS);
  assert.equal(retryAfterMs(retryHeader('-1')), 0);
  assert.equal(retryAfterMs(retryHeader('soon')), null);
  assert.equal(retryAfterMs({ 'Retry-After': '3' }), 3_000);
  const dateNow = Date.parse('2026-10-31T12:00:00Z');
  assert.equal(retryAfterMs(retryHeader(new Date(dateNow + 10_000).toUTCString()), MAX_RETRY_AFTER_MS, dateNow), 10_000);
  assert.equal(clampRetryAfterMs(60_000), MAX_RETRY_AFTER_MS);
  assert.equal(clampRetryAfterMs(-1), 0);
  assert.equal(clampRetryAfterMs(undefined), 0);
  assert.equal(retryDelayMs(0, { random: () => 0 }), 1_000);
  assert.equal(retryDelayMs(1, { random: () => 0 }), 2_000);
  assert.equal(retryDelayMs(2, { random: () => 0 }), 4_000);
  assert.equal(retryDelayMs(10, { random: () => 0 }), MAX_RETRY_AFTER_MS);
  assert.equal(retryDelayMs(0, { random: () => 0.5 }), 1_125);
  assert.equal(retryDelayMs(0, { retryAfter: 12_000, random: () => 0 }), 12_000);
  assert.equal(retryDelayMs(0, { retryAfter: 60_000 }), MAX_RETRY_AFTER_MS);

  const server = http.createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200); res.end('ok'); return; }
    if (req.url === '/created') { res.writeHead(204); res.end(); return; }
    if (req.url === '/down') { res.writeHead(503); res.end('no'); return; }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/ok' }); res.end(); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await check(`${base}/ok`);
    assert.equal(ok.ready, true);
    assert.equal(ok.status, 200);
    assert.equal((await check(`${base}/created`, { expect_status: 204 })).ready, true);
    const down = await check(`${base}/down`);
    assert.equal(down.ready, false);
    assert.equal(down.status, 503);
    const redirect = await check(`${base}/redirect`);
    assert.equal(redirect.ready, false);
    assert.equal(redirect.redirect, true);
    assert.equal(await validate('http://localhost:8080/health'), 'http://localhost:8080/health');
    assert.equal(await validate('https://8.8.8.8/health'), 'https://8.8.8.8/health');
    await rejects(validate('http://example.com/health'), /https/);
    await rejects(validate('https://10.0.0.1/health'), /privada/);
    await rejects(validate('https://192.168.1.10/health'), /privada/);
    await rejects(validate('https://[fe80::1]/health'), /privada/);
    await rejects(validate('https://user:pass@example.com/health'), /credenciales/);
    await rejects(validate('ftp://127.0.0.1/health'), /https/);
    await rejects(validate('https://example.invalid/health'), /resolver/);
    console.log('[PASS] Espera HTTP: estado, sin redirecciones, solo HTTPS público o loopback y sin credenciales.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
