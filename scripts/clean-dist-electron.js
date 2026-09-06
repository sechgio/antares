const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/loop-utils');
const { assertInsideProject } = require('./lib/fs-safe');

const outputDir = path.join(ROOT, 'dist-electron');

assertInsideProject(outputDir);

try {
  fs.rmSync(outputDir, { recursive: true, force: true });
} catch (err) {
  const code = err && err.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') {
    console.error(
      `[clean-dist-electron] No se pudo borrar ${outputDir} (${code}).\n` +
        'Cierra Antares.exe (win-unpacked) y vuelve a intentar.',
    );
    process.exit(1);
  }
  throw err;
}

console.log(`[clean-dist-electron] Removed ${outputDir}`);
