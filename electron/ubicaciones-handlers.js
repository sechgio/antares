const { UBICACIONES_METHODS } = require('./ubicaciones-ipc-methods');
const {
  getMaskedUbicacionesApiKeys,
  setUbicacionesApiKeys,
} = require('./ubicaciones-secure-keys');

async function handleUbicacionesCall(method, params = {}) {
  if (!UBICACIONES_METHODS.has(method)) return { handled: false };

  switch (method) {
    case 'ubicaciones_keys_get':
      return { handled: true, result: getMaskedUbicacionesApiKeys() };

    case 'ubicaciones_keys_set': {
      const raw = params.keys && typeof params.keys === 'object' ? params.keys : {};
      const { getUbicacionesApiKeys } = require('./ubicaciones-secure-keys');
      const existing = getUbicacionesApiKeys();
      const merged = { ...existing };
      for (const [k, v] of Object.entries(raw)) {
        const s = String(v || '').trim();
        if (!s || s.startsWith('••••')) continue;
        merged[k] = s;
      }
      const saved = setUbicacionesApiKeys(merged);
      return { handled: true, result: getMaskedUbicacionesApiKeys() };
    }

    default:
      return { handled: false };
  }
}

module.exports = { handleUbicacionesCall };
