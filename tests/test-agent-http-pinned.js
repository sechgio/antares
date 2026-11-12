'use strict';

const Module = require('node:module');

const lookups = [];
let lookupResult = '93.184.216.34';
const httpsCalls = [];
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node:dns') {
    return { promises: { lookup: async (host) => { lookups.push(host); return [{ address: lookupResult, family: 4 }]; } } };
  }
  if (request === 'node:https') {
    return { request: (options, callback) => {
      httpsCalls.push(options);
      setImmediate(() => callback({ statusCode: 200, resume() { }, on(event, handler) { if (event === 'end') setImmediate(handler); } }));
      return { setTimeout() { }, on() { }, end() { }, destroy() { } };
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { probe, validate } = require('../electron/agent-http');
const assert = require('node:assert/strict');

async function main() {
  const first = await probe('https://ejemplo.test/repe');
  assert.equal(first.status, 200, 'la sonda llega al destino por la IP resuelta');
  assert.equal(lookups.length, 1, 'cada sonda resuelve el nombre una sola vez');
  assert.equal(httpsCalls.length, 1, 'la sonda conecta por el transporte fijado');
  const sent = httpsCalls[0];
  assert.equal(sent.host, '93.184.216.34', 'la conexión apunta a la IP ya validada');
  assert.equal(sent.servername, 'ejemplo.test', 'el SNI sigue siendo el nombre original');
  assert.equal(sent.headers.host, 'ejemplo.test', 'la cabecera Host sigue siendo el nombre original');
  assert.equal(await validate('https://ejemplo.test/otro'), 'https://ejemplo.test/otro', 'validate conserva su contrato');

  lookupResult = '169.254.169.254';
  const before = lookups.length;
  const second = await probe('https://ejemplo.test/repe');
  assert.equal(second.status, null, 'revalidar cada sonda bloquea el destino que apunta a metadatos');
  assert.equal(httpsCalls.length, 1, 'un destino revalidado como privado no abre conexión');
  assert.equal(lookups.length, before + 1, 'la segunda sonda volvió a resolver antes de decidir');
  console.log('[PASS] Espera HTTP fijada: una sola resolución por sonda, SNI/Host originales y revalidación antes de conectar.');
}

main().catch((err) => { console.error('[FAIL]', err); process.exit(1); });
