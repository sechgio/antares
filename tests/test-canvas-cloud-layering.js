const { readFileSync } = require('node:fs');
const path = require('node:path');
const { assert, finish } = require('./helpers/harness');

const syncDir = path.join(__dirname, '..', 'frontend', 'src', 'components', 'canvas', 'sync');
const importPattern = /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"][^'"]*\/(cloudQueue|canvasCloudSync)(?:\.[jt]s)?['"]/g;

function dispatchImports(source) {
  return [...source.matchAll(importPattern)].map((match) => match[1]);
}

assert(
  dispatchImports("return import('./canvasCloudSync');").includes('canvasCloudSync'),
  'detects a lazy import of the cloud runtime',
);
assert(
  dispatchImports("import { queueCanvasCloudPush } from './cloudQueue';").includes('cloudQueue'),
  'detects an import of the lazy entry point',
);
assert(dispatchImports("import type { CanvasDocument } from '../types';").length === 0, 'allows a Canvas type import');

const pendingOperations = readFileSync(path.join(syncDir, 'pendingCloudOperations.ts'), 'utf8');
assert(dispatchImports(pendingOperations).length === 0, 'pending operations do not depend on cloud dispatch');
const runtime = readFileSync(path.join(syncDir, 'canvasCloudSync.ts'), 'utf8');
assert(!dispatchImports(runtime).includes('cloudQueue'), 'the runtime does not load its lazy entry point');
finish();
