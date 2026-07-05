/**
 * Regresión de seguridad AutoIMG para repo público:
 * - Respuestas IPC no exponen secrets
 * - Archivos locales sensibles están en .gitignore
 * - El árbol versionado no contiene patrones de credenciales
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function gitLsFiles() {
  try {
    return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const { maskClientId, sanitizeErrorMessage, assertNoSecretInObject } = require('../electron/autoimg-security');
  const sheets = require('../electron/google-sheets-service');

  // IPC status nunca devuelve secretos
  const status = sheets.getOAuthConfigStatus();
  assertNoSecretInObject(status);
  assert(!('client_id' in status), 'oauth status no debe exponer client_id completo');
  assert(!('client_secret' in status), 'oauth status no debe exponer client_secret');

  // Enmascarado de Client ID
  const masked = maskClientId('123456789012-abcdefghijklmnop.apps.googleusercontent.com');
  assert(masked.includes('…'), 'client_id_masked debe estar parcialmente oculto');
  assert(!masked.includes('abcdefghijklmnop'), 'client_id_masked no debe filtrar el ID completo');

  // Errores con tokens no se propagan literales
  const sanitized = sanitizeErrorMessage('OAuth failed: {"access_token":"SECRET123","client_secret":"X"}');
  assert(!sanitized.includes('SECRET123'), 'sanitizeErrorMessage debe redactar access_token');
  assert(!sanitized.includes('client_secret'), 'sanitizeErrorMessage debe redactar client_secret');

  const rateLimited = sanitizeErrorMessage('Google API error (429): Quota exceeded for Read requests');
  assert(rateLimited.includes('Límite de consultas'), 'sanitizeErrorMessage debe traducir error 429');
  assert(!rateLimited.includes('472350177078'), 'sanitizeErrorMessage no debe exponer IDs de proyecto Google');

  // .gitignore cubre archivos locales de AutoIMG
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const entry of ['autoimg-oauth-config.json', 'autoimg-tokens.json', 'autoimg-sheet.json', '.env.local']) {
    assert(gitignore.includes(entry) || gitignore.includes('.env.*'), `.gitignore debe cubrir ${entry}`);
  }

  // frontend/.env.local no debe estar versionado
  const tracked = gitLsFiles();
  assert(!tracked.includes('frontend/.env.local'), 'frontend/.env.local no debe estar en git');
  assert(!tracked.includes('.env.local'), '.env.local no debe estar en git');

  // Barrido de secretos en archivos versionados (excluye ejemplos y tests de redacción)
  const secretPatterns = [
    /client_secret\s*[:=]\s*['"][a-zA-Z0-9_\-]{8,}['"]/i,
    /AUTOIMG_GOOGLE_CLIENT_SECRET\s*=\s*\S+/,
    /refresh_token\s*[:=]\s*['"][a-zA-Z0-9_\-\.]{10,}['"]/i,
    /sb_publishable_[a-zA-Z0-9_]+/,
    /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/,
  ];
  const allowPaths = new Set([
    'frontend/.env.example',
    '.env.example',
    'tests/test-autoimg-security.js',
    'electron/google-sheets-service.js',
    'electron/autoimg-handlers.js',
    'frontend/src/api.ts',
    'frontend/src/components/autoimg/components/GoogleAuthPanel.tsx',
  ]);

  const hits = [];
  for (const rel of tracked) {
    if (allowPaths.has(rel)) continue;
    if (!/\.(js|ts|tsx|json|md|yml|yaml|env|toml|py)$/i.test(rel)) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs) || fs.statSync(abs).size > 500_000) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const re of secretPatterns) {
      if (re.test(text)) {
        hits.push(`${rel} → ${re}`);
        break;
      }
    }
  }
  assert(hits.length === 0, `Posibles secretos en archivos versionados:\n  - ${hits.join('\n  - ')}`);

  console.log('[PASS] AutoIMG security: IPC redactado, gitignore y barrido de secretos OK.');
}

main();