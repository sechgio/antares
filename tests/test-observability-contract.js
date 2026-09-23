const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const contract = require('../shared/observability-contract.json');
const CONTRACT_FIELDS = new Set([...contract.required_fields, ...contract.optional_fields]);

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractJsSet(src, name) {
  const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  assert(m, `set ${name} no encontrado`);
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
}

function extractPySet(src, name) {
  const m = src.match(new RegExp(`${name} = (?:frozenset\\(\\{)?\\{?([\\s\\S]*?)\\}\\)?`));
  assert(m, `set ${name} no encontrado`);
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
}

function extractTsUnion(src, name) {
  const m = src.match(new RegExp(`type ${name} =([\\s\\S]*?);`));
  assert(m, `union ${name} no encontrada`);
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
}

function assertSubset(set, superset, label) {
  for (const value of set) {
    assert(superset.has(value), `${label}: '${value}' no está en el contrato`);
  }
}

function assertSameSet(a, b, label) {
  assert.deepStrictEqual([...a].sort(), [...b].sort(), label);
}

function main() {
  const appLogSrc = readSrc('electron/app-log.js');
  const rendererSrc = readSrc('electron/renderer-observability.js');
  const spawnerSrc = readSrc('electron/backend-spawner.js');
  const observabilitySrc = readSrc('backend/core/observability.py');
  const telemetrySrc = readSrc('backend/handlers/telemetry.py');
  const frontendSrc = readSrc('frontend/src/utils/observability.ts');

  // Todos los campos emitidos deben estar declarados en el contrato.
  assertSubset(extractJsSet(appLogSrc, 'EVENT_FIELDS'), CONTRACT_FIELDS, 'EVENT_FIELDS app-log');
  assertSubset(extractPySet(observabilitySrc, '_EVENT_FIELDS'), CONTRACT_FIELDS, '_EVENT_FIELDS backend');
  assertSubset(extractJsSet(rendererSrc, 'ALLOWED_EVENT_FIELDS'), CONTRACT_FIELDS, 'ALLOWED_EVENT_FIELDS renderer');
  assertSubset(extractJsSet(rendererSrc, 'ALLOWED_LEVELS'), new Set(contract.levels), 'ALLOWED_LEVELS renderer');
  assertSubset(extractJsSet(rendererSrc, 'ALLOWED_OUTCOMES'), new Set(contract.outcomes), 'ALLOWED_OUTCOMES renderer');

  // El espejo stderr del spawner debe conservar todos los campos opcionales que
  // puede emitir el backend (los top-level los pone appendLogEvent; view es renderer-only).
  const TOP_LEVEL = new Set(['platform', 'backend_version']);
  const RENDERER_ONLY = new Set(['view']);
  // Campos que el espejo deriva (no copia verbatim de structured): pid/backend_pid
  // salen del pid del proceso hijo, stream es siempre 'stderr', message va redactado.
  const DERIVED = new Set(['pid', 'backend_pid', 'stream', 'message']);
  const mirrorKeys = new Set(
    [...spawnerSrc.matchAll(/(\w+):\s*structured\?\.\w+/g)].map((m) => m[1]),
  );
  const expectedMirror = contract.optional_fields.filter(
    (f) => !TOP_LEVEL.has(f) && !RENDERER_ONLY.has(f) && !DERIVED.has(f),
  );
  for (const field of expectedMirror) {
    assert(mirrorKeys.has(field), `el espejo stderr pierde el campo '${field}'`);
  }

  // Los tres runtimes deben validar RUM con los mismos conjuntos.
  const jsRumNames = extractJsSet(appLogSrc, 'RUM_METRIC_NAMES');
  const jsRumRatings = extractJsSet(appLogSrc, 'RUM_RATINGS');
  const jsRumNav = extractJsSet(appLogSrc, 'RUM_NAV_TYPES');
  assertSameSet(jsRumNames, extractPySet(observabilitySrc, '_RUM_METRIC_NAMES'), 'RUM names obs.js vs observability.py');
  assertSameSet(jsRumRatings, extractPySet(observabilitySrc, '_RUM_RATINGS'), 'RUM ratings obs.js vs observability.py');
  assertSameSet(jsRumNav, extractPySet(observabilitySrc, '_RUM_NAV_TYPES'), 'RUM nav types obs.js vs observability.py');
  // telemetry.py valida la entrada (mapea lo desconocido a 'unknown'); los sets de
  // campo en observability.py/app-log.js validan el valor emitido — por eso son ⊆.
  assertSubset(extractPySet(telemetrySrc, '_ALLOWED_METRIC_NAMES'), jsRumNames, 'RUM names entrada vs emitido');
  assertSubset(extractPySet(telemetrySrc, '_ALLOWED_RATINGS'), jsRumRatings, 'RUM ratings entrada vs emitido');
  assertSubset(extractPySet(telemetrySrc, '_ALLOWED_NAVIGATION_TYPES'), jsRumNav, 'RUM nav entrada vs emitido');

  // Outcomes iguales en contrato, backend y canal renderer.
  assertSameSet(extractPySet(observabilitySrc, '_OUTCOMES'), new Set(contract.outcomes), 'outcomes backend vs contrato');
  assertSameSet(extractJsSet(rendererSrc, 'ALLOWED_OUTCOMES'), new Set(contract.outcomes), 'outcomes renderer vs contrato');

  // Las uniones TS del frontend deben coincidir con las allowlists del canal.
  assertSameSet(extractTsUnion(frontendSrc, 'FrontendErrorKind'), extractJsSet(rendererSrc, 'ALLOWED_KINDS'), 'error kinds FE vs canal');
  assertSameSet(extractTsUnion(frontendSrc, 'FrontendEventName'), extractJsSet(rendererSrc, 'ALLOWED_EVENT_NAMES'), 'event names FE vs canal');
  assertSubset(extractTsUnion(frontendSrc, 'FrontendEventLevel'), new Set(contract.levels), 'levels FE vs contrato');
  assertSubset(extractTsUnion(frontendSrc, 'FrontendEventOutcome'), new Set(contract.outcomes), 'outcomes FE vs contrato');

  console.log('observability contract parity: TODO OK');
}

main();
