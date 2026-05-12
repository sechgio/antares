const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const targets = [
  path.join(projectRoot, 'dist-electron', 'win-unpacked'),
  path.join(projectRoot, 'dist-electron', 'linux-unpacked'),
  path.join(projectRoot, 'dist-electron', 'mac'),
  path.join(projectRoot, 'dist'),
  path.join(projectRoot, 'frontend', 'dist'),
  path.join(projectRoot, 'backend', 'build'),
  path.join(projectRoot, 'backend', 'dist'),
];

function assertInsideProject(targetPath) {
  const relative = path.relative(projectRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean path outside project: ${targetPath}`);
  }
}

for (const target of targets) {
  assertInsideProject(target);
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`[clean-after-package] Removed ${target}`);
}
