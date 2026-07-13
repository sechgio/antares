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
