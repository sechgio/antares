
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_PATH = path.join(ROOT, 'frontend', 'src', 'api.ts');
const API_DIR = path.join(ROOT, 'frontend', 'src', 'api');
const PRELOAD_PATH = path.join(ROOT, 'electron', 'preload.js');
const CATALOG_PATH = path.join(ROOT, 'shared', 'ipc-method-catalog.js');

const VALID_HANDLERS = /^(backend:[a-z0-9_]+|native:(dialog|autoimg|ubicaciones))$/;
const VALID_TIMEOUTS = new Set(['normal', 'long', 'heavy']);
const VALID_LANES = new Set(['sync', 'light', 'heavy']);

function extractApiMethods(source, calleePattern = /_invoke(?:Invalidating)?\b/g) {
  const methods = new Set();
  let at;
  while ((at = calleePattern.exec(source)) !== null) {
    let i = at.index + at[0].length;
    while (i < source.length && /\s/.test(source[i])) i++;

    if (source[i] === '<') {
      let depth = 0;
      for (; i < source.length; i++) {
        const ch = source[i];
        if (ch === '<') depth++;
        else if (ch === '>') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      while (i < source.length && /\s/.test(source[i])) i++;
    }

    if (source[i] !== '(') continue;
    i++;
    while (i < source.length && /\s/.test(source[i])) i++;

    const quote = source[i];
    if (quote !== "'" && quote !== '"') continue;
    i++;
    let name = '';
    while (i < source.length && source[i] !== quote) {
      name += source[i];
      i++;
    }
    if (/^[a-zA-Z0-9_]+$/.test(name)) {
      methods.add(name);
    }
  }
  return methods;
}

function extractPreloadMethods(source) {
  const methods = new Set();
  const re = /ipcRenderer\.invoke\(\s*['"]ipc-call['"]\s*,\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    methods.add(match[1]);
  }
  return methods;
}

function main() {
  const apiSource = fs.readFileSync(API_PATH, 'utf8');
  const preloadSource = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const catalog = require(CATALOG_PATH);

  // api.ts es una fachada: los invokes reales viven en frontend/src/api/*.ts.
  // Se aplican ambos patrones a cada archivo (_invoke para los wrappers y
  // invoke para autoimgApi, que recibe el callee inyectado).
  const apiMethods = extractApiMethods(apiSource);
  for (const file of fs.readdirSync(API_DIR).filter((f) => f.endsWith('.ts'))) {
    const moduleSource = fs.readFileSync(path.join(API_DIR, file), 'utf8');
    for (const m of extractApiMethods(moduleSource)) apiMethods.add(m);
    for (const m of extractApiMethods(moduleSource, /\binvoke\b/g)) apiMethods.add(m);
  }
  const preloadMethods = extractPreloadMethods(preloadSource);
  const knownUsedMethods = new Set([...apiMethods, ...preloadMethods, 'autoimg_scan_all']);
  const allowed = catalog.METHOD_NAMES;

  const missingFromAllowlist = [...apiMethods].filter((m) => !allowed.has(m));
  const unexpectedInAllowlist = [...allowed].filter((m) => !knownUsedMethods.has(m));

  const invalidEntries = [];
  for (const [name, entry] of Object.entries(catalog.METHODS)) {
    if (!/^[a-z0-9_]+$/.test(name)) invalidEntries.push(`${name}: nombre inválido`);
    if (!entry || typeof entry !== 'object' || !VALID_HANDLERS.test(entry.handler)) {
      invalidEntries.push(`${name}: handler inválido (${JSON.stringify(entry && entry.handler)})`);
      continue;
    }
    if (entry.timeout !== undefined && !VALID_TIMEOUTS.has(entry.timeout)) {
      invalidEntries.push(`${name}: timeout inválido (${entry.timeout})`);
    }
    if (entry.lane !== undefined) {
      if (!entry.handler.startsWith('backend:')) {
        invalidEntries.push(`${name}: lane declarado en método nativo`);
      } else if (!VALID_LANES.has(entry.lane)) {
        invalidEntries.push(`${name}: lane inválido (${entry.lane})`);
      }
    }
    if (entry.fileTokens !== undefined && !(
      Array.isArray(entry.fileTokens)
      && entry.fileTokens.every((schema) => Array.isArray(schema) && schema.every((s) => typeof s === 'string'))
    )) {
      invalidEntries.push(`${name}: fileTokens debe ser una lista de rutas de segmentos`);
    }
  }

  const allowlistDrift = [
    ...[...catalog.METHOD_NAMES].filter((m) => !allowed.has(m)),
    ...[...allowed].filter((m) => !catalog.METHOD_NAMES.has(m)),
  ];

  const heavyNotLongRunning = [...catalog.HEAVY_TIMEOUT_METHODS].filter((m) => !catalog.LONG_RUNNING_METHODS.has(m));

  const timeoutDrift = [
    ['version', 30_000],
    ['db_import', 300_000],
    ['process_start', 900_000],
    ['canvas_export_cmyk_pdf', 900_000],
    ['html_to_pdf', 900_000],
  ].filter(([m, ms]) => catalog.timeoutMsFor(m) !== ms);

  let failed = false;

  if (invalidEntries.length > 0) {
    console.error(
      `[FAIL] Entradas inválidas en shared/ipc-method-catalog.json:\n  - ${invalidEntries.join('\n  - ')}`
    );
    failed = true;
  }

  if (missingFromAllowlist.length > 0) {
    console.error(
      `[FAIL] Métodos usados en api.ts/api/*.ts pero no en ALLOWED_RENDERER_METHODS:\n  - ${missingFromAllowlist.join('\n  - ')}`
    );
    failed = true;
  }

  if (allowlistDrift.length > 0) {
    console.error(
      `[FAIL] ALLOWED_RENDERER_METHODS no coincide con las claves del catálogo:\n  - ${allowlistDrift.join('\n  - ')}`
    );
    failed = true;
  }

  if (heavyNotLongRunning.length > 0) {
    console.error(
      `[FAIL] Métodos con timeout heavy ausentes de la proyección long-running:\n  - ${heavyNotLongRunning.join('\n  - ')}`
    );
    failed = true;
  }

  if (timeoutDrift.length > 0) {
    console.error(
      `[FAIL] Timeouts del catálogo divergen del contrato esperado:\n  - ${timeoutDrift.map(([m]) => m).join('\n  - ')}`
    );
    failed = true;
  }

  if (unexpectedInAllowlist.length > 0) {
    console.warn(
      `[WARN] Métodos en ALLOWED_RENDERER_METHODS no usados en api.ts/api/*.ts (pueden ser legacy):\n  - ${unexpectedInAllowlist.join('\n  - ')}`
    );
  }

  if (!failed) {
    console.log(
      `[PASS] Catálogo IPC sincronizado: ${apiMethods.size} métodos de api.ts/api/*.ts presentes; ` +
      `${catalog.METHOD_NAMES.size} métodos en catálogo (${catalog.BACKEND_METHODS.length} backend, ` +
      `${catalog.LONG_RUNNING_METHODS.size} long-running, ${catalog.HEAVY_TIMEOUT_METHODS.size} heavy-timeout).`
    );
    process.exit(0);
  }

  process.exit(1);
}

main();
