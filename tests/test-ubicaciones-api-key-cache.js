
const { assert, finish, stubModule, evictModule } = require('./helpers/harness');

function run() {
  console.log('Testing ubicaciones API key resolve cache...\n');

    let stored = {};
  stubModule('electron/autoimg-secure-storage.js', {
      readSecureJson: () => ({ ...stored }),
      writeSecureJson: (_file, _ns, data) => {
        stored = { ...data };
      },
    });

  evictModule('electron/ubicaciones-secure-keys.js');
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

  finish();
}

run();
