const { readSecureJson, writeSecureJson, clearSecureJson } = require('./autoimg-secure-storage');

const SESSION_FILE = 'supabase-session.json';
const SESSION_NS = 'session';
const MAX_BLOB_BYTES = 256 * 1024;

const SESSION_METHODS = new Set([
  'supabase_session_get',
  'supabase_session_put',
  'supabase_session_clear',
]);

function _validateBlob(blob) {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
    throw new Error('La sesión de Supabase debe ser un objeto de textos');
  }
  for (const [key, value] of Object.entries(blob)) {
    if (typeof value !== 'string') {
      throw new Error('La sesión de Supabase solo acepta valores de texto');
    }
    if (!key.trim()) {
      throw new Error('La sesión de Supabase no acepta claves vacías');
    }
  }
  if (Buffer.byteLength(JSON.stringify(blob), 'utf8') > MAX_BLOB_BYTES) {
    throw new Error('La sesión de Supabase excede el límite de almacenamiento');
  }
}

function handleSupabaseSessionCall(method, params = {}) {
  switch (method) {
    case 'supabase_session_get':
      return { handled: true, result: { blob: readSecureJson(SESSION_FILE, SESSION_NS) || null } };
    case 'supabase_session_put':
      _validateBlob(params.blob);
      writeSecureJson(SESSION_FILE, SESSION_NS, params.blob);
      return { handled: true, result: { success: true } };
    case 'supabase_session_clear':
      clearSecureJson(SESSION_FILE);
      return { handled: true, result: { success: true } };
    default:
      return { handled: false };
  }
}

module.exports = { SESSION_METHODS, handleSupabaseSessionCall };
