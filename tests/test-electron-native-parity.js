
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function setsEqual(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set)) return false;
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

function diffSets(a, b) {
  return [...a].filter((x) => !b.has(x));
}

function main() {
  console.log('Testing native-method allowlist parity...\n');

  const catalog = require('../shared/ipc-method-catalog.json').methods;
  const byHandler = (bucket) =>
    new Set(Object.keys(catalog).filter((m) => catalog[m].handler === bucket));

  const { NATIVE_METHODS: sourceNative, ALLOWED_RENDERER_METHODS, BACKEND_METHODS } =
    require('../electron/ipc-methods');
  const { NATIVE_METHODS: dialogNative } = require('../electron/dialog-handlers');
  const { AUTOIMG_METHODS } = require('../electron/autoimg-ipc-methods');
  const { UBICACIONES_METHODS } = require('../electron/ubicaciones-ipc-methods');

  check(
    Array.isArray(sourceNative) && new Set(sourceNative).size === sourceNative.length,
    'ipc-methods.NATIVE_METHODS es una lista sin duplicados'
  );
  const source = new Set(sourceNative);

  // Las listas de Electron se proyectan desde el catálogo; si el filtro se rompe o
  // alguien edita una proyección a mano, el método queda inalcanzable en runtime.
  const catalogNatives = byHandler('native:dialog');
  check(setsEqual(source, catalogNatives), 'NATIVE_METHODS == los native:dialog del catálogo');
  check(
    setsEqual(new Set(dialogNative), catalogNatives),
    'dialog-handlers.NATIVE_METHODS == los native:dialog del catálogo'
  );
  check(setsEqual(ALLOWED_RENDERER_METHODS, new Set(Object.keys(catalog))),
    'ALLOWED_RENDERER_METHODS == todos los métodos del catálogo');

  // Un método declarado nativo sin rama en handleDialogCall caería al fallthrough de
  // diálogos y contestaría un file open en vez de su operación real.
  const dialogSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'dialog-handlers.js'), 'utf8');
  const branches = new Set([...dialogSrc.matchAll(/method === '([^']+)'/g)].map((m) => m[1]));
  const openDialogFallthrough = new Set(['dialog_files', 'dialog_dest']);
  const serviced = new Set([...branches, ...openDialogFallthrough]);
  const sinRama = diffSets(catalogNatives, serviced);
  check(
    sinRama.length === 0,
    `cada native:dialog tiene rama en handleDialogCall${sinRama.length ? ` (faltan: ${sinRama.join(', ')})` : ''}`
  );
  const ramaHuérfana = diffSets(branches, catalogNatives);
  check(
    ramaHuérfana.length === 0,
    `handleDialogCall no atiende métodos fuera de native:dialog${ramaHuérfana.length ? ` (sobran: ${ramaHuérfana.join(', ')})` : ''}`
  );

  // partición: todo método del catálogo cae en exactamente un bucket de enrutado.
  const backendFromCatalog = new Set(
    Object.keys(catalog).filter((m) => catalog[m].handler.startsWith('backend:'))
  );
  const buckets = [
    ['BACKEND_METHODS', new Set(BACKEND_METHODS), backendFromCatalog],
    ['NATIVE_METHODS', source, catalogNatives],
    ['AUTOIMG_METHODS', AUTOIMG_METHODS, byHandler('native:autoimg')],
    ['UBICACIONES_METHODS', UBICACIONES_METHODS, byHandler('native:ubicaciones')],
  ];
  for (const [name, exported, expected] of buckets) {
    check(setsEqual(exported, expected), `${name} coincide con su bucket del catálogo`);
  }

  const solapados = [];
  const sinBucket = [];
  for (const method of Object.keys(catalog)) {
    const en = buckets.filter(([, exported]) => exported.has(method));
    if (en.length === 0) sinBucket.push(method);
    if (en.length > 1) solapados.push(`${method} (${en.map(([n]) => n).join(', ')})`);
  }
  check(
    sinBucket.length === 0,
    `ningún método del catálogo queda fuera de todo bucket${sinBucket.length ? ` (huérfanos: ${sinBucket.join(', ')})` : ''}`
  );
  check(
    solapados.length === 0,
    `los buckets son disjuntos entre sí${solapados.length ? ` (solapados: ${solapados.join('; ')})` : ''}`
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
