'use strict';

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
