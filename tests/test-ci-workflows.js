const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CI_PATH = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const RELEASE_PATH = path.join(ROOT, '.github', 'workflows', 'release.yml');
const PACKAGE_PATH = path.join(ROOT, 'package.json');

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

function assertActionsPinned(workflow, label) {
  const actionRefs = [...workflow.matchAll(/uses:\s+actions\/[^@\s]+@([^\s#]+)/g)].map((match) => match[1]);
  assert(actionRefs.length > 0, `${label} uses GitHub-maintained actions`);
  assert(
    actionRefs.every((ref) => /^[0-9a-f]{40}$/.test(ref)),
    `${label} pins every GitHub action to a full commit SHA`,
  );
}

function run() {
  console.log('Testing CI/CD workflow safety and reproducibility...\n');

  const ci = fs.readFileSync(CI_PATH, 'utf8');
  const release = fs.readFileSync(RELEASE_PATH, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));

  assert(/permissions:\r?\n\s+contents:\s+read/.test(ci), 'CI has explicit read-only permissions');
  assert(ci.includes('cancel-in-progress: true'), 'CI cancels obsolete runs for the same ref');
  assert(ci.includes('timeout-minutes:'), 'CI has a bounded job timeout');
  assert(ci.includes("node-version: '22'"), 'CI uses the supported Node 22 toolchain');
  assert(ci.includes('cache: pip'), 'CI caches Python dependencies');
  assert(ci.includes('frontend/package-lock.json'), 'CI cache key includes the frontend lockfile');
  assert(ci.includes('npm ci'), 'CI installs root dependencies with npm ci');
  assert(ci.includes('npm ci --prefix frontend'), 'CI installs frontend dependencies with npm ci');
  assert(!/\bnpm install\b/.test(ci), 'CI never performs mutable npm install');
  assert(ci.includes('persist-credentials: false'), 'CI checkout does not persist Git credentials');
  assertActionsPinned(ci, 'CI');
  assert(packageJson.scripts.ci.includes('npm run audit:node'), 'shared CI gate includes Node dependency audits');
  assert(
    packageJson.scripts['audit:node'].includes('npm audit --omit=dev --audit-level=high') &&
      packageJson.scripts['audit:node'].includes('npm audit --prefix frontend --omit=dev --audit-level=high'),
    'shared Node audit covers Electron and frontend runtime dependencies',
  );

  assert(release.match(/node-version:\s*'22'/g)?.length === 2, 'Release uses Node 22 in verify and build');
  assert(!release.includes('continue-on-error: true'), 'Release dependency audits fail closed');
  assert(release.includes('run: npm run ci'), 'Release reuses the same fail-closed CI quality gate');
  assert(release.includes('Validate required build configuration'), 'Release rejects missing production build configuration');
  assert(release.includes('Antares-Setup-*.exe'), 'Release allowlists the NSIS installer');
  assert(release.includes('Antares-Portable-*.exe'), 'Release allowlists the portable executable');
  assert(release.includes('latest.yml'), 'Release includes updater metadata');
  assert(release.includes('SHA256SUMS.txt'), 'Release includes generated checksums');
  assert(!release.includes('path: dist-electron\n'), 'Release does not upload the unpacked build directory');
  assert(!release.includes('dist-electron/* \\\n'), 'Release does not pass directories to gh release upload');
  assert(!release.includes('--clobber'), 'Release never deletes published assets during retry');
  assert(release.includes('--draft'), 'Release is created as a draft before asset verification');
  assert(release.includes('--draft=false'), 'Release is promoted only after assets upload successfully');
  assert(release.includes('environment: production'), 'Release publication uses the production environment');
  assertActionsPinned(release, 'Release');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run();
