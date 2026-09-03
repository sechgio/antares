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
  console.log('Testing ubicaciones API key resolve cache...\n');

  const storagePath = require.resolve('../electron/autoimg-secure-storage.js');
  let stored = {};
  require.cache[storagePath] = {
    id: storagePath,
    filename: storagePath,
    loaded: true,
    exports: {
      readSecureJson: () => ({ ...stored }),
      writeSecureJson: (_file, _ns, data) => {
        stored = { ...data };
      },
    },
  };

  const keysPath = require.resolve('../electron/ubicaciones-secure-keys.js');
  delete require.cache[keysPath];
  const {
    resolveProviderApiKey,
    setUbicacionesApiKeys,
    clearProviderApiKeyCache,
  } = require('../electron/ubicaciones-secure-keys.js');

  clearProviderApiKeyCache();
  stored = {};

  const emptyFirst = resolveProviderApiKey('google', '');
  assert(emptyFirst === '', 'empty store + empty fallback resolves to empty');

  setUbicacionesApiKeys({ google: 'new-secret-key' });
  const afterSet = resolveProviderApiKey('google', '');
  assert(afterSet === 'new-secret-key', 'keys_set clears cache so new key is used');

  setUbicacionesApiKeys({ google: 'rotated-key' });
  const afterRotate = resolveProviderApiKey('google', '');
  assert(afterRotate === 'rotated-key', 'rotated key is visible after second set');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));
  if (failed > 0) process.exit(1);
}

run();
