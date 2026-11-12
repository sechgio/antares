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
    /callback\(\s*isTrustedMainFrame\(webContents\)\s*&&\s*allowedPermissions\.has\(permission\)\s*\)/.test(source),
    'request handler grants only listed permissions to the trusted main frame and denies the rest',
  );
  assert(
    /isTrustedMainFrame\(webContents\)\s*&&\s*allowedPermissions\.has\(permission\)/.test(source),
    'check handler answers from the same allowlist for the trusted main frame',
  );
  assert(
    /webContents\.id\s*!==\s*mainWindow\.webContents\.id/.test(source)
      && source.includes('isTrustedRendererUrl(String(webContents.getURL()'),
    'permission scope checks main-window identity and trusted URL',
  );

  assert(
    /parsed\.protocol === 'https:'[\s\S]*shell\.openExternal/.test(source),
    'external opening is restricted to https targets',
  );
  assert(
    /external_cleartext/.test(source),
    'cleartext http external openings are rejected and logged',
  );

  assert(
    source.includes("on('will-redirect'") && /main_frame_redirect_off_origin/.test(source),
    'main-frame redirects are validated against the same origin rules',
  );

  console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
  finish();
}

run();
