const { readSecureJson, writeSecureJson } = require('./autoimg-secure-storage');

const FILE = 'ubicaciones-api-keys.json';
const NS = 'ubicaciones_api_keys';

const ALLOWED_KEYS = new Set(['google', 'mapbox', 'maptiler']);

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

function getUbicacionesApiKeys() {
  const data = readSecureJson(FILE, NS);
  return _sanitizeKeys(data);
}

function setUbicacionesApiKeys(keys) {
  const safe = _sanitizeKeys(keys);
  writeSecureJson(FILE, NS, safe);
  return safe;
}

module.exports = {
  FILE,
  NS,
  getUbicacionesApiKeys,
  setUbicacionesApiKeys,
};
