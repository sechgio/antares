
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

function main() {
  console.log('Testing native-method allowlist parity...\n');

  const { NATIVE_METHODS: sourceNative, ALLOWED_RENDERER_METHODS } = require('../electron/ipc-methods');
  const { NATIVE_METHODS: dialogNative } = require('../electron/dialog-handlers');

  check(
    Array.isArray(sourceNative) && new Set(sourceNative).size === sourceNative.length,
    'ipc-methods.NATIVE_METHODS es una lista sin duplicados'
  );
  const source = new Set(sourceNative);

  check(
    dialogNative instanceof Set,
    'dialog-handlers exporta NATIVE_METHODS como Set (derivado, no inline)'
  );
  check(
    setsEqual(dialogNative, source),
    'dialog-handlers.NATIVE_METHODS == ipc-methods.NATIVE_METHODS'
  );

  const missingFromAllowlist = [...source].filter((m) => !ALLOWED_RENDERER_METHODS.has(m));
  check(
    missingFromAllowlist.length === 0,
    `todos los nativos están en ALLOWED_RENDERER_METHODS${missingFromAllowlist.length ? ` (faltan: ${missingFromAllowlist.join(', ')})` : ''}`
  );

  const { BACKEND_METHODS } = require('../electron/ipc-methods');
  const { AUTOIMG_METHODS } = require('../electron/autoimg-ipc-methods');
  const { UBICACIONES_METHODS } = require('../electron/ubicaciones-ipc-methods');
  const disjoint = [...source].filter(
    (m) => BACKEND_METHODS.includes(m) || AUTOIMG_METHODS.has(m) || UBICACIONES_METHODS.has(m)
  );
  check(
    disjoint.length === 0,
    `nativos disjuntos de backend/autoimg/ubicaciones${disjoint.length ? ` (solapados: ${disjoint.join(', ')})` : ''}`
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
