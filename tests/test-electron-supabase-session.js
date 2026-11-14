const Module = require('module');
const os = require('os');
const path = require('path');

const { assertOrExit: assert } = require('./helpers/harness');

const userData = path.join(os.tmpdir(), `antares-supabase-session-test-${process.pid}-${Math.random().toString(36).slice(2)}`);

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getName: () => 'antares-test', getPath: () => userData },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (text) => Buffer.from(text, 'utf8'),
        decryptString: (buf) => buf.toString('utf8'),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { SESSION_METHODS, handleSupabaseSessionCall } = require('../electron/supabase-session-handlers');

function expectResult(actual, expected, label) {
  assert(
    actual && actual.handled === true && JSON.stringify(actual.result) === JSON.stringify(expected),
    label,
  );
}

function expectSuccess(actual, label) {
  assert(actual && actual.handled === true && actual.result && actual.result.success === true, label);
}

function throwsWith(fn, match, label) {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    if (match) assert(new RegExp(match).test(String(err && err.message)), `${label}: mensaje "${match}"`);
  }
  assert(threw, `${label}: lanza error`);
}

assert(
  JSON.stringify([...SESSION_METHODS].sort())
    === JSON.stringify(['supabase_session_get', 'supabase_session_put']),
  'SESSION_METHODS cubre los métodos del catálogo',
);

const unknown = handleSupabaseSessionCall('supabase_session_unknown', {});
assert(unknown && unknown.handled === false, 'método desconocido no se atiende aquí');

expectResult(handleSupabaseSessionCall('supabase_session_get', {}), { blob: null }, 'get inicial devuelve blob null');

const initialBlob = {
  'sb-test-auth-token': JSON.stringify({ access_token: 'AT', refresh_token: 'RT', token_type: 'bearer' }),
};
expectSuccess(handleSupabaseSessionCall('supabase_session_put', { blob: initialBlob }), 'put inicial');
expectResult(handleSupabaseSessionCall('supabase_session_get', {}), { blob: initialBlob }, 'get round-trip');

const rotated = { ...initialBlob, 'sb-test-auth-token': JSON.stringify({ access_token: 'AT2', refresh_token: 'RT2' }) };
expectSuccess(handleSupabaseSessionCall('supabase_session_put', { blob: rotated }), 'put con token rotado');
expectResult(handleSupabaseSessionCall('supabase_session_get', {}), { blob: rotated }, 'get tras rotación');

throwsWith(() => handleSupabaseSessionCall('supabase_session_put', { blob: [] }), 'objeto', 'blob array rechazado');
throwsWith(() => handleSupabaseSessionCall('supabase_session_put', { blob: null }), 'objeto', 'blob null rechazado');
throwsWith(() => handleSupabaseSessionCall('supabase_session_put', { blob: { key: 41 } }), 'texto', 'valor no texto rechazado');
throwsWith(() => handleSupabaseSessionCall('supabase_session_put', { blob: { '': 'valor' } }), 'vacías', 'clave vacía rechazada');
throwsWith(
  () => handleSupabaseSessionCall('supabase_session_put', { blob: { k: 'x'.repeat(300 * 1024) } }),
  'límite',
  'blob sobredimensionado rechazado',
);

const cleared = handleSupabaseSessionCall('supabase_session_clear', {});
assert(cleared && cleared.handled === false, 'supabase_session_clear retirado no se atiende');

console.log('[PASS] sesión de Supabase cifrada en main (get/put + validación de blob)');
