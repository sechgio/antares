const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function run() {
  console.log('Testing window-manager CSP for Google Fonts...\n');

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'window-manager.js'),
    'utf8',
  );

  const cspMatches = [...source.matchAll(/buildCsp\("([^"]+)"\)/g)];
  assert(cspMatches.length >= 2, 'dev and prod CSP strings are present');

  const devCsp = cspMatches[0]?.[1] ?? '';
  const prodCsp = cspMatches[1]?.[1] ?? '';

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
  }

  assert(
    /\\\*\\\.supabase\\\.co/.test(source) && source.includes('_resolvePinnedSupabaseHost'),
    'CSP supports optional Supabase host pinning via env',
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
