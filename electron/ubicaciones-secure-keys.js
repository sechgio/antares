const { readSecureJson, writeSecureJson } = require('./autoimg-secure-storage');

const FILE = 'ubicaciones-api-keys.json';
const NS = 'ubicaciones_api_keys';

const ALLOWED_KEYS = new Set([
  'google',
  'mapbox',
  'maptiler',
  'stadia',
  'geoapify',
  'thunderforest',
]);

function _sanitizeKeys(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    const s = String(v || '').trim();
    if (s) out[k] = s.slice(0, 512);
  }
  return out;
}

function _maskKey(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

/** Full secrets — main process only (map IPC injection). */
function getUbicacionesApiKeys() {
  const data = readSecureJson(FILE, NS);
  return _sanitizeKeys(data);
}

/** Masked view for the renderer + configured flags. */
function getMaskedUbicacionesApiKeys() {
  const full = getUbicacionesApiKeys();
  const keys = {};
  const configured = {};
  for (const provider of ALLOWED_KEYS) {
    const value = full[provider] || '';
    configured[provider] = value.length > 0;
    keys[provider] = value ? _maskKey(value) : '';
  }
  return { keys, configured };
}

/** Session cache — avoid OS keychain I/O on every preview/generate call. */
const _resolveCache = new Map();

function clearProviderApiKeyCache() {
  _resolveCache.clear();
}

function setUbicacionesApiKeys(keys) {
  const safe = _sanitizeKeys(keys);
  writeSecureJson(FILE, NS, safe);
  // Keys changed — drop stale empty/old resolutions so the next IPC injects fresh values.
  clearProviderApiKeyCache();
  return safe;
}

function resolveProviderApiKey(provider, fallbackFromRenderer) {
  const cacheKey = `${provider || ''}::${String(fallbackFromRenderer || '')}`;
  if (_resolveCache.has(cacheKey)) return _resolveCache.get(cacheKey);

  const full = getUbicacionesApiKeys();
  const fromStore = full[String(provider || '').trim()] || '';
  let resolved = '';
  if (fromStore) {
    resolved = fromStore;
  } else {
    const fb = String(fallbackFromRenderer || '').trim();
    // Ignore masked placeholders from the renderer.
    if (fb && !fb.startsWith('••••')) resolved = fb.slice(0, 512);
  }
  _resolveCache.set(cacheKey, resolved);
  return resolved;
}

module.exports = {
  FILE,
  NS,
  ALLOWED_KEYS,
  getUbicacionesApiKeys,
  getMaskedUbicacionesApiKeys,
  setUbicacionesApiKeys,
  resolveProviderApiKey,
  clearProviderApiKeyCache,
};
