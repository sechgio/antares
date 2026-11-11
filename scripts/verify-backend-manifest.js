'use strict';

// secrets-012: verificación independiente del manifiesto de hashes del
// backend congelado (generado por scripts/build-backend.js). Se ejecuta en
// release.yml justo antes de electron-builder para que ningún paso intermedio
// introduzca una DLL/EXE distinta en el instalador.
const path = require('path');
const { ROOT: projectRoot } = require('./lib/loop-utils');
const { assertBackendManifest } = require('./verify-frozen-backend');

function main() {
  const rel = process.argv[2] || 'dist/backend';
  const dir = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
  const manifest = assertBackendManifest(dir);
  console.log(
    `[verify-backend-manifest] OK: ${manifest.binaries.length} archivos verificados contra ${path.join(rel, 'antares-backend-manifest.json')}`,
  );
}

main();
