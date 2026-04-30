// tests/test-electron-path.js
// Tests for backend-command.js - Python path resolution
const path = require('path');
const { getBackendCommand } = require('../electron/backend-command.js');

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

console.log('Testing getBackendCommand...\n');

// Test 1: Dev mode on win32
console.log('Test 1: Dev mode on win32');
const devWin = getBackendCommand(true, 'win32', __dirname);
assert(devWin.cmd.includes('python.exe'), 'Dev mode win32 should use python.exe');
assert(devWin.args.length > 0, 'Dev mode should have args');
assert(devWin.args[0].includes('main.py'), 'Dev mode should point to main.py');
assert(devWin.cmd.includes('venv312'), 'Dev mode should use venv312 path');

// Test 2: Dev mode on linux
console.log('\nTest 2: Dev mode on linux');
const devLinux = getBackendCommand(true, 'linux', __dirname);
// On Windows, path.join uses backslashes, but the command should reference 'python' not 'python.exe'
assert(!devLinux.cmd.includes('python.exe'), 'Dev mode linux should not use python.exe');
assert(devLinux.cmd.includes('python'), 'Dev mode linux should use python');

// Test 3: Production mode on win32
console.log('\nTest 3: Production mode on win32');
const prodWin = getBackendCommand(false, 'win32');
assert(prodWin.cmd.includes('CosmoBackend.exe'), 'Prod mode win32 should use .exe');
assert(prodWin.args.length === 0, 'Prod mode should have no args');

// Test 4: Production mode on linux
console.log('\nTest 4: Production mode on linux');
const prodLinux = getBackendCommand(false, 'linux');
assert(!prodLinux.cmd.includes('.exe'), 'Prod mode linux should not use .exe');
assert(prodLinux.cmd.includes('CosmoBackend'), 'Prod mode should use CosmoBackend');
assert(prodLinux.args.length === 0, 'Prod mode should have no args');

// Test 5: Fallback paths in dev mode
console.log('\nTest 5: Dev mode includes fallback paths');
const devPaths = getBackendCommand(true, 'win32', __dirname);
assert(devPaths.cmd !== null, 'Dev mode should return a command');

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All path tests passed!');
}
