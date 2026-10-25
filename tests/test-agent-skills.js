const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, [
  path.join(root, 'frontend/node_modules/vitest/vitest.mjs'),
  'run', '--config', path.join(root, 'tests/vitest.skills.config.mjs'),
], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
