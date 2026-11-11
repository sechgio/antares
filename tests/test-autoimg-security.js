
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { assertOrExit: assert } = require('./helpers/harness');

const ROOT = path.resolve(__dirname, '..');

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

  const status = sheets.getOAuthConfigStatus();
  assertNoSecretInObject(status);
  assert(!('client_id' in status), 'oauth status no debe exponer client_id completo');
  assert(!('client_secret' in status), 'oauth status no debe exponer client_secret');

  const masked = maskClientId('123456789012-abcdefghijklmnop.apps.googleusercontent.com');
  assert(masked.includes('…'), 'client_id_masked debe estar parcialmente oculto');
  assert(!masked.includes('abcdefghijklmnop'), 'client_id_masked no debe filtrar el ID completo');

  const sanitized = sanitizeErrorMessage('OAuth failed: {"access_token":"SECRET123","client_secret":"X"}');
  assert(!sanitized.includes('SECRET123'), 'sanitizeErrorMessage debe redactar access_token');
  assert(!sanitized.includes('client_secret'), 'sanitizeErrorMessage debe redactar client_secret');

  const rateLimited = sanitizeErrorMessage('Google API error (429): Quota exceeded for Read requests');
  assert(rateLimited.includes('Límite de consultas'), 'sanitizeErrorMessage debe traducir error 429');
  assert(!rateLimited.includes('472350177078'), 'sanitizeErrorMessage no debe exponer IDs de proyecto Google');

  // cua-012: claves credenciales por regex y firmas de tokens de terceros.
  const throwsSecret = (fn, label) => {
    let threw = null;
    try { fn(); } catch (error) { threw = error; }
    assert(threw !== null, label);
  };
  throwsSecret(() => assertNoSecretInObject({ Authorization: 'Bearer abc' }), 'clave Authorization bloqueada');
  throwsSecret(() => assertNoSecretInObject({ apiKey: 'valor' }), 'clave apiKey bloqueada');
  throwsSecret(() => assertNoSecretInObject({ sessionToken: 'x'.repeat(24) }), 'clave session_token bloqueada');
  // Muestras construidas por partes: ningún literal con forma de credencial
  // dentro del propio test.
  const fakeAnthropicKey = 'sk-' + 'ant-api03-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
  const fakeGithubToken = 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  const fakeSlackToken = 'xox' + 'b-123456789-' + 'abcdefghijklmnopqrstuvwxyz';
  throwsSecret(() => assertNoSecretInObject({ nota: fakeAnthropicKey }), 'clave de Anthropic en valor bloqueada');
  throwsSecret(() => assertNoSecretInObject({ nota: fakeGithubToken }), 'token de GitHub en valor bloqueado');
  throwsSecret(() => assertNoSecretInObject({ nota: fakeSlackToken }), 'token de Slack en valor bloqueado');
  throwsSecret(() => assertNoSecretInObject({ deep: { refresh_token: 'abc' } }), 'refresh_token anidado bloqueado');
  assertNoSecretInObject({ next_page_token: 'CURSOR_abc', page_state: 'xyz' }, 'cursores de paginación no se bloquean');

  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const entry of ['autoimg-oauth-config.json', 'autoimg-tokens.json', 'autoimg-sheet.json', '.env.local']) {
    assert(gitignore.includes(entry) || gitignore.includes('.env.*'), `.gitignore debe cubrir ${entry}`);
  }

  const tracked = gitLsFiles();
  assert(!tracked.includes('frontend/.env.local'), 'frontend/.env.local no debe estar en git');
  assert(!tracked.includes('.env.local'), '.env.local no debe estar en git');

  for (const examplePath of ['frontend/.env.example', '.env.example']) {
    const abs = path.join(ROOT, examplePath);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    assert(!/sb_publishable_[A-Za-z0-9_]+/.test(text), `${examplePath} no debe contener publishable keys reales`);
    assert(!/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/.test(text), `${examplePath} no debe contener JWT reales`);
    assert(!/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(text), `${examplePath} no debe contener project ref real`);
  }

  const preCommitHook = path.join(ROOT, '.githooks', 'pre-commit');
  assert(fs.existsSync(preCommitHook), '.githooks/pre-commit debe existir');
  const preCommit = fs.readFileSync(preCommitHook, 'utf8');
  assert(preCommit.includes('.env.local'), 'pre-commit debe bloquear .env.local');
  assert(preCommit.includes('sb_publishable_'), 'pre-commit debe bloquear publishable keys');
  assert(preCommit.includes('sbp_'), 'pre-commit debe bloquear access tokens Supabase');

  for (const entry of ['supabase/.env', 'supabase/.env.local', '.cursor/settings.json']) {
    assert(gitignore.includes(entry) || gitignore.includes('supabase/.env'), `.gitignore debe cubrir ${entry}`);
  }
  assert(!tracked.includes('supabase/.env'), 'supabase/.env no debe estar en git');
  assert(!tracked.includes('supabase/.env.local'), 'supabase/.env.local no debe estar en git');
  assert(!tracked.includes('.cursor/settings.json'), '.cursor/settings.json no debe estar en git');

  const secretPatterns = [
    /client_secret\s*[:=]\s*['"][a-zA-Z0-9_\-]{8,}['"]/i,
    /AUTOIMG_GOOGLE_CLIENT_SECRET\s*=\s*\S+/,
    /refresh_token\s*[:=]\s*['"][a-zA-Z0-9_\-\.]{10,}['"]/i,
    /sb_publishable_[a-zA-Z0-9_]+/,
    /sbp_[a-zA-Z0-9]{10,}/,
    /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{20,}/i,
    /SUPABASE_DB_PASSWORD\s*[:=]\s*['"]?[^\s'"]{4,}/i,
    /VITE_SUPABASE_ANON_KEY\s*=\s*eyJ/i,
    /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/,
  ];
  const allowPaths = new Set([
    'frontend/.env.example',
    '.env.example',
    'README.md',
    'tests/test-autoimg-security.js',
    'tests/test-autoimg-google-token.js',
    'tests/test-sheets-session-pinning.js',
    'tests/test-autoimg-google-fetch.js',
    '.githooks/pre-commit',
    '.cursor/rules/supabase-project.mdc',
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

  console.log('[PASS] Security: IPC redactado, gitignore Supabase/AutoIMG y barrido de secretos OK.');
}

main();