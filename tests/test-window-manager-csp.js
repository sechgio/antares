const fs = require('fs');
const path = require('path');

const { assert, finish, counters } = require('./helpers/harness');

function run() {
  console.log('Testing window-manager CSP for Google Fonts...\n');

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'window-manager.js'),
    'utf8',
  );

  const cspMatches = [...source.matchAll(/buildCsp\((["'`])((?:\\.|(?!\1)[\s\S])*)\1\)/g)];
  assert(cspMatches.length >= 2, 'dev and prod CSP strings are present');

  const devCsp = cspMatches[0]?.[2] ?? '';
  const prodCsp = cspMatches[1]?.[2] ?? '';

  const hardeningMatch = source.match(/cspHardening\s*=\s*"([^"]+)"/);
  const hardening = hardeningMatch?.[1] ?? '';
  assert(hardening.includes("object-src 'none'"), 'hardening sets object-src none');
  assert(hardening.includes("base-uri 'none'"), 'hardening sets base-uri none');
  assert(hardening.includes("form-action 'none'"), 'hardening sets form-action none');
  assert(hardening.includes("frame-ancestors 'none'"), 'hardening sets frame-ancestors none');

  for (const csp of [devCsp, prodCsp]) {
    assert(csp.includes('https://fonts.googleapis.com'), 'style-src allows fonts.googleapis.com');
    assert(csp.includes('https://fonts.gstatic.com'), 'font-src allows fonts.gstatic.com');
    assert(/https:\/\/[\w.*-]+\.supabase\.co/.test(csp), 'connect-src allows Supabase HTTPS');
    assert(/wss:\/\/[\w.*-]+\.supabase\.co/.test(csp), 'connect-src allows Supabase Realtime WSS');
    assert(csp.includes('https://*.audius.co'), 'connect-src allows Audius API hosts');
    assert(csp.includes('https://api.jamendo.com'), 'connect-src allows Jamendo API');
    assert(csp.includes('https://archive.org'), 'connect-src allows Internet Archive API');
    assert(csp.includes('https://ice6.somafm.com'), 'connect-src allows SomaFM metadata');
  }
  const prodScriptSources = prodCsp.match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1] ?? '';
  assert(prodScriptSources.trim() === "'self'", 'production scripts are restricted to self');
  // wshell-002: frame-src queda acotado al puerto real del preview; el
  // comodín solo aparece como respaldo mientras el servidor no ha escuchado.
  const prodFrameSources = prodCsp.match(/(?:^|;)\s*frame-src\s+([^;]+)/)?.[1] ?? '';
  assert(prodFrameSources.includes("'self'"), 'production frames include self');
  assert(
    /(\$\{previewFrameSrc\}|127\.0\.0\.1:\*)/.test(prodFrameSources),
    'production frames only self and the pinned loopback page server',
  );
  assert(
    /\.originUrl\(\)/.test(source)
      && /previewOrigin \|\| 'http:\/\/127\.0\.0\.1:\*'/.test(source)
      && /frame-src 'self' http:\/\/localhost:5173 \$\{previewFrameSrc\}/.test(source),
    'dev and prod CSP pin the loopback preview in frame-src',
  );
  assert(/startsWith\('http:\/\/127\.0\.0\.1:'\) && require\('\.\/agent-preview'\)\.isPage\(details\.url\)/.test(source),
    'only registered agent pages keep their own CSP');

  assert(
    source.includes('onBeforeSendHeaders') && /delete\s+requestHeaders\.(R|r)eferer/.test(source),
    'cross-origin Referer is stripped (Icecast anti-hotlink 403s)',
  );

  assert(
    /\\\*\\\.supabase\\\.co/.test(source) && source.includes('_resolvePinnedSupabaseHost'),
    'CSP supports optional Supabase host pinning via env',
  );

  console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
  finish();
}

run();
