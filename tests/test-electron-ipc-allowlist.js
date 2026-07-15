/**
 * Regresión: todos los métodos invocados desde frontend/src/api.ts deben
 * estar presentes en ALLOWED_RENDERER_METHODS de electron/ipc-methods.js.
 *
 * Objetivo: evitar que un nuevo handler del backend o un nuevo método nativo
 * se consuma desde el frontend sin pasar por la allowlist del preload y del
 * ipc-router (defensa en profundidad).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_PATH = path.join(ROOT, 'frontend', 'src', 'api.ts');
const ALLOWLIST_PATH = path.join(ROOT, 'electron', 'ipc-methods.js');
const LONG_RUNNING_PATH = path.join(ROOT, 'shared', 'long-running-methods.json');

function extractApiMethods(source) {
  const methods = new Set();
  // Matches: _invoke<...>('method_name', ...) or _invoke<...>('method_name')
  const invokeRe = /_invoke\s*<[^>]+>\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
  let match;
  while ((match = invokeRe.exec(source)) !== null) {
    methods.add(match[1]);
  }
  return methods;
}

function main() {
  const apiSource = fs.readFileSync(API_PATH, 'utf8');
  const allowlistModule = require(ALLOWLIST_PATH);
  const longRunning = new Set(JSON.parse(fs.readFileSync(LONG_RUNNING_PATH, 'utf8')));

  const apiMethods = extractApiMethods(apiSource);
  const allowed = allowlistModule.ALLOWED_RENDERER_METHODS;
  const allowlistLongRunning = allowlistModule.LONG_RUNNING_METHODS;

  const missingFromAllowlist = [...apiMethods].filter((m) => !allowed.has(m));
  const unexpectedInAllowlist = [...allowed].filter(
    (m) => !apiMethods.has(m) && !['autoimg_scan_all'].includes(m)
  );
  // Every long-running method must be a recognised allowed method, and the
  // Electron allowlist must consume the shared JSON verbatim (no drift).
  const longRunningNotAllowed = [...longRunning].filter((m) => !allowed.has(m));
  const longRunningDrift = [
    ...[...longRunning].filter((m) => !allowlistLongRunning.has(m)),
    ...[...allowlistLongRunning].filter((m) => !longRunning.has(m)),
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

  if (unexpectedInAllowlist.length > 0) {
    console.warn(
      `[WARN] Métodos en ALLOWED_RENDERER_METHODS no usados en api.ts (pueden ser legacy):\n  - ${unexpectedInAllowlist.join('\n  - ')}`
    );
  }

  if (!failed) {
    console.log(
      `[PASS] Allowlist sincronizada: ${apiMethods.size} métodos de api.ts presentes; ${longRunning.size} long-running alineados.`
    );
    process.exit(0);
  }

  process.exit(1);
}

main();
