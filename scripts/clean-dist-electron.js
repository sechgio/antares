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
fs.rmSync(outputDir, { recursive: true, force: true });
console.log(`[clean-dist-electron] Removed ${outputDir}`);
