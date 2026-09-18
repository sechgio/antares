const fs = require('fs');
const path = require('path');

const apiPath = path.join(__dirname, '..', 'frontend', 'src', 'api.ts');
const apiDir = path.join(__dirname, '..', 'frontend', 'src', 'api');
const sources = [apiPath];
for (const file of fs.readdirSync(apiDir).filter((f) => f.endsWith('.ts'))) {
  sources.push(path.join(apiDir, file));
}

for (const sourcePath of sources) {
  const apiSource = fs.readFileSync(sourcePath, 'utf8');
  if (/export (?:interface|type) DbDetectKeyColumnResult\b/.test(apiSource)) {
    console.error(`[FAIL] Removed db_detect_key_column API type remains exported from ${path.relative(path.join(__dirname, '..'), sourcePath)}`);
    process.exit(1);
  }
}

console.log('[PASS] Removed db_detect_key_column API type is absent from frontend/src/api.ts and frontend/src/api/');
