// Guardrails for keeping packaged app size under control.
const fs = require('fs');
const path = require('path');

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

function readProjectFile(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
}

console.log('Testing build size guardrails...\n');

const spec = readProjectFile('backend', 'backend.spec');
for (const moduleName of ['scipy', 'numba', 'llvmlite', 'pandas._testing']) {
  assert(spec.includes(`'${moduleName}'`) || spec.includes(`"${moduleName}"`), `PyInstaller should exclude optional heavy module ${moduleName}`);
}
assert(spec.includes("backend/templates"), 'PyInstaller should bundle backend HTML templates for report generator');

const builderConfig = readProjectFile('electron-builder.yml');
assert(/electronLanguages:\s*\n\s*-\s*es\s*\n\s*-\s*en-US/m.test(builderConfig), 'electron-builder should keep only Spanish and English Electron locales');
assert(builderConfig.includes('compression: maximum'), 'electron-builder should use maximum compression for installer artifacts');
assert(builderConfig.includes('- "assets/icon.ico"'), 'electron-builder should keep only the runtime window icon from assets');
assert(!builderConfig.includes('- "assets/**/*"'), 'electron-builder should not duplicate all assets inside app.asar');
assert(!/extraResources:\s*\n\s*-\s*from:\s*assets/m.test(builderConfig), 'electron-builder should not duplicate assets as external resources');

const nodeModulesInclude = builderConfig.lastIndexOf('- "node_modules/**/*"');
const sourcemapExclude = builderConfig.lastIndexOf('- "!**/node_modules/**/*.map"');
assert(nodeModulesInclude >= 0, 'electron-builder should explicitly include runtime node_modules');
assert(sourcemapExclude > nodeModulesInclude, 'node_modules sourcemap exclusion should run after the broad include');

const backendBuild = readProjectFile('scripts', 'build-backend.js');
for (const staleName of ['CosmoBackend.exe', 'HidroConvertBackend.exe']) {
  assert(backendBuild.includes(staleName), `backend build should guard against stale ${staleName}`);
}
assert(backendBuild.includes('rmSync'), 'backend build should clean stale PyInstaller output before rebuilding');

const packageJson = JSON.parse(readProjectFile('package.json'));
assert(packageJson.scripts['clean:dist-electron'] === 'node scripts/clean-dist-electron.js', 'package scripts should expose a safe Electron output cleanup command');
assert(packageJson.scripts['clean:after-package'] === 'node scripts/clean-after-package.js', 'package scripts should expose a post-package cleanup command');
for (const scriptName of ['build:win', 'build:mac', 'build:linux', 'build:all', 'dist', 'dist:dir']) {
  assert(packageJson.scripts[scriptName].includes('npm run clean:dist-electron && electron-builder'), `${scriptName} should clean stale Electron artifacts before packaging`);
}
for (const scriptName of ['build:win', 'build:mac', 'build:linux', 'build:all', 'dist']) {
  assert(packageJson.scripts[scriptName].includes('npm run clean:after-package'), `${scriptName} should remove unpacked/staging artifacts after packaging`);
}
assert(!packageJson.scripts['dist:dir'].includes('npm run clean:after-package'), 'dist:dir should keep unpacked output for inspection');

const electronClean = readProjectFile('scripts', 'clean-dist-electron.js');
assert(electronClean.includes('dist-electron'), 'Electron cleanup should target dist-electron only');
assert(electronClean.includes('assertInsideProject'), 'Electron cleanup should verify the output path before deleting');

const afterPackageClean = readProjectFile('scripts', 'clean-after-package.js');
for (const stalePath of ['win-unpacked', 'frontend', 'backend']) {
  assert(afterPackageClean.includes(stalePath), `post-package cleanup should remove ${stalePath} staging output`);
}
assert(afterPackageClean.includes('assertInsideProject'), 'post-package cleanup should verify paths before deleting');

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
