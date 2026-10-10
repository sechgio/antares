const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { assert, assertActionsPinned, finish } = require('./helpers/harness');

const ROOT = path.join(__dirname, '..');
const CI_PATH = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const RELEASE_PATH = path.join(ROOT, '.github', 'workflows', 'release.yml');
const SETUP_CI_PATH = path.join(ROOT, '.github', 'actions', 'setup-ci', 'action.yml');
const RUNNER_PATH = path.join(ROOT, 'scripts', 'run-test-suites.js');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const FRONTEND_PACKAGE_PATH = path.join(ROOT, 'frontend', 'package.json');
const UV_LOCK_PATH = path.join(ROOT, 'uv.lock');
const NODE_VERSION_PATH = path.join(ROOT, '.node-version');
const VITE_CONFIG_PATH = path.join(ROOT, 'frontend', 'vite.config.ts');
const STATIC_VITEST_CONFIG_PATH = path.join(ROOT, 'frontend', 'vitest.static.config.ts');
const PANGO_SETUP_PATH = path.join(ROOT, 'scripts', 'install-ci-pango.ps1');

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
  const frontendPackageJson = JSON.parse(fs.readFileSync(FRONTEND_PACKAGE_PATH, 'utf8'));
  const nodeVersion = fs.readFileSync(NODE_VERSION_PATH, 'utf8').trim();
  const viteConfig = fs.readFileSync(VITE_CONFIG_PATH, 'utf8');
  const staticVitestConfig = fs.readFileSync(STATIC_VITEST_CONFIG_PATH, 'utf8');
  const pangoSetup = fs.readFileSync(PANGO_SETUP_PATH, 'utf8');

  assert(/permissions:\r?\n\s+contents:\s+read/.test(ci), 'CI has explicit read-only permissions');
  assert(ci.includes('cancel-in-progress: true'), 'CI cancels obsolete runs for the same ref');
  assert(ci.includes('timeout-minutes:'), 'CI has a bounded job timeout');
  assert(ci.includes('uses: ./.github/actions/setup-ci'), 'CI reuses the shared setup-ci composite action');
  assert(!/\bnpm install\b/.test(ci), 'CI never performs mutable npm install');
  assert(ci.includes('persist-credentials: false'), 'CI checkout does not persist Git credentials');
  assertActionsPinned(ci, 'CI');
  const ciJobs = ci.split(/^jobs:\s*$/m)[1] || '';
  const job = (name) => ciJobs.match(new RegExp(`^  ${name}:\\s*\\r?\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1] || '';
  assert((ciJobs.match(/^  [\w-]+:\s*$/gm) || []).length === 5, 'CI has four independent workers and one required aggregate');
  assert(!/^\s+(?:strategy|matrix):/m.test(ci), 'CI does not accidentally multiply suites through a matrix');
  assert(!ci.includes('ubuntu-latest'), 'PR CI runs only on Windows');
  for (const name of ['frontend', 'frontend-shard-2', 'backend', 'quality', 'verify']) {
    assert(job(name).includes('runs-on: windows-latest'), `${name} runs on Windows`);
  }
  const qualityStep = job('quality').match(/- name: Run quality checks\r?\n\s+shell: bash\r?\n\s+run: >-\r?\n([\s\S]*?)(?=\r?\n\s+- name:)/)?.[1].replace(/\s+/g, ' ').trim() || '';
  const qualityCommands = packageJson.scripts.ci.split(' && ')
    .filter((command) => !['npm test', 'npm run typecheck:frontend', 'npm run check:budgets'].includes(command));
  assert(
    frontendPackageJson.scripts.build.startsWith('tsc && ') &&
      frontendPackageJson.scripts.build.includes('node scripts/canvas-appear-budget.mjs') &&
      frontendPackageJson.scripts.build.includes('node scripts/shell-preload-budget.mjs'),
    'The frontend build checks types and both budgets, replacing duplicate CI commands',
  );
  assert(
    job('frontend').includes('node scripts/run-test-suites.js frontend') && !job('frontend').includes('needs:'),
    'The frontend suite runs independently of backend setup and quality checks',
  );
  assert(
    job('frontend').includes('node scripts/run-test-suites.js frontend 1/2') &&
      job('frontend-shard-2').includes('node scripts/run-test-suites.js frontend 2/2') &&
      !job('frontend-shard-2').includes('needs:'),
    'The frontend suite is split into two independent shards instead of one long job',
  );
  assert(
    qualityStep === [...qualityCommands, ...['contracts', 'electron'].map((suite) => `node scripts/run-test-suites.js ${suite}`)].join(' && '),
    'Quality CI preserves every check from the shared quality gate in order and fails closed',
  );
  assert(
    job('quality').includes('run: npm run build:frontend'),
    'Quality CI also verifies frontend types and both build budgets',
  );
  assert(pangoSetup.includes('pacman -S mingw-w64-x86_64-pango'), 'Windows tests install Pango');
  assert(pangoSetup.includes('if ($LASTEXITCODE -ne 0)') && pangoSetup.includes('exit $LASTEXITCODE'), 'Pango installation failures stop the backend branch');
  assert(!job('quality').includes('install-ci-pango') && !job('frontend').includes('install-ci-pango'), 'Only the backend runner installs Pango');
  assert(pangoSetup.includes('WEASYPRINT_DLL_DIRECTORIES=') && pangoSetup.includes('$env:WEASYPRINT_DLL_DIRECTORIES ='), 'Windows tests configure WeasyPrint DLLs for validation and later steps');
  assert(pangoSetup.includes("pdf.startswith(b'%PDF-')"), 'Fresh and cached runtimes must render a real PDF');
  assert(job('backend').indexOf('Install and validate Pango') < job('backend').indexOf('Run backend tests'), 'Pango validation precedes backend tests');
  assert(ci.includes('C:\\msys64\\mingw64') && ci.includes('C:\\msys64\\var\\lib\\pacman\\local'), 'Pango cache preserves runtime files together with the installed package database');
  assert(ci.includes('$env:ImageOS-$env:ImageVersion') && ci.includes('steps.runner-image.outputs.version') && ci.includes("hashFiles('scripts/install-ci-pango.ps1')") && !job('backend').includes('restore-keys:'), 'Pango cache cannot cross runner images or installer versions');
  for (const suite of ['contracts', 'backend', 'electron']) {
    const calls = ciJobs.match(new RegExp(`node scripts/run-test-suites\\.js ${suite}\\b`, 'g')) || [];
    assert(calls.length === 1, `Windows CI runs the ${suite} suite exactly once`);
  }
  assert(
    (ciJobs.match(/node scripts\/run-test-suites\.js frontend\b/g) || []).length === 2,
    'Windows CI runs the frontend suite exactly once per shard',
  );
  assert(
    runner.includes("run(npmCommand, ['run', 'test', '--', `--shard=${shard}`], frontend)"),
    'The test runner forwards the shard to Vitest',
  );
  assert(
    runner.includes("shard.split('/')[0] === '1'") && runner.includes("run(npmCommand, ['run', 'test:static'], frontend)"),
    'The single-worker static suite runs exactly once, in the first shard',
  );
  assert(runner.includes("run(npmCommand, ['run', 'test:all'], frontend)"), 'The unsharded frontend suite still runs every frontend test');
  assert(!/run: node scripts\/run-test-suites\.js\s*$/m.test(ci), 'CI does not repeat the full suite alongside parallel suites');
  assert(
    job('verify').includes('name: Lint, audit, and test (Windows)') && job('verify').includes('if: always()') &&
      job('verify').includes('needs: [frontend, frontend-shard-2, backend, quality]'),
    'The existing required check always evaluates all four independent jobs',
  );
  assert(
    ['frontend', 'frontend-shard-2', 'backend', 'quality'].every((name) => job('verify').includes(`needs.${name}.result`)) &&
      job('verify').includes("if ($result -ne 'success') { throw"),
    'The required check rejects failed, cancelled and skipped workers',
  );
  assert(job('backend').includes('pytest tests/test_stress_conversion.py -m slow'), 'Windows CI runs slow stress tests');
  if (process.platform === 'win32') {
    const gate = job('verify').split('        run: |')[1].trim();
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', `
      function Invoke-Gate { ${gate} }
      $names = @('FRONTEND_RESULT', 'FRONTEND_SHARD_2_RESULT', 'BACKEND_RESULT', 'QUALITY_RESULT')
      foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, 'success') }
      Invoke-Gate
      foreach ($name in $names) {
        foreach ($state in @('failure', 'cancelled', 'skipped', '')) {
          [Environment]::SetEnvironmentVariable($name, $state)
          $rejected = $false
          try { Invoke-Gate } catch { $rejected = $true }
          if (-not $rejected) { throw "Gate accepted $name=$state" }
        }
        [Environment]::SetEnvironmentVariable($name, 'success')
      }
    `], { encoding: 'utf8', windowsHide: true });
    assert(result.status === 0, `The actual PowerShell gate accepts success and rejects every failure state: ${result.stderr}`);
  }
  for (const input of ['python', 'root', 'frontend']) {
    assert(new RegExp(`  ${input}:[\\s\\S]*?default: 'true'`).test(setupCi), `Release setup keeps ${input} enabled by default`);
  }
  assert(job('frontend').includes("python: 'false'") && job('frontend').includes("root: 'false'"), 'Frontend setup skips Python and root npm dependencies');
  assert(job('backend').includes("frontend: 'false'") && job('backend').includes("root: 'false'"), 'Backend setup skips both npm installs');
  assert(packageJson.scripts['audit:python'].endsWith('python scripts/audit_python.py'), 'The shared audit uses the tested lock exporter');

  assert(nodeVersion === '22.19.0', '.node-version pins Node 22.19.0');
  assert(setupCi.includes("node-version-file: '.node-version'"), 'setup-ci reads the committed Node version file');
  assert(
    setupCi.includes('uv cache dir') && setupCi.includes('path: ${{ steps.uv-cache.outputs.dir }}') &&
      setupCi.includes("hashFiles('uv.lock', '.github/actions/setup-ci/action.yml')"),
    'setup-ci caches the Python dependencies installed by uv, keyed by the lock and toolchain',
  );
  assert(setupCi.includes('frontend/package-lock.json'), 'setup-ci cache key includes the frontend lockfile');
  assert(setupCi.includes('npm ci'), 'setup-ci installs root dependencies with npm ci');
  assert(setupCi.includes('npm ci --prefix frontend'), 'setup-ci installs frontend dependencies with npm ci');
  assert(fs.existsSync(UV_LOCK_PATH), 'Python toolchain has a committed uv lockfile');
  assert(setupCi.includes('uv sync --locked --extra dev'), 'setup-ci installs Python dependencies from uv.lock');
  assert(setupCi.includes('python -m pip install uv==0.11.19'), 'setup-ci bootstraps the pinned uv version');
  assertActionsPinned(setupCi, 'setup-ci');

  assert(packageJson.scripts.ci.includes('npm run audit:node'), 'shared CI gate includes Node dependency audits');
  assert(packageJson.scripts.ci.includes('npm run check:ratchet'), 'shared CI gate includes the quality ratchet');
  assert(packageJson.scripts.ci.includes('npm test'), 'shared CI gate runs the full test suite');
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
  assert(
    viteConfig.includes("pool: 'threads'") && viteConfig.includes('fileParallelism: true') &&
      viteConfig.includes('maxWorkers: 4'),
    'Frontend Vitest runs test files in parallel on a bounded worker pool',
  );
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

  finish();
}

run();
