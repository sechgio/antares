const fs = require('fs');
const path = require('path');

const apiPath = path.join(__dirname, '..', 'frontend', 'src', 'api.ts');
const apiSource = fs.readFileSync(apiPath, 'utf8');

if (/export interface DbDetectKeyColumnResult\b/.test(apiSource)) {
  console.error('[FAIL] Removed db_detect_key_column API type remains exported from frontend/src/api.ts');
  process.exit(1);
}

console.log('[PASS] Removed db_detect_key_column API type is absent from frontend/src/api.ts');
