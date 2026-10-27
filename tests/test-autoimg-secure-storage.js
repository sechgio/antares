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
const modulePath = require.resolve('../electron/autoimg-secure-storage');

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

function withElectronStub() {
  const originalLoad = Module._load;
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
  delete require.cache[modulePath];
  return function restore() {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  };
}

function writeLegacyV1Envelope(payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ v: 1, data: secure.encryptPayload(namespace, payload) }));
}

try {
  assert.strictEqual(
    secure.isConfidentialStorage(),
    false,
    'sin safeStorage no hay almacenamiento confidencial',
  );
  assert.throws(
    () => secure.writeSecureJson(filename, namespace, { access_token: 'a', refresh_token: 'b', expiry_date: 1 }),
    /no guardará los secretos sin cifrado confidencial/,
    'sin safeStorage la escritura falla en voz alta en lugar de ofuscar con la clave derivada',
  );
  assert(!fs.existsSync(filePath), 'la escritura rechazada no deja ningún sobre en disco');

  const legacy = { access_token: 'legacy-access', refresh_token: 'legacy-refresh', expiry_date: 42 };
  writeLegacyV1Envelope(legacy);
  assert.deepStrictEqual(
    secure.readSecureJson(filename, namespace),
    legacy,
    'los sobres v1 legados siguen legibles sin safeStorage',
  );
  assert.strictEqual(
    JSON.parse(fs.readFileSync(filePath, 'utf8')).v,
    1,
    'sin safeStorage el sobre v1 no se reescribe',
  );

  fs.writeFileSync(filePath, '{not-json');
  assert.strictEqual(secure.readSecureJson(filename, namespace), null, 'corrupt envelopes recover as empty state');

  cleanup();

  const restoreStub = withElectronStub();
  const confidential = require('../electron/autoimg-secure-storage');
  try {
    assert.strictEqual(
      confidential.isConfidentialStorage(),
      true,
      'con safeStorage disponible el almacenamiento es confidencial',
    );

    const first = { access_token: 'access', refresh_token: 'refresh', expiry_date: 123 };
    confidential.writeSecureJson(filename, namespace, first);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(filePath, 'utf8')).v,
      2,
      'con safeStorage el sobre se guarda como v2',
    );
    assert.deepStrictEqual(
      confidential.readSecureJson(filename, namespace),
      first,
      'secure value round-trips',
    );

    const originalWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = (target, ...args) => {
      if (String(target).endsWith('.tmp')) throw new Error('simulated disk failure');
      return originalWriteFileSync(target, ...args);
    };
    try {
      assert.throws(
        () => confidential.writeSecureJson(filename, namespace, { access_token: 'replacement' }),
        /simulated disk failure/,
        'write failures propagate to callers',
      );
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
    assert.deepStrictEqual(
      confidential.readSecureJson(filename, namespace),
      first,
      'failed replacement leaves the previous envelope intact',
    );

    cleanup();
    const upgradePayload = { access_token: 'upgrade-probe', refresh_token: 'refresh', expiry_date: 456 };
    writeLegacyV1Envelope(upgradePayload);

    const appLog = require('../electron/app-log');
    const events = [];
    const originalAppend = appLog.appendLogEvent;
    appLog.appendLogEvent = (level, event, fields) => { events.push({ level, event, fields }); };
    fs.writeFileSync = (written, ...args) => {
      if (String(written).endsWith('.tmp')) throw new Error('simulated disk failure');
      return originalWriteFileSync(written, ...args);
    };
    try {
      assert.deepStrictEqual(
        confidential.readSecureJson(filename, namespace),
        upgradePayload,
        'a failed v1 to v2 upgrade still returns the payload',
      );
      const failures = events.filter((entry) => entry.event === 'autoimg.storage_upgrade_failed');
      assert.strictEqual(failures.length, 1, 'the failed upgrade is telemetered once');
      assert.strictEqual(failures[0].level, 'WARN');
      assert.strictEqual(failures[0].fields.outcome, 'failed');
      assert.match(failures[0].fields.message, /simulated disk failure/);
      assert.strictEqual(
        JSON.parse(fs.readFileSync(filePath, 'utf8')).v,
        1,
        'the v1 envelope survives the failed rewrite',
      );
    } finally {
      fs.writeFileSync = originalWriteFileSync;
      appLog.appendLogEvent = originalAppend;
    }
  } finally {
    restoreStub();
  }

  console.log('[PASS] AutoIMG secure storage refuses to persist secrets without safeStorage and keeps v1 reads intact.');
} finally {
  cleanup();
}
