const path = require('path');
const { ROOT } = require('./lib/loop-utils');
const { removeInsideProject } = require('./lib/fs-safe');

const targets = [
  path.join(ROOT, 'dist-electron', 'win-unpacked'),
  path.join(ROOT, 'dist'),
  path.join(ROOT, 'frontend', 'dist'),
  path.join(ROOT, 'backend', 'build'),
  path.join(ROOT, 'backend', 'dist'),
];

for (const target of targets) {
  removeInsideProject(target);
  console.log(`[clean-after-package] Removed ${target}`);
}
