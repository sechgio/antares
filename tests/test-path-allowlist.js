// Tests for electron/path-allowlist.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  registerAllowedReadPath,
  assertAllowedReadPath,
  assertPathNotSymlink,
  isAllowedReadPath,
  isPathInside,
  clearAllowedReadPaths,
} = require('../electron/path-allowlist');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function run() {
  console.log('Testing path allowlist...\n');
  clearAllowedReadPaths();

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-allowlist-'));
  try {
    const filePath = path.join(tempDir, 'photo.jpg');
    await fs.promises.writeFile(filePath, 'x');

    let rejected = false;
    try {
      assertAllowedReadPath(filePath);
    } catch (err) {
      rejected = /not allowed/i.test(err.message);
    }
    assert(rejected, 'unregistered path should be rejected');

    registerAllowedReadPath(filePath);
    assert(isAllowedReadPath(filePath), 'registered path should be allowed');
    assert(assertAllowedReadPath(filePath) === path.resolve(filePath), 'assertAllowedReadPath returns resolved path');

    assert(isPathInside(tempDir, filePath), 'isPathInside should match child file');
    assert(!isPathInside(tempDir, path.join(os.tmpdir(), 'other')), 'isPathInside should reject outside paths');

    if (process.platform !== 'win32') {
      const linkPath = path.join(tempDir, 'link.jpg');
      await fs.promises.symlink(filePath, linkPath);
      let symlinkRejected = false;
      try {
        registerAllowedReadPath(linkPath);
        assertPathNotSymlink(path.resolve(linkPath));
      } catch (err) {
        symlinkRejected = /symbolic links/i.test(err.message);
      }
      assert(symlinkRejected, 'symbolic links should be rejected');
    }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    clearAllowedReadPaths();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
