const fs = require('fs');
const path = require('path');

const { assert, finish } = require('./helpers/harness');

function readPyprojectVersion() {
  const content = fs.readFileSync(path.join(__dirname, '..', 'pyproject.toml'), 'utf8');
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error('Could not parse version from pyproject.toml');
  return match[1];
}

function readBackendVersion() {
  const content = fs.readFileSync(path.join(__dirname, '..', 'backend', 'version.py'), 'utf8');
  const match = content.match(/__version__\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('Could not parse __version__ from backend/version.py');
  return match[1];
}

function run() {
  console.log('Testing version manifest sync...\n');

  const rootPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const frontendPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'package.json'), 'utf8'));
  const rootLock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  const frontendLock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'package-lock.json'), 'utf8'));
  const versions = {
    'package.json': rootPkg.version,
    'package-lock.json': rootLock.version,
    'package-lock.json packages[""]': rootLock.packages[''].version,
    'frontend/package.json': frontendPkg.version,
    'frontend/package-lock.json': frontendLock.version,
    'frontend/package-lock.json packages[""]': frontendLock.packages[''].version,
    'pyproject.toml': readPyprojectVersion(),
    'backend/version.py': readBackendVersion(),
  };

  const unique = new Set(Object.values(versions));
  assert(unique.size === 1, `all manifests report the same version (${[...unique].join(', ')})`);

  for (const [file, version] of Object.entries(versions)) {
    assert(/^\d+\.\d+\.\d+$/.test(version), `${file} version looks like semver (${version})`);
  }

  finish();
}

run();
