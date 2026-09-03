
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_PATH = path.join(ROOT, 'frontend', 'src', 'api.ts');
const PRELOAD_PATH = path.join(ROOT, 'electron', 'preload.js');
const ALLOWLIST_PATH = path.join(ROOT, 'electron', 'ipc-methods.js');
const LONG_RUNNING_PATH = path.join(ROOT, 'shared', 'long-running-methods.json');
const HEAVY_PATH = path.join(ROOT, 'shared', 'heavy-ipc-methods.json');

function extractApiMethods(source) {
  const methods = new Set();
  const invokeAt = /_invoke\b/g;
  let at;
  while ((at = invokeAt.exec(source)) !== null) {
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
  const allowlistModule = require(ALLOWLIST_PATH);
  const longRunning = new Set(JSON.parse(fs.readFileSync(LONG_RUNNING_PATH, 'utf8')));
  const heavy = new Set(JSON.parse(fs.readFileSync(HEAVY_PATH, 'utf8')));

  const apiMethods = extractApiMethods(apiSource);
  const preloadMethods = extractPreloadMethods(preloadSource);
  const knownUsedMethods = new Set([...apiMethods, ...preloadMethods, 'canvas_asset_gc', 'autoimg_scan_all']);
  const allowed = allowlistModule.ALLOWED_RENDERER_METHODS;
  const allowlistLongRunning = allowlistModule.LONG_RUNNING_METHODS;
  const allowlistHeavy = allowlistModule.HEAVY_METHODS;

  const missingFromAllowlist = [...apiMethods].filter((m) => !allowed.has(m));
  const unexpectedInAllowlist = [...allowed].filter((m) => !knownUsedMethods.has(m));
  const longRunningNotAllowed = [...longRunning].filter((m) => !allowed.has(m));
  const longRunningDrift = [
    ...[...longRunning].filter((m) => !allowlistLongRunning.has(m)),
    ...[...allowlistLongRunning].filter((m) => !longRunning.has(m)),
  ];
  const heavyDrift = [
    ...[...heavy].filter((m) => !allowlistHeavy.has(m)),
    ...[...allowlistHeavy].filter((m) => !heavy.has(m)),
    ...[...heavy].filter((m) => !longRunning.has(m)),
  ];

  let failed = false;

  if (missingFromAllowlist.length > 0) {
    console.error(
      `[FAIL] Métodos usados en api.ts pero no en ALLOWED_RENDERER_METHODS:\n  - ${missingFromAllowlist.join('\n  - ')}`
    );
    failed = true;
  }

  if (longRunningNotAllowed.length > 0) {
    console.error(
      `[FAIL] Métodos LONG_RUNNING (shared/long-running-methods.json) no presentes en ALLOWED_RENDERER_METHODS:\n  - ${longRunningNotAllowed.join('\n  - ')}`
    );
    failed = true;
  }

  if (longRunningDrift.length > 0) {
    console.error(
      `[FAIL] LONG_RUNNING_METHODS en electron/ipc-methods.js no coincide con shared/long-running-methods.json:\n  - ${longRunningDrift.join('\n  - ')}`
    );
    failed = true;
  }

  if (heavyDrift.length > 0) {
    console.error(
      `[FAIL] HEAVY_METHODS debe coincidir con shared/heavy-ipc-methods.json y ser long-running:\n  - ${[...new Set(heavyDrift)].join('\n  - ')}`
    );
    failed = true;
  }

  if (unexpectedInAllowlist.length > 0) {
    console.warn(
      `[WARN] Métodos en ALLOWED_RENDERER_METHODS no usados en api.ts (pueden ser legacy):\n  - ${unexpectedInAllowlist.join('\n  - ')}`
    );
  }

  if (!failed) {
    console.log(
      `[PASS] Allowlist sincronizada: ${apiMethods.size} métodos de api.ts presentes; ${longRunning.size} long-running y ${heavy.size} heavy alineados.`
    );
    process.exit(0);
  }

  process.exit(1);
}

main();
