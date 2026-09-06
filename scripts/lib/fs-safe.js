const fs = require('fs');
const path = require('path');
const { ROOT } = require('./loop-utils');

function assertInsideProject(targetPath, root = ROOT) {
  const relative = path.relative(root, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean path outside project: ${targetPath}`);
  }
  return targetPath;
}

function removeInsideProject(targetPath, root = ROOT) {
  assertInsideProject(targetPath, root);
  fs.rmSync(targetPath, { recursive: true, force: true });
}

module.exports = { assertInsideProject, removeInsideProject };
