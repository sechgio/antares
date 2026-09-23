const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
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
  }
  for (const candidate of [filePath, ...temporaryFiles]) {
    try { fs.unlinkSync(candidate); } catch {}
  }
}

cleanup();

function testUpgradeFailureIsTelemetered({ name, namespace, payload }) {
  // readSecureJson reescribe a v2 cuando encuentra un sobre v1 con safeStorage
  // disponible; en pruebas headless ese electrón no existe, así que se inyecta.
  secure.writeSecureJson(name, namespace, payload);

  const appLog = require('../electron/app-log');
  const events = [];
  const originalAppend = appLog.appendLogEvent;
  const originalWriteFileSync = fs.writeFileSync;
  const originalLoad = Module._load;
  const modulePath = require.resolve('../electron/autoimg-secure-storage');

  appLog.appendLogEvent = (level, event, fields) => { events.push({ level, event, fields }); };
  fs.writeFileSync = (written, ...args) => {
    if (String(written).endsWith('.tmp')) throw new Error('simulated disk failure');
    return originalWriteFileSync(written, ...args);
  };
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getName: () => 'antares', getPath: () => path.join(os.tmpdir(), 'antares-autoimg') },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (text) => Buffer.from(text, 'utf8'),
          decryptString: (buf) => buf.toString('utf8'),
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[modulePath];
    const withSafeStorage = require('../electron/autoimg-secure-storage');
    assert.deepStrictEqual(
      withSafeStorage.readSecureJson(name, namespace),
      payload,
      'a failed v1 to v2 upgrade still returns the payload',
    );
    const failures = events.filter((entry) => entry.event === 'autoimg.storage_upgrade_failed');
    assert.strictEqual(failures.length, 1, 'the failed upgrade is telemetered once');
    assert.strictEqual(failures[0].level, 'WARN');
    assert.strictEqual(failures[0].fields.outcome, 'failed');
    assert.match(failures[0].fields.message, /simulated disk failure/);
    assert.strictEqual(
      secure.readSecureJson(name, namespace).access_token,
      payload.access_token,
      'the v1 envelope survives the failed rewrite',
    );
  } finally {
    delete require.cache[modulePath];
    Module._load = originalLoad;
    fs.writeFileSync = originalWriteFileSync;
    appLog.appendLogEvent = originalAppend;
  }
}

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

  testUpgradeFailureIsTelemetered({
    name: filename,
    namespace,
    payload: { access_token: 'upgrade-probe', refresh_token: 'refresh', expiry_date: 456 },
  });

  console.log('[PASS] AutoIMG secure storage is atomic and recovers from corruption.');
} finally {
  cleanup();
}
