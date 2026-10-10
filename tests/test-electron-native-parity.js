
const fs = require('fs');
const path = require('path');

const { assert, finish } = require('./helpers/harness');

function setsEqual(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set)) return false;
  if (a.size !== b.size) return false;
  return diffSets(a, b).length === 0;
}

function diffSets(a, b) {
  return [...a].filter((x) => !b.has(x));
}

function main() {
  console.log('Testing native-method allowlist parity...\n');

  const catalog = require('../shared/ipc-method-catalog.json').methods;
  const byHandler = (bucket) =>
    new Set(Object.keys(catalog).filter((m) => catalog[m].handler === bucket));

  const { NATIVE_METHODS: sourceNative, METHOD_NAMES: ALLOWED_RENDERER_METHODS, BACKEND_METHODS } =
    require('../shared/ipc-method-catalog');
  const { NATIVE_METHODS: dialogNative } = require('../electron/dialog-handlers');
  const { AUTOIMG_METHODS } = require('../electron/autoimg-ipc-methods');
  const { UBICACIONES_METHODS } = require('../electron/ubicaciones-ipc-methods');
  const { SPOTIFY_METHODS } = require('../electron/spotify-ipc-methods');
  const { CONNECTIONS_METHODS } = require('../electron/connections-ipc-methods');
  const { AGENT_METHODS } = require('../electron/agent-handlers');

  assert(
    Array.isArray(sourceNative) && new Set(sourceNative).size === sourceNative.length,
    'catalog.NATIVE_METHODS es una lista sin duplicados'
  );
  const source = new Set(sourceNative);

  // Una proyección incompleta del catálogo deja métodos inalcanzables.
  const catalogNatives = byHandler('native:dialog');
  assert(
    setsEqual(new Set(dialogNative), catalogNatives),
    'dialog-handlers.NATIVE_METHODS == los native:dialog del catálogo'
  );
  assert(setsEqual(ALLOWED_RENDERER_METHODS, new Set(Object.keys(catalog))),
    'ALLOWED_RENDERER_METHODS == todos los métodos del catálogo');

  // Un nativo sin rama propia cae al diálogo de apertura por defecto.
  const dialogSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'dialog-handlers.js'), 'utf8');
  const branches = new Set([...dialogSrc.matchAll(/method === '([^']+)'/g)].map((m) => m[1]));
  const openDialogFallthrough = new Set(['dialog_files', 'dialog_dest']);
  const serviced = new Set([...branches, ...openDialogFallthrough]);
  const sinRama = diffSets(catalogNatives, serviced);
  assert(
    sinRama.length === 0,
    `cada native:dialog tiene rama en handleDialogCall${sinRama.length ? ` (faltan: ${sinRama.join(', ')})` : ''}`
  );
  const ramaHuérfana = diffSets(branches, catalogNatives);
  assert(
    ramaHuérfana.length === 0,
    `handleDialogCall no atiende métodos fuera de native:dialog${ramaHuérfana.length ? ` (sobran: ${ramaHuérfana.join(', ')})` : ''}`
  );

  const backendFromCatalog = new Set(
    Object.keys(catalog).filter((m) => catalog[m].handler.startsWith('backend:'))
  );
  const buckets = [
    ['BACKEND_METHODS', new Set(BACKEND_METHODS), backendFromCatalog],
    ['NATIVE_METHODS', source, catalogNatives],
    ['AUTOIMG_METHODS', AUTOIMG_METHODS, byHandler('native:autoimg')],
    ['UBICACIONES_METHODS', UBICACIONES_METHODS, byHandler('native:ubicaciones')],
    ['SPOTIFY_METHODS', SPOTIFY_METHODS, byHandler('native:spotify')],
    ['CONNECTIONS_METHODS', CONNECTIONS_METHODS, byHandler('native:connections')],
    ['AGENT_METHODS', AGENT_METHODS, byHandler('native:agent')],
  ];
  for (const [name, exported, expected] of buckets) {
    assert(setsEqual(exported, expected), `${name} coincide con su bucket del catálogo`);
  }

  const solapados = [];
  const sinBucket = [];
  for (const method of Object.keys(catalog)) {
    const en = buckets.filter(([, exported]) => exported.has(method));
    if (en.length === 0) sinBucket.push(method);
    if (en.length > 1) solapados.push(`${method} (${en.map(([n]) => n).join(', ')})`);
  }
  assert(
    sinBucket.length === 0,
    `ningún método del catálogo queda fuera de todo bucket${sinBucket.length ? ` (huérfanos: ${sinBucket.join(', ')})` : ''}`
  );
  assert(
    solapados.length === 0,
    `los buckets son disjuntos entre sí${solapados.length ? ` (solapados: ${solapados.join('; ')})` : ''}`
  );

  finish();
}

main();
