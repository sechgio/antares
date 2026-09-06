const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CI_PATH = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const RELEASE_PATH = path.join(ROOT, '.github', 'workflows', 'release.yml');
const SETUP_CI_PATH = path.join(ROOT, '.github', 'actions', 'setup-ci', 'action.yml');
const RUNNER_PATH = path.join(ROOT, 'scripts', 'run-test-suites.js');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const UV_LOCK_PATH = path.join(ROOT, 'uv.lock');
const NODE_VERSION_PATH = path.join(ROOT, '.node-version');
const VITE_CONFIG_PATH = path.join(ROOT, 'frontend', 'vite.config.ts');
const STATIC_VITEST_CONFIG_PATH = path.join(ROOT, 'frontend', 'vitest.static.config.ts');

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

function assertActionsPinned(source, label) {
  const actionRefs = [...source.matchAll(/uses:\s+actions\/[^@\s]+@([^\s#]+)/g)].map((match) => match[1]);
  assert(actionRefs.length > 0, `${label} uses GitHub-maintained actions`);
  assert(
    actionRefs.every((ref) => /^[0-9a-f]{40}$/.test(ref)),
    `${label} pins every GitHub action to a full commit SHA`,
  );
}

function assertSingleWorker(config, label) {
  assert(
    config.includes('fileParallelism: false') && config.includes('maxWorkers: 1'),
    `${label} runs Vitest with deterministic single-worker scheduling`,
  );
}

function run() {
  console.log('Testing CI/CD workflow safety and reproducibility...\n');

  const ci = fs.readFileSync(CI_PATH, 'utf8');
  const release = fs.readFileSync(RELEASE_PATH, 'utf8');
  const setupCi = fs.readFileSync(SETUP_CI_PATH, 'utf8');
  const runner = fs.readFileSync(RUNNER_PATH, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  const nodeVersion = fs.readFileSync(NODE_VERSION_PATH, 'utf8').trim();
  const viteConfig = fs.readFileSync(VITE_CONFIG_PATH, 'utf8');
  const staticVitestConfig = fs.readFileSync(STATIC_VITEST_CONFIG_PATH, 'utf8');

  assert(/permissions:\r?\n\s+contents:\s+read/.test(ci), 'CI has explicit read-only permissions');
  assert(ci.includes('cancel-in-progress: true'), 'CI cancels obsolete runs for the same ref');
  assert(ci.includes('timeout-minutes:'), 'CI has a bounded job timeout');
  assert(ci.includes('uses: ./.github/actions/setup-ci'), 'CI reuses the shared setup-ci composite action');
  assert(!/\bnpm install\b/.test(ci), 'CI never performs mutable npm install');
  assert(ci.includes('persist-credentials: false'), 'CI checkout does not persist Git credentials');
  assertActionsPinned(ci, 'CI');

  assert(nodeVersion === '22.12.0', '.node-version pins Node 22.12.0');
  assert(setupCi.includes("node-version-file: '.node-version'"), 'setup-ci reads the committed Node version file');
  assert(setupCi.includes('cache: pip'), 'setup-ci caches Python dependencies');
  assert(setupCi.includes('frontend/package-lock.json'), 'setup-ci cache key includes the frontend lockfile');
  assert(setupCi.includes('npm ci'), 'setup-ci installs root dependencies with npm ci');
  assert(setupCi.includes('npm ci --prefix frontend'), 'setup-ci installs frontend dependencies with npm ci');
  assert(fs.existsSync(UV_LOCK_PATH), 'Python toolchain has a committed uv lockfile');
  assert(setupCi.includes('uv sync --locked --extra dev'), 'setup-ci installs Python dependencies from uv.lock');
  assert(setupCi.includes('python -m pip install uv==0.11.19'), 'setup-ci bootstraps the pinned uv version');
  assertActionsPinned(setupCi, 'setup-ci');

  assert(packageJson.scripts.ci.includes('npm run audit:node'), 'shared CI gate includes Node dependency audits');
  assert(packageJson.scripts.ci.includes('npm run check:ratchet'), 'shared CI gate includes the quality ratchet');
  assert(
    packageJson.scripts['typecheck:backend'].includes('uv run --project . --locked --extra dev mypy backend'),
    'backend typecheck uses the locked Python environment',
  );
  assert(
    packageJson.scripts['lint:fix'].includes('uv run --project . --locked --extra dev ruff check'),
    'Python lint fixes use the locked environment',
  );
  assert(packageJson.scripts.test === 'node scripts/run-test-suites.js', 'full suite delegates to run-test-suites.js');
  assert(
    runner.includes("run('uv', ['run', '--project', ROOT, '--locked', '--extra', 'dev', 'pytest', '../tests', '-v']"),
    'test runner runs pytest through the locked Python environment',
  );
  assert(runner.includes("'test-quality-ratchet.js'"), 'test runner treats quality-ratchet as a contract test');
  assert(runner.includes("'test-review-policy.js'"), 'test runner treats review-policy as a contract test');
  assert(
    packageJson.scripts['test:stress'].includes('uv run --project .. --locked --extra dev pytest'),
    'stress tests use the locked Python environment',
  );
  assertSingleWorker(viteConfig, 'Frontend Vitest');
  assertSingleWorker(staticVitestConfig, 'Static Vitest');
  assert(
    packageJson.scripts['audit:node'].includes('npm audit --omit=dev --audit-level=high') &&
      packageJson.scripts['audit:node'].includes('npm audit --prefix frontend --omit=dev --audit-level=high'),
    'shared Node audit covers Electron and frontend runtime dependencies',
  );

  assert(release.includes('uses: ./.github/actions/setup-ci'), 'Release verify reuses the shared setup-ci action');
  assert(release.includes("node-version-file: '.node-version'"), 'Release build reads the committed Node version file');
  assert(!release.includes('continue-on-error: true'), 'Release dependency audits fail closed');
  assert(release.includes('run: npm run ci'), 'Release reuses the same fail-closed CI quality gate');
  assert(release.includes('Validate required build configuration'), 'Release rejects missing production build configuration');
  assert(release.includes('Antares-Setup-*.exe'), 'Release allowlists the NSIS installer');
  assert(release.includes('Antares-Portable-*.exe'), 'Release allowlists the portable executable');
  assert(release.includes('latest.yml'), 'Release includes updater metadata');
  assert(release.includes('SHA256SUMS.txt'), 'Release includes generated checksums');
  const uploadBlock = release.slice(release.indexOf('uses: actions/upload-artifact'), release.indexOf('uses: actions/download-artifact'));
  assert(!uploadBlock.includes('path: dist-electron'), 'Release does not upload the unpacked build directory');
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
