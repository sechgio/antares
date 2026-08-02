const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'dist-electron');

function assertInsideProject(targetPath) {
  const relative = path.relative(projectRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean path outside project: ${targetPath}`);
  }
}

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
