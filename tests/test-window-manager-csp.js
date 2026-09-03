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

  const devMatch = source.match(/\? "([^"]+)"\s*:\s*"/);
  const prodMatch = source.match(/:\s*"default-src 'self';[^"]+"/);

  assert(devMatch, 'dev CSP string is present');
  assert(prodMatch, 'prod CSP string is present');

  const devCsp = devMatch?.[1] ?? '';
  const prodCsp = prodMatch?.[0].slice(2).replace(/"$/, '') ?? '';

  for (const csp of [devCsp, prodCsp]) {
    assert(csp.includes('https://fonts.googleapis.com'), 'style-src allows fonts.googleapis.com');
    assert(csp.includes('https://fonts.gstatic.com'), 'font-src allows fonts.gstatic.com');
    assert(/https:\/\/[\w.*-]+\.supabase\.co/.test(csp), 'connect-src allows Supabase HTTPS');
    assert(/wss:\/\/[\w.*-]+\.supabase\.co/.test(csp), 'connect-src allows Supabase Realtime WSS');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();