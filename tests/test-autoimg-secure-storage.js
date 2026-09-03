
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const secure = require('../electron/autoimg-secure-storage');

const filename = `secure-storage-${process.pid}-${crypto.randomUUID()}.json`;
const namespace = `secure-storage-test-${process.pid}`;
const filePath = path.join(os.tmpdir(), 'antares-autoimg', filename);

function cleanup() {
  let temporaryFiles = [];
  try {
    temporaryFiles = fs.readdirSync(path.dirname(filePath), { withFileTypes: true })
    .filter((entry) => entry.name.startsWith(`${filename}.`) && entry.name.endsWith('.tmp'))
    .map((entry) => path.join(path.dirname(filePath), entry.name));
  } catch {
    // The storage directory may not exist on the first test run.
  }
  for (const candidate of [filePath, ...temporaryFiles]) {
    try { fs.unlinkSync(candidate); } catch { /* already absent */ }
  }
}

cleanup();

try {
  const first = { access_token: 'access', refresh_token: 'refresh', expiry_date: 123 };
  secure.writeSecureJson(filename, namespace, first);
  assert.deepStrictEqual(secure.readSecureJson(filename, namespace), first, 'secure value round-trips');

  const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.strictEqual(envelope.v, 1, 'headless tests retain the legacy fallback envelope');

  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = (target, ...args) => {
    if (String(target).endsWith('.tmp')) throw new Error('simulated disk failure');
    return originalWriteFileSync(target, ...args);
  };
  try {
    assert.throws(
      () => secure.writeSecureJson(filename, namespace, { access_token: 'replacement' }),
      /simulated disk failure/,
      'write failures propagate to callers',
    );
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }

  assert.deepStrictEqual(
    secure.readSecureJson(filename, namespace),
    first,
    'failed replacement leaves the previous envelope intact',
  );

  fs.writeFileSync(filePath, '{not-json');
  assert.strictEqual(secure.readSecureJson(filename, namespace), null, 'corrupt envelopes recover as empty state');

  console.log('[PASS] AutoIMG secure storage is atomic and recovers from corruption.');
} finally {
  cleanup();
}
