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
const PYPROJECT_PATH = path.join(ROOT, 'pyproject.toml');
const NODE_VERSION_PATH = path.join(ROOT, '.node-version');
const VITE_CONFIG_PATH = path.join(ROOT, 'frontend', 'vite.config.ts');
const STATIC_VITEST_CONFIG_PATH = path.join(ROOT, 'frontend', 'vitest.static.config.ts');
const PANGO_SETUP_PATH = path.join(ROOT, 'scripts', 'install-ci-pango.ps1');
const EDITOR_MEDIA_SETUP_PATH = path.join(ROOT, 'scripts', 'install-ci-editor-media.ps1');

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
  const editorMediaSetup = fs.readFileSync(EDITOR_MEDIA_SETUP_PATH, 'utf8');
  const pyproject = fs.readFileSync(PYPROJECT_PATH, 'utf8');
  const minimumPython = pyproject.match(/^requires-python\s*=\s*">=(\d+\.\d+)"/m)?.[1];

  assert(Boolean(minimumPython), 'The backend declares its minimum Python version');
  assert(setupCi.includes(`python-version: '${minimumPython}'`), 'CI installs the minimum supported Python version');
  assert(release.includes(`python-version: '${minimumPython}'`), 'Release packaging installs the minimum supported Python version');

  assert(/permissions:\r?\n\s+contents:\s+read/.test(ci), 'CI has explicit read-only permissions');
  assert(ci.includes('merge_group:'), 'CI runs the full suite in merge_group');
  assert(ci.includes("cancel-in-progress: ${{ github.ref != 'refs/heads/main' && github.event_name != 'merge_group' }}"), 'CI cancels obsolete PR runs without cancelling main or merge_group');
  assert(ci.includes('timeout-minutes:'), 'CI has a bounded job timeout');
  assert(ci.includes('uses: ./.github/actions/setup-ci'), 'CI reuses the shared setup-ci composite action');
  assert(!/\bnpm\b/.test(ci), 'CI uses bun instead of npm');
  assert(ci.includes('persist-credentials: false'), 'CI checkout does not persist Git credentials');
  assert(ci.includes('filter: blob:none'), 'CI checkout uses blobless clones');
  assertActionsPinned(ci, 'CI');
  const ciJobs = ci.split(/^jobs:\s*$/m)[1] || '';
  const job = (name) => ciJobs.match(new RegExp(`^  ${name}:\\s*\\r?\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1] || '';
  assert((ciJobs.match(/^  [\w-]+:\s*$/gm) || []).length === 5, 'CI has four independent workers and one required aggregate');
  assert(!/^\s+(?:strategy|matrix):/m.test(ci), 'CI does not accidentally multiply suites through a matrix');
  assert(!ci.includes('ubuntu-latest'), 'PR CI runs only on Windows');
  for (const name of ['frontend', 'frontend-shard-2', 'backend', 'quality', 'verify']) {
    assert(job(name).includes('windows-latest') && job(name).includes('blacksmith-'), `${name} routes Windows jobs to Blacksmith when enabled with windows-latest fallback`);
  }
  const qualityStep = job('quality').match(/- name: Run quality checks\r?\n\s+shell: bash\r?\n\s+run: >-\r?\n([\s\S]*?)(?=\r?\n\s+- name:)/)?.[1].replace(/\s+/g, ' ').trim() || '';
  const qualityCommands = packageJson.scripts.ci.split(' && ')
    .filter((command) => !['bun test', 'bun run typecheck:frontend', 'bun run check:budgets'].includes(command));
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
    qualityStep === [...qualityCommands, ...['contracts', 'electron', 'turns'].map((suite) => `node scripts/run-test-suites.js ${suite}`)].join(' && '),
    'Quality CI preserves every check from the shared quality gate in order and fails closed',
  );
  assert(
    job('quality').includes('run: bun run build:frontend'),
    'Quality CI also verifies frontend types and both build budgets',
  );
  assert(pangoSetup.includes('pacman -S mingw-w64-x86_64-pango'), 'Windows tests install Pango');
  assert(pangoSetup.includes('if ($LASTEXITCODE -ne 0)') && pangoSetup.includes('exit $LASTEXITCODE'), 'Pango installation failures stop the backend branch');
  assert(!job('quality').includes('install-ci-pango') && !job('frontend').includes('install-ci-pango'), 'Only the backend runner installs Pango');
  assert(pangoSetup.includes('WEASYPRINT_DLL_DIRECTORIES=') && pangoSetup.includes('$env:WEASYPRINT_DLL_DIRECTORIES ='), 'Windows tests configure WeasyPrint DLLs for validation and later steps');
  assert(pangoSetup.includes("pdf.startswith(b'%PDF-')"), 'Fresh and cached runtimes must render a real PDF');
  assert(job('backend').indexOf('Install and validate Pango') < job('backend').indexOf('Run backend tests'), 'Pango validation precedes backend tests');
  assert(ci.includes('~/AppData/Local/antares-pango-dlls') && pangoSetup.includes('antares-pango-dlls'), 'Pango cache stores only the WeasyPrint DLL directory');
  assert(ci.includes('steps.runner-image.outputs.version') && ci.includes("hashFiles('scripts/install-ci-pango.ps1')") && !job('backend').includes('restore-keys:'), 'Pango cache cannot cross runner images or installer versions');
  assert(
    editorMediaSetup.includes('node scripts/prepare-editor-media.js install') &&
      editorMediaSetup.includes('node scripts/prepare-editor-media.js verify'),
    'Editor media provisioning verifies the binaries against media/manifest.json on install and on every cache hit',
  );
  assert(
    editorMediaSetup.includes('releases/download/autobuild-2026-08-31-13-27/') &&
      editorMediaSetup.includes('ec9db2cda1f5894ab95446076ad8bf49379db4b53c02e778ad3b49adf91fec83'),
    'Editor media provisioning pins a dated BtbN autobuild and validates the downloaded archive SHA-256',
  );
  assert(
    editorMediaSetup.includes('ANTARES_FFMPEG_DIR=') && editorMediaSetup.includes('$env:GITHUB_ENV'),
    'Editor media provisioning exports ANTARES_FFMPEG_DIR to the backend tests',
  );
  assert(editorMediaSetup.includes('if ($LASTEXITCODE -ne 0)') && editorMediaSetup.includes('exit $LASTEXITCODE'), 'Editor media provisioning failures stop the backend branch');
  assert(
    job('backend').includes('Install and validate editor media') &&
      job('backend').indexOf('Install and validate editor media') < job('backend').indexOf('Run backend tests'),
    'Editor media provisioning precedes backend tests',
  );
  assert(
    job('backend').includes('editor-media-') && job('backend').includes("hashFiles('media/manifest.json')"),
    'Editor media cache is keyed by the media manifest, runner OS, architecture and image version',
  );
  assert(!job('quality').includes('install-ci-editor-media') && !job('frontend').includes('install-ci-editor-media'), 'Only the backend runner provisions editor media');
  for (const suite of ['contracts', 'backend', 'electron', 'turns']) {
    const calls = ciJobs.match(new RegExp(`node scripts/run-test-suites\\.js ${suite}\\b`, 'g')) || [];
    assert(calls.length === 1, `Windows CI runs the ${suite} suite exactly once`);
  }
  assert(
    (ciJobs.match(/node scripts\/run-test-suites\.js frontend\b/g) || []).length === 2,
    'Windows CI runs the frontend suite exactly once per shard',
  );
  assert(
    runner.includes("run(bunCommand, ['run', 'test', '--', `--shard=${shard}`], frontend)"),
    'The test runner forwards the shard to Vitest via bun',
  );
  assert(
    runner.includes("shard.split('/')[0] === '1'") && runner.includes("run(bunCommand, ['run', 'test:static'], frontend)"),
    'The single-worker static suite runs exactly once, in the first shard',
  );
  assert(runner.includes("run(bunCommand, ['run', 'test:all'], frontend)"), 'The unsharded frontend suite still runs every frontend test');
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
  assert(job('backend').includes('pytest tests/test_stress_conversion.py tests/test_scalability_baseline.py -m slow'), 'Windows CI runs slow stress tests and scalability baselines');
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
  assert(
    ['frontend', 'frontend-shard-2'].every((name) => job(name).includes("python: 'false'") && job(name).includes("root: 'false'")),
    'Frontend shards skip Python and root Electron installs after moving agent-profiles to root Vitest',
  );
  assert(job('backend').includes("frontend: 'false'") && job('backend').includes("root: 'false'"), 'Backend setup skips both Node installs');
  assert(packageJson.scripts['audit:python'].endsWith('python scripts/audit_python.py'), 'The shared audit uses the tested lock exporter');

  assert(nodeVersion === '22.19.0', '.node-version pins Node 22.19.0');
  assert(setupCi.includes("node-version-file: '.node-version'"), 'setup-ci reads the committed Node version file');
  assert(
    setupCi.includes('path: .venv') && setupCi.includes("hashFiles('uv.lock', 'pyproject.toml')"),
    'setup-ci caches .venv directly keyed by uv.lock and pyproject.toml',
  );
  assert(setupCi.includes("hashFiles('frontend/bun.lock')") && setupCi.includes('path: frontend/node_modules'), 'setup-ci caches frontend/node_modules keyed by frontend/bun.lock');
  assert(setupCi.includes('bun install --frozen-lockfile'), 'setup-ci installs root dependencies with bun install --frozen-lockfile');
  assert(setupCi.includes('bun install --frozen-lockfile --cwd frontend'), 'setup-ci installs frontend dependencies with bun install --frozen-lockfile');
  assert(setupCi.includes("hashFiles('bun.lock')") && setupCi.includes('path: node_modules'), 'setup-ci caches root node_modules keyed by bun.lock');
  assert(fs.existsSync(UV_LOCK_PATH), 'Python toolchain has a committed uv lockfile');
  assert(setupCi.includes('uv sync --locked --extra dev'), 'setup-ci installs Python dependencies from uv.lock');
  assert(setupCi.includes('UV_VERSION: 0.11.19') && setupCi.includes('sha256sum -c'), 'setup-ci installs the pinned uv release verified by SHA-256');
  assert(setupCi.includes('BUN_VERSION: 1.4.4') && setupCi.includes('bun-windows-x64.zip'), 'setup-ci installs the pinned Bun release verified by SHA-256');
  assertActionsPinned(setupCi, 'setup-ci');

  assert(packageJson.scripts.ci.includes('bun run audit:node'), 'shared CI gate includes Node dependency audits');
  assert(packageJson.scripts.ci.includes('bun run check:ratchet'), 'shared CI gate includes the quality ratchet');
  assert(packageJson.scripts.ci.includes('bun test'), 'shared CI gate runs the full test suite');
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
  assert(
    pyproject.includes('"pytest-xdist>=3.6.0"') && /^addopts\s*=\s*"[^"]*-n 4"/m.test(pyproject),
    'Backend pytest distributes the suite across four workers instead of running serially',
  );
  assert(
    runner.includes('async function runNodeTestsParallel') &&
      runner.includes('const PARALLEL_NODE_CONCURRENCY = readParallelConcurrency()') &&
      runner.includes('ANTARES_NODE_TEST_CONCURRENCY') &&
      runner.includes('await runNodeTestsParallel(ELECTRON_TESTS)'),
    'The electron suite runs as a bounded, overridable pool of parallel Node workers',
  );
  assert(runner.includes('runNodeTests(CONTRACT_TESTS)'), 'The contract suite stays serial');
  assert(
    runner.includes('node tests failed:'),
    'The Node test pool fails closed naming every failed test file',
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
    packageJson.scripts['audit:node'].includes('bun audit --omit=dev --audit-level=high') &&
      packageJson.scripts['audit:node'].includes('bun audit --cwd frontend --omit=dev --audit-level=high'),
    'shared Node audit covers Electron and frontend runtime dependencies via bun audit',
  );

  assert(release.includes('uses: ./.github/actions/setup-ci'), 'Release verify reuses the shared setup-ci action');
  assert(release.includes("node-version-file: '.node-version'") || release.includes('uses: ./.github/actions/setup-ci'), 'Release build uses setup-ci with the committed Node version file');
  assert(!release.includes('continue-on-error: true'), 'Release dependency audits fail closed');
  assert(release.includes('run: bun run ci'), 'Release reuses the same fail-closed CI quality gate');
  assert(release.includes('Validate required build configuration'), 'Release rejects missing production build configuration');
  assert(release.includes('Antares-Setup-*.exe'), 'Release allowlists the NSIS installer');
  assert(release.includes('Antares-Portable-*.exe'), 'Release allowlists the portable executable');
  assert(release.includes('latest.yml'), 'Release includes updater metadata');
  assert(release.includes('SHA256SUMS.txt'), 'Release includes generated checksums');
  assert(release.includes('SOURCE_DATE_EPOCH'), 'Release pins SOURCE_DATE_EPOCH from the last commit');
  assert(release.includes('WINDOWS_CODESIGN_PFX'), 'Release wires Authenticode signing from WINDOWS_CODESIGN_PFX');
  assert(release.includes('CSC_LINK'), 'Release feeds electron-builder through CSC_LINK');
  assert(release.includes('Sign release checksums (GPG, optional)'), 'Release includes the optional GPG checksum signature step');
  assert(release.includes('SHA256SUMS.txt.asc'), 'Release uploads the GPG signature of the checksums');
  assert(release.includes('expected_count=5') && release.includes('expected_count=6'), 'Release accepts the asset count with and without GPG signature');
  assert(!release.includes('forceCodeSigning: true'), 'Release never hard-fails builds when signing secrets are absent');
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
