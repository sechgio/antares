const fs = require('fs');
const path = require('path');

const { assert, finish, counters } = require('./helpers/harness');

function run() {
  console.log('Testing default session permission handlers...\n');

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'window-manager.js'),
    'utf8',
  );

  assert(
    source.includes('setPermissionRequestHandler'),
    'default session installs a permission request handler',
  );
  assert(
    source.includes('setPermissionCheckHandler'),
    'default session installs a permission check handler',
  );

  const allowlistMatch = source.match(/allowedPermissions\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert(allowlistMatch !== null, 'permission allowlist is declared explicitly');
  const allowed = (allowlistMatch?.[1] ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/['"]/g, ''))
    .filter(Boolean);

  for (const permission of [
    'media',
    'display-capture',
    'clipboard-read',
    'clipboard-sanitized-write',
  ]) {
    assert(allowed.includes(permission), `allowlist includes ${permission}`);
  }
  assert(allowed.length === 4, 'allowlist stays minimal (deny-by-default, no extra grants)');

  assert(
    /callback\(allowedPermissions\.has\(permission\)\)/.test(source),
    'request handler grants only listed permissions and denies the rest',
  );
  assert(
    /=>\s*allowedPermissions\.has\(permission\)/.test(source),
    'check handler answers from the same allowlist',
  );

  console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
  finish();
}

run();
