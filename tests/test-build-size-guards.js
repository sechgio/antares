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
for (const moduleName of ['scipy', 'numba', 'llvmlite', 'torch', 'tensorflow', 'cv2']) {
  assert(spec.includes(`'${moduleName}'`) || spec.includes(`"${moduleName}"`), `PyInstaller should exclude optional heavy module ${moduleName}`);
}
// pandas submodules (pandas._testing, pandas.io.json, pandas.io.parquet,
// pandas.io.sql) are imported internally by pandas itself — excluding them
// causes ModuleNotFoundError at startup in the frozen build. They must NOT
// be in the excludes list.
for (const moduleName of ['pandas._testing', 'pandas.io.json', 'pandas.io.parquet', 'pandas.io.sql']) {
  const inExcludes = new RegExp(`excludes=\\[[\\s\\S]*?'${moduleName.replace(/\./g, '\\.').replace(/'/g, "\\'")}'`).test(spec);
  assert(!inExcludes, `PyInstaller must NOT exclude ${moduleName} (pandas imports it internally)`);
}
// The spec uses a for-loop over a tuple of package names, so we check that
// each package name appears in the collect_submodules section.
assert(spec.includes("'pandas'") && spec.includes('collect_submodules'), 'PyInstaller should collect all pandas submodules via collect_submodules');
assert(spec.includes("'openpyxl'") && spec.includes('collect_submodules'), 'PyInstaller should collect all openpyxl submodules via collect_submodules');
assert(spec.includes("'weasyprint'") && spec.includes('collect_submodules'), 'PyInstaller should collect all weasyprint submodules via collect_submodules');
assert(spec.includes("'docx'") && spec.includes('collect_submodules'), 'PyInstaller should collect all python-docx submodules via collect_submodules');
assert(
  (spec.includes("'fitz'") || spec.includes("'pymupdf'")) && spec.includes('collect_submodules'),
  'PyInstaller should collect pymupdf/fitz for sellador page raster previews',
);
assert(spec.includes("'ssl'"), 'PyInstaller should include ssl for WeasyPrint HTTPSHandler');
assert(spec.includes("strip=False"), 'PyInstaller must not strip binaries (corrupts ssl DLLs on Windows)');
assert(spec.includes("'backend.handlers.templates'"), 'PyInstaller must hide-import lazy templates handler');
assert(spec.includes("'backend.handlers.canvas'"), 'PyInstaller must hide-import lazy canvas handler');
assert(spec.includes("collect_submodules('backend.handlers')") || spec.includes('collect_submodules("backend.handlers")'),
  'PyInstaller should collect_submodules(backend.handlers) as safety net for lazy registry');
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
for (const staleName of ['AntaresBackend.exe', 'HidroConvertBackend.exe']) {
  assert(backendBuild.includes(staleName), `backend build should guard against stale ${staleName}`);
}
assert(backendBuild.includes('rmSync'), 'backend build should clean stale PyInstaller output before rebuilding');

const packageJson = JSON.parse(readProjectFile('package.json'));
assert(packageJson.scripts['clean:dist-electron'] === 'node scripts/clean-dist-electron.js', 'package scripts should expose a safe Electron output cleanup command');
assert(packageJson.scripts['clean:after-package'] === 'node scripts/clean-after-package.js', 'package scripts should expose a post-package cleanup command');
assert(packageJson.scripts['build:win'].includes('npm run clean:dist-electron && electron-builder'), 'build:win should clean stale Electron artifacts before packaging');
assert(packageJson.scripts['build:win'].includes('npm run clean:after-package'), 'build:win should remove unpacked/staging artifacts after packaging');
assert(packageJson.scripts['dist'] === 'npm run build:win', 'dist should delegate to the Windows-only build');
assert(packageJson.scripts['dist:dir'].includes('npm run clean:dist-electron && electron-builder'), 'dist:dir should clean stale Electron artifacts before packaging');
assert(packageJson.scripts['dist:dir'].includes('electron-builder --win --dir'), 'dist:dir should produce an unpacked Windows build');
assert(!packageJson.scripts['dist:dir'].includes('npm run clean:after-package'), 'dist:dir should keep unpacked output for inspection');
assert(!packageJson.scripts['build:mac'], 'build:mac should not exist (Windows-only installer)');
assert(!packageJson.scripts['build:linux'], 'build:linux should not exist (Windows-only installer)');
assert(!packageJson.scripts['build:all'], 'build:all should not exist (Windows-only installer)');
assert(backendBuild.includes("process.platform !== 'win32'"), 'backend build should refuse non-Windows hosts');
assert(!builderConfig.includes('\nmac:'), 'electron-builder should not define mac targets (Windows-only installer)');
assert(!builderConfig.includes('\nlinux:'), 'electron-builder should not define linux targets (Windows-only installer)');

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
