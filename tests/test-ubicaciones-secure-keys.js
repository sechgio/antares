/**
 * Regresión: claves de mapa Ubicaciones en almacenamiento cifrado y sin
 * localStorage.setItem para apiKeys en el renderer.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UBICACIONES_VIEW = path.join(ROOT, 'frontend', 'src', 'components', 'UbicacionesView.tsx');

function main() {
  let failed = false;

  const source = fs.readFileSync(UBICACIONES_VIEW, 'utf8');
  if (/localStorage\.setItem\(\s*['"]antares:ubicaciones:apiKeys['"]/.test(source)) {
    console.error('[FAIL] UbicacionesView still writes apiKeys to localStorage');
    failed = true;
  }

  if (!/function clearPlaintextApiKeys\(/.test(source)) {
    console.error('[FAIL] UbicacionesView missing clearPlaintextApiKeys helper');
    failed = true;
  }

  if (!/clearPlaintextApiKeys\(\)/.test(source)) {
    console.error('[FAIL] UbicacionesView never calls clearPlaintextApiKeys');
    failed = true;
  }

  if (/ubicacionesKeysSet\([^)]*\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(source)) {
    console.error('[FAIL] UbicacionesView still swallows ubicacionesKeysSet errors silently');
    failed = true;
  }

  if (!/Failed to persist ubicaciones API keys/.test(source)) {
    console.error('[FAIL] UbicacionesView missing persist error logging');
    failed = true;
  }

  const { encryptPayload, decryptPayload } = require(path.join(ROOT, 'electron', 'autoimg-secure-storage'));
  const { FILE, NS, getUbicacionesApiKeys, setUbicacionesApiKeys } = require(path.join(ROOT, 'electron', 'ubicaciones-secure-keys'));

  const payload = { google: 'test-google-key', mapbox: 'pk.test' };
  const encoded = encryptPayload(NS, payload);
  const roundtrip = decryptPayload(NS, encoded);
  if (roundtrip.google !== payload.google || roundtrip.mapbox !== payload.mapbox) {
    console.error('[FAIL] encrypt/decrypt roundtrip mismatch');
    failed = true;
  }

  const filePath = path.join(os.tmpdir(), 'antares-autoimg', FILE);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore missing file
  }

  const saved = setUbicacionesApiKeys({ maptiler: 'mt-key', google: 'g-key', bogus: 'x' });
  if (saved.maptiler !== 'mt-key' || saved.google !== 'g-key' || saved.bogus) {
    console.error('[FAIL] setUbicacionesApiKeys sanitize mismatch:', saved);
    failed = true;
  }

  const loaded = getUbicacionesApiKeys();
  if (loaded.maptiler !== 'mt-key' || loaded.google !== 'g-key' || loaded.bogus) {
    console.error('[FAIL] getUbicacionesApiKeys load mismatch:', loaded);
    failed = true;
  }

  const { getMaskedUbicacionesApiKeys } = require(path.join(ROOT, 'electron', 'ubicaciones-secure-keys'));
  const masked = getMaskedUbicacionesApiKeys();
  if (masked.keys.google === 'g-key' || !masked.configured.google) {
    console.error('[FAIL] getMaskedUbicacionesApiKeys should mask secrets:', masked);
    failed = true;
  }

  // ── B8: el cache de resolución está acotado ──
  // Un renderer que enviara fallbacks variables por llamada (hoy envía el
  // placeholder enmascarado estable) haría crecer el Map sin cota. Con store
  // vacío, cada fallback distinto genera una entrada nueva: sin tope serían
  // 40; con tope deben quedar ≤ _RESOLVE_CACHE_MAX (32).
  {
    const ubicacionesKeys = require(path.join(ROOT, 'electron', 'ubicaciones-secure-keys'));
    ubicacionesKeys.clearProviderApiKeyCache();
    ubicacionesKeys.setUbicacionesApiKeys({}); // store vacío → cada resolución usa el fallback
    try {
      for (let i = 0; i < 40; i++) {
        ubicacionesKeys.resolveProviderApiKey('google', `fallback-${i}`);
      }
      const size = ubicacionesKeys.__resolveCacheSizeForTests();
      if (size > 32) {
        console.error(`[FAIL] resolve cache unbounded: ${size} entries (max 32)`);
        failed = true;
      }
    } finally {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }

  if (failed) {
    process.exit(1);
  }

  console.log('[PASS] Ubicaciones secure keys: no localStorage write; roundtrip OK.');
  process.exit(0);
}

main();
