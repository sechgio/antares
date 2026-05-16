// tests/test-electron-path.js
// Tests for backend-command.js - Python path resolution
const fs = require('fs');
const os = require('os');
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
assert(devWin.cmd.toLowerCase().includes('python'), 'Dev mode win32 should use a Python command');
assert(devWin.args.length > 0, 'Dev mode should have args');
assert(devWin.args[0].includes('main.py'), 'Dev mode should point to main.py');

// Test 2: Dev mode prefers local venv on win32
console.log('\nTest 2: Dev mode prefers local venv on win32');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-backend-command-'));
const fakeElectronDir = path.join(tmpRoot, 'electron');
const fakeVenvPython = path.join(tmpRoot, 'venv312', 'Scripts', 'python.exe');
fs.mkdirSync(fakeElectronDir, { recursive: true });
fs.mkdirSync(path.dirname(fakeVenvPython), { recursive: true });
fs.writeFileSync(fakeVenvPython, '');
const devWinWithVenv = getBackendCommand(true, 'win32', fakeElectronDir);
assert(devWinWithVenv.cmd === fakeVenvPython, 'Dev mode should prefer the local venv when it exists');

// Test 3: Dev mode on linux
console.log('\nTest 3: Dev mode on linux');
const devLinux = getBackendCommand(true, 'linux', __dirname);
// On Windows, path.join uses backslashes, but the command should reference 'python' not 'python.exe'
assert(!devLinux.cmd.includes('python.exe'), 'Dev mode linux should not use python.exe');
assert(devLinux.cmd.includes('python'), 'Dev mode linux should use python');

// Test 4: Production mode on win32
console.log('\nTest 4: Production mode on win32');
const prodWin = getBackendCommand(false, 'win32');
assert(prodWin.cmd.includes('AntaresBackend.exe'), 'Prod mode win32 should use .exe');
assert(prodWin.args.length === 0, 'Prod mode should have no args');

// Test 5: Production mode on linux
console.log('\nTest 5: Production mode on linux');
const prodLinux = getBackendCommand(false, 'linux');
assert(!prodLinux.cmd.includes('.exe'), 'Prod mode linux should not use .exe');
assert(prodLinux.cmd.includes('AntaresBackend'), 'Prod mode should use AntaresBackend');
assert(prodLinux.args.length === 0, 'Prod mode should have no args');

// Test 6: Fallback paths in dev mode
console.log('\nTest 6: Dev mode includes fallback paths');
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
