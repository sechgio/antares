const { UBICACIONES_METHODS } = require('./ubicaciones-ipc-methods');
const { getUbicacionesApiKeys, setUbicacionesApiKeys } = require('./ubicaciones-secure-keys');

async function handleUbicacionesCall(method, params = {}) {
  if (!UBICACIONES_METHODS.has(method)) return { handled: false };

  switch (method) {
    case 'ubicaciones_keys_get':
      return { handled: true, result: { keys: getUbicacionesApiKeys() } };

    case 'ubicaciones_keys_set': {
      const raw = params.keys && typeof params.keys === 'object' ? params.keys : {};
      const saved = setUbicacionesApiKeys(raw);
      return { handled: true, result: { keys: saved } };
    }

    default:
      return { handled: false };
  }
}

module.exports = { handleUbicacionesCall };
