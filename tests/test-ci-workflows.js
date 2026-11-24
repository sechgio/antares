const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { assert, assertActionsPinned, finish } = require('./helpers/harness');
const affected = require('../scripts/ci-affected.js');

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
const PREPUSH_HOOK_PATH = path.join(ROOT, '.githooks', 'pre-push');
const PREPUSH_CHECK_PATH = path.join(ROOT, 'scripts', 'pre-push-check.js');

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
  const prePushHook = fs.readFileSync(PREPUSH_HOOK_PATH, 'utf8');
  const prePushCheck = fs.readFileSync(PREPUSH_CHECK_PATH, 'utf8');
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
  assert(
    release.includes(`python-version: '${minimumPython}'`),
    'Release packaging installs the minimum supported Python version',
  );

  assert(/permissions:\r?\n\s+contents:\s+read/.test(ci), 'CI has explicit read-only permissions');
  assert(ci.includes('merge_group:'), 'CI runs the full suite in merge_group');
  assert(
    ci.includes("cancel-in-progress: ${{ github.ref != 'refs/heads/main' && github.event_name != 'merge_group' }}"),
    'CI cancels obsolete PR runs without cancelling main or merge_group',
  );
  assert(ci.includes('timeout-minutes:'), 'CI has a bounded job timeout');
  assert(ci.includes('uses: ./.github/actions/setup-ci'), 'CI reuses the shared setup-ci composite action');
  assert(!/\bnpm\b/.test(ci), 'CI uses bun instead of npm');
  assert(ci.includes('persist-credentials: false'), 'CI checkout does not persist Git credentials');
  assert(ci.includes('filter: blob:none'), 'CI checkout uses blobless clones');
  assertActionsPinned(ci, 'CI');
  const ciJobs = ci.split(/^jobs:\s*$/m)[1] || '';
  const job = (name) =>
    ciJobs.match(new RegExp(`^  ${name}:\\s*\\r?\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1] || '';
  const workerJobs = [
    'lint',
    'typecheck',
    'build',
    'contracts',
    'electron',
    'frontend',
    'frontend-shard-2',
    'frontend-shard-3',
    'backend',
  ];
  assert(
    (ciJobs.match(/^  [\w-]+:\s*$/gm) || []).length === workerJobs.length + 2,
    'CI splits lint, typecheck, build, contracts, electron, frontend and backend into parallel jobs plus the changes selector and one required aggregate',
  );
  assert(!/^\s+(?:strategy|matrix):/m.test(ci), 'CI does not accidentally multiply suites through a matrix');
  assert(!ci.includes('ubuntu-latest'), 'PR CI runs only on Windows');
  for (const name of [...workerJobs, 'changes', 'verify']) {
    assert(
      job(name).includes('windows-latest') && job(name).includes('blacksmith-'),
      `${name} routes Windows jobs to Blacksmith when enabled with windows-latest fallback`,
    );
  }
  const selectedJobs = workerJobs.filter((name) => name !== 'lint');
  for (const name of selectedJobs) {
    assert(
      job(name).includes('needs: changes'),
      `${name} waits only for the changes selector before its affected gate`,
    );
  }
  assert(!job('lint').includes('needs:'), 'Lint stays unselected so changed-file format and audits always gate the PR');
  const gateByJob = {
    typecheck: 'typecheck',
    build: 'build',
    contracts: 'contracts',
    electron: 'electron',
    frontend: 'frontend',
    'frontend-shard-2': 'frontend',
    'frontend-shard-3': 'frontend',
    backend: 'backend',
  };
  for (const [name, gate] of Object.entries(gateByJob)) {
    assert(
      job(name).includes(`if: needs.changes.outputs.${gate} == 'true'`),
      `${name} only runs on PRs whose changed files affect the ${gate} area`,
    );
  }
  for (const output of Object.values(gateByJob)) {
    assert(
      job('changes').includes(`${output}: \${{ steps.affected.outputs.${output} }}`),
      `changes job publishes the ${output} selection`,
    );
  }
  assert(
    job('changes').includes('node scripts/ci-affected.js'),
    'The changes job delegates affected selection to the versioned classifier',
  );
  assert(
    affected.AREAS.every((area) => Object.values(gateByJob).includes(area)),
    'Every classifier area gates at least one CI job',
  );
  assert(
    Object.values(affected.classify(['AGENTS.md', 'docs/setup.md'])).every((on) => on === false),
    'Documentation-only changes select no heavy job beyond lint',
  );
  const frontendOnly = affected.classify(['frontend/src/App.tsx']);
  assert(
    frontendOnly.frontend === true &&
      frontendOnly.build === true &&
      frontendOnly.typecheck === true &&
      frontendOnly.contracts === true &&
      frontendOnly.electron === true &&
      frontendOnly.backend === false,
    'A frontend source change selects frontend, build, typecheck and the node tests that read frontend sources, not backend',
  );
  const backendOnly = affected.classify(['backend/services/foo.py', 'tests/test_foo.py']);
  assert(
    backendOnly.backend === true &&
      backendOnly.electron === true &&
      backendOnly.typecheck === true &&
      backendOnly.frontend === false &&
      backendOnly.contracts === true &&
      backendOnly.build === false,
    'A backend change selects backend plus the node tests that spawn or read it, not frontend or build',
  );
  const affectedSource = fs.readFileSync(path.join(ROOT, 'scripts', 'ci-affected.js'), 'utf8');
  assert(
    affectedSource.includes("'--no-renames'") && !affectedSource.includes('--diff-filter'),
    'The selector counts deleted and renamed-away paths so a deletion-only PR cannot skip coverage',
  );
  for (const path of [
    'shared/budgets.json',
    'electron/preload.js',
    'scripts/run-test-suites.js',
    '.github/workflows/ci.yml',
    '.gitattributes',
    'mystery/dir/file.xyz',
  ]) {
    assert(
      Object.values(affected.classify([path])).every((on) => on === true),
      `${path} selects every job: unknown or shared paths must never skip coverage`,
    );
  }
  for (const name of ['frontend', 'frontend-shard-2', 'frontend-shard-3']) {
    assert(
      job(name).includes('with-budget.js 60 -- node scripts/run-test-suites.js frontend'),
      `${name} fails the step when the test run exceeds the 60s shard budget`,
    );
  }
  assert(
    (ciJobs.match(/with-budget\.js/g) || []).length >= 10,
    'Every measured step enforces a hard wall-clock budget instead of relying on job timeouts',
  );
  assert(
    (ciJobs.match(/timeout-minutes: [23]/g) || []).length >= selectedJobs.length,
    'Checkout and setup steps carry hard timeouts so a hung install fails fast',
  );
  assert(
    prePushHook.includes('node scripts/pre-push-check.js') &&
      prePushHook.includes('refs/heads/"$protected_branch"') &&
      prePushHook.indexOf('protected_branch') < prePushHook.indexOf('pre-push-check.js'),
    'The pre-push hook keeps the main-push guard and then runs the fast changed-file check',
  );
  assert(
    prePushCheck.includes('BUDGET_SECONDS = 9') &&
      prePushCheck.includes('check-format.js') &&
      prePushCheck.includes('oxlint') &&
      prePushCheck.includes('bun'),
    'The pre-push check formats and lints changed files and typechecks with bun check under a 9s cap',
  );
  assert(
    !prePushCheck.includes("['scripts/check-format.js', ...files]"),
    'pre-push does not pass modified files to oxfmt, because oxfmt checks the whole file',
  );
  assert(
    frontendPackageJson.scripts.build.startsWith('bun check && ') &&
      frontendPackageJson.scripts.build.includes('node scripts/canvas-appear-budget.mjs') &&
      frontendPackageJson.scripts.build.includes('node scripts/shell-preload-budget.mjs'),
    'The frontend build checks types with bun check and verifies both bundle budgets',
  );
  assert(
    job('frontend').includes('node scripts/run-test-suites.js frontend 1/3') &&
      job('frontend-shard-2').includes('node scripts/run-test-suites.js frontend 2/3') &&
      job('frontend-shard-3').includes('node scripts/run-test-suites.js frontend 3/3'),
    'The frontend suite is split into three duration-balanced shards instead of one long job',
  );
  assert(
    job('lint').includes('with-budget.js 60 -- bun run lint') &&
      job('lint').includes('with-budget.js 30 -- bun run format:check') &&
      job('lint').includes('with-budget.js 60 -- bun run check:any') &&
      job('lint').includes('with-budget.js 30 -- bun run check:ratchet') &&
      job('lint').includes('with-budget.js 90 -- bun run audit:python') &&
      job('lint').includes('with-budget.js 60 -- bun run audit:node'),
    'Lint job runs oxlint, ruff, oxfmt, quality ratchet, any-guard and dependency audits under hard budgets',
  );
  assert(
    job('typecheck').includes('bun run typecheck:frontend') && job('typecheck').includes('bun run typecheck:backend'),
    'Typecheck job runs bun check and mypy independently of tests and build',
  );
  assert(
    job('build').includes('with-budget.js 120 -- bun run build:frontend'),
    'Build job runs frontend build and bundle budgets in parallel under a hard budget',
  );
  assert(
    job('contracts').includes('node scripts/run-test-suites.js contracts') &&
      job('contracts').includes('node scripts/check-budgets.js --agent-prompt-only'),
    'Contracts job runs contract suites and agent prompt budget outside the slowest jobs',
  );
  assert(
    job('electron').includes('with-budget.js 200 -- node scripts/run-test-suites.js electron') &&
      job('electron').includes('with-budget.js 60 -- node scripts/run-test-suites.js turns'),
    'Electron job runs electron and turns suites in parallel with build and lint under hard budgets',
  );
  assert(pangoSetup.includes('pacman -S mingw-w64-x86_64-pango'), 'Windows tests install Pango');
  assert(
    pangoSetup.includes('if ($LASTEXITCODE -ne 0)') && pangoSetup.includes('exit $LASTEXITCODE'),
    'Pango installation failures stop the backend branch',
  );
  assert(
    !job('lint').includes('install-ci-pango') &&
      !job('frontend').includes('install-ci-pango') &&
      !job('build').includes('install-ci-pango'),
    'Only the backend runner installs Pango',
  );
  assert(
    pangoSetup.includes('WEASYPRINT_DLL_DIRECTORIES=') && pangoSetup.includes('$env:WEASYPRINT_DLL_DIRECTORIES ='),
    'Windows tests configure WeasyPrint DLLs for validation and later steps',
  );
  assert(pangoSetup.includes("pdf.startswith(b'%PDF-')"), 'Fresh and cached runtimes must render a real PDF');
  assert(
    job('backend').indexOf('Install and validate Pango') < job('backend').indexOf('Run backend tests'),
    'Pango validation precedes backend tests',
  );
  assert(
    ci.includes('~/AppData/Local/antares-pango-dlls') && pangoSetup.includes('antares-pango-dlls'),
    'Pango cache stores only the WeasyPrint DLL directory',
  );
  assert(
    ci.includes('steps.runner-image.outputs.version') &&
      ci.includes("hashFiles('scripts/install-ci-pango.ps1')") &&
      !job('backend').includes('restore-keys:'),
    'Pango cache cannot cross runner images or installer versions',
  );
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
  assert(
    editorMediaSetup.includes('if ($LASTEXITCODE -ne 0)') && editorMediaSetup.includes('exit $LASTEXITCODE'),
    'Editor media provisioning failures stop the backend branch',
  );
  assert(
    job('backend').includes('Install and validate editor media') &&
      job('backend').indexOf('Install and validate editor media') < job('backend').indexOf('Run backend tests'),
    'Editor media provisioning precedes backend tests',
  );
  assert(
    job('backend').includes('editor-media-') && job('backend').includes("hashFiles('media/manifest.json')"),
    'Editor media cache is keyed by the media manifest, runner OS, architecture and image version',
  );
  assert(
    !job('lint').includes('install-ci-editor-media') &&
      !job('frontend').includes('install-ci-editor-media') &&
      !job('build').includes('install-ci-editor-media'),
    'Only the backend runner provisions editor media',
  );
  for (const suite of ['contracts', 'backend', 'electron', 'turns']) {
    const calls = ciJobs.match(new RegExp(`node scripts/run-test-suites\\.js ${suite}\\b`, 'g')) || [];
    assert(calls.length === 1, `Windows CI runs the ${suite} suite exactly once`);
  }
  assert(
    (ciJobs.match(/node scripts\/run-test-suites\.js frontend\b/g) || []).length === 3,
    'Windows CI runs the frontend suite exactly once per shard',
  );
  assert(
    runner.includes("run(bunCommand, ['run', 'test', '--', `--shard=${shard}`], frontend)"),
    'The test runner forwards the shard to Vitest via bun',
  );
  assert(
    runner.includes("shard.split('/')[0] === '1'") &&
      runner.includes("run(bunCommand, ['run', 'test:static'], frontend)"),
    'The single-worker static suite runs exactly once, in the first shard',
  );
  assert(
    runner.includes("run(bunCommand, ['run', 'test:all'], frontend)"),
    'The unsharded frontend suite still runs every frontend test',
  );
  assert(
    !/run: node scripts\/run-test-suites\.js\s*$/m.test(ci),
    'CI does not repeat the full suite alongside parallel suites',
  );
  assert(
    runner.includes("run(bunCommand, ['run', 'test:all'], frontend)"),
    'The unsharded frontend suite still runs every frontend test',
  );
  assert(
    !/run: node scripts\/run-test-suites\.js\s*$/m.test(ci),
    'CI does not repeat the full suite alongside parallel suites',
  );
  assert(
    job('verify').includes('name: Lint, audit, and test (Windows)') &&
      job('verify').includes('if: always()') &&
      job('verify').includes(
        'needs: [changes, lint, typecheck, build, contracts, electron, frontend, frontend-shard-2, frontend-shard-3, backend]',
      ),
    'The existing required check always evaluates the selector and every worker job',
  );
  assert(
    ['changes', ...workerJobs].every((name) => job('verify').includes(`needs.${name}.result`)) &&
      job('verify').includes("$gate -eq 'true' -and $result -ne 'success'") &&
      job('verify').includes("$gate -ne 'true' -and $result -ne 'success' -and $result -ne 'skipped'"),
    'The required check fails selected jobs unless they succeed and rejects failures in unselected jobs',
  );
  for (const output of new Set(Object.values(gateByJob))) {
    assert(
      job('verify').includes(`needs.changes.outputs.${output}`),
      `The required check reads the ${output} selection to validate skips`,
    );
  }
  assert(
    job('backend').includes('pytest tests/test_stress_conversion.py tests/test_scalability_baseline.py -m slow'),
    'Windows CI runs slow stress tests and scalability baselines',
  );
  if (process.platform === 'win32') {
    const gate = job('verify').split('        run: |')[1].trim();
    const result = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `
      function Invoke-Gate { ${gate} }
      $resultNames = @('TYPECHECK_RESULT', 'BUILD_RESULT', 'CONTRACTS_RESULT', 'ELECTRON_RESULT', 'FRONTEND_RESULT', 'FRONTEND_SHARD_2_RESULT', 'FRONTEND_SHARD_3_RESULT', 'BACKEND_RESULT')
      $gateNames = @('GATE_TYPECHECK', 'GATE_BUILD', 'GATE_CONTRACTS', 'GATE_ELECTRON', 'GATE_FRONTEND', 'GATE_BACKEND')
      function Reset-Env {
        [Environment]::SetEnvironmentVariable('CHANGES_RESULT', 'success')
        [Environment]::SetEnvironmentVariable('LINT_RESULT', 'success')
        foreach ($name in $gateNames) { [Environment]::SetEnvironmentVariable($name, 'true') }
        foreach ($name in $resultNames) { [Environment]::SetEnvironmentVariable($name, 'success') }
      }
      function Test-Rejected { try { Invoke-Gate; return $false } catch { return $true } }
      Reset-Env
      Invoke-Gate
      foreach ($name in $resultNames) {
        foreach ($state in @('failure', 'cancelled', 'skipped', '')) {
          [Environment]::SetEnvironmentVariable($name, $state)
          if (-not (Test-Rejected)) { throw "Gate accepted selected $name=$state" }
        }
        [Environment]::SetEnvironmentVariable($name, 'success')
      }
      foreach ($name in $gateNames) { [Environment]::SetEnvironmentVariable($name, 'false') }
      foreach ($name in $resultNames) { [Environment]::SetEnvironmentVariable($name, 'skipped') }
      Invoke-Gate
      [Environment]::SetEnvironmentVariable('TYPECHECK_RESULT', 'failure')
      if (-not (Test-Rejected)) { throw 'Gate accepted failure in an unselected job' }
      Reset-Env
      [Environment]::SetEnvironmentVariable('CHANGES_RESULT', 'failure')
      if (-not (Test-Rejected)) { throw 'Gate accepted a failed changes job' }
      Reset-Env
      [Environment]::SetEnvironmentVariable('LINT_RESULT', 'skipped')
      if (-not (Test-Rejected)) { throw 'Gate accepted skipped lint' }
    `,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert(
      result.status === 0,
      `The actual PowerShell gate accepts success plus unselected skips and rejects every other state: ${result.stderr}`,
    );
  }
  for (const input of ['node', 'python', 'root', 'frontend']) {
    assert(
      new RegExp(`  ${input}:[\\s\\S]*?default: 'true'`).test(setupCi),
      `Release setup keeps ${input} enabled by default`,
    );
  }
  assert(
    ['frontend', 'frontend-shard-2', 'frontend-shard-3'].every(
      (name) => job(name).includes("python: 'false'") && job(name).includes("root: 'false'"),
    ),
    'Frontend shards skip Python and root Electron installs after moving agent-profiles to root Vitest',
  );
  assert(
    job('backend').includes("frontend: 'false'") && job('backend').includes("root: 'false'"),
    'Backend setup skips both Node installs',
  );
  assert(
    packageJson.scripts['audit:python'].endsWith('python scripts/audit_python.py'),
    'The shared audit uses the tested lock exporter',
  );

  assert(nodeVersion === '22.19.0', '.node-version pins Node 22.19.0');
  assert(setupCi.includes("node-version-file: '.node-version'"), 'setup-ci reads the committed Node version file');
  assert(
    setupCi.includes('path: .venv') && setupCi.includes("hashFiles('uv.lock', 'pyproject.toml')"),
    'setup-ci caches .venv directly keyed by uv.lock and pyproject.toml',
  );
  assert(
    setupCi.includes("hashFiles('frontend/bun.lock')") && setupCi.includes('path: frontend/node_modules'),
    'setup-ci caches frontend/node_modules keyed by frontend/bun.lock',
  );
  assert(
    setupCi.includes('bun install --frozen-lockfile'),
    'setup-ci installs root dependencies with bun install --frozen-lockfile',
  );
  assert(
    setupCi.includes('bun install --frozen-lockfile --cwd frontend'),
    'setup-ci installs frontend dependencies with bun install --frozen-lockfile',
  );
  assert(
    setupCi.includes("hashFiles('bun.lock')") && setupCi.includes('path: node_modules'),
    'setup-ci caches root node_modules keyed by bun.lock',
  );
  assert(fs.existsSync(UV_LOCK_PATH), 'Python toolchain has a committed uv lockfile');
  assert(setupCi.includes('uv sync --locked --extra dev'), 'setup-ci installs Python dependencies from uv.lock');
  assert(
    setupCi.includes('UV_VERSION: 0.11.19') && setupCi.includes('sha256sum -c'),
    'setup-ci installs the pinned uv release verified by SHA-256',
  );
  assert(
    setupCi.includes('BUN_VERSION: 1.4.4') && setupCi.includes('bun-windows-x64.zip'),
    'setup-ci installs the pinned Bun release verified by SHA-256',
  );
  assertActionsPinned(setupCi, 'setup-ci');

  assert(packageJson.scripts.ci.includes('bun run audit:node'), 'shared CI gate includes Node dependency audits');
  assert(packageJson.scripts.ci.includes('bun run check:ratchet'), 'shared CI gate includes the quality ratchet');
  assert(packageJson.scripts.ci.split(' && ').includes('bun run test'), 'shared CI gate runs the full test suite');
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
    runner
      .replace(/\s+/g, '')
      .includes("run('uv',['run','--project',ROOT,'--locked','--extra','dev','python','-m','pytest','../tests','-v']"),
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
  assert(
    runner.includes('function ensureElectronBinary()') &&
      runner.indexOf('ensureElectronBinary();') < runner.indexOf('await runNodeTestsParallel(ELECTRON_TESTS)'),
    'The electron suite installs the binary once before the parallel pool',
  );
  assert(runner.includes('runNodeTests(CONTRACT_TESTS)'), 'The contract suite stays serial');
  assert(runner.includes('node tests failed:'), 'The Node test pool fails closed naming every failed test file');
  assert(runner.includes("'test-quality-ratchet.js'"), 'test runner treats quality-ratchet as a contract test');
  assert(runner.includes("'test-review-policy.js'"), 'test runner treats review-policy as a contract test');
  assert(
    packageJson.scripts['test:stress'].includes('uv run --project .. --locked --extra dev python -m pytest'),
    'stress tests use the locked Python environment',
  );
  assert(
    viteConfig.includes("pool: 'threads'") &&
      viteConfig.includes('isolate: false') &&
      viteConfig.includes('fileParallelism: false') &&
      viteConfig.includes('mockReset: true'),
    'Frontend Vitest shares module state with sequential files in one worker per shard',
  );
  assertSingleWorker(staticVitestConfig, 'Static Vitest');
  assert(
    packageJson.scripts['audit:node'].includes('bun audit --omit=dev --audit-level=high') &&
      packageJson.scripts['audit:node'].includes('bun audit --cwd frontend --omit=dev --audit-level=high'),
    'shared Node audit covers Electron and frontend runtime dependencies via bun audit',
  );

  assert(release.includes('uses: ./.github/actions/setup-ci'), 'Release verify reuses the shared setup-ci action');
  assert(
    release.includes("node-version-file: '.node-version'") || release.includes('uses: ./.github/actions/setup-ci'),
    'Release build uses setup-ci with the committed Node version file',
  );
  assert(!release.includes('continue-on-error: true'), 'Release dependency audits fail closed');
  assert(release.includes('run: bun run ci'), 'Release reuses the same fail-closed CI quality gate');
  assert(
    release.includes('Validate required build configuration'),
    'Release rejects missing production build configuration',
  );
  assert(release.includes('Antares-Setup-*.exe'), 'Release allowlists the NSIS installer');
  assert(release.includes('Antares-Portable-*.exe'), 'Release allowlists the portable executable');
  assert(release.includes('latest.yml'), 'Release includes updater metadata');
  assert(release.includes('SHA256SUMS.txt'), 'Release includes generated checksums');
  assert(release.includes('SOURCE_DATE_EPOCH'), 'Release pins SOURCE_DATE_EPOCH from the last commit');
  assert(release.includes('WINDOWS_CODESIGN_PFX'), 'Release wires Authenticode signing from WINDOWS_CODESIGN_PFX');
  assert(release.includes('CSC_LINK'), 'Release feeds electron-builder through CSC_LINK');
  assert(
    release.includes('Sign release checksums (GPG, optional)'),
    'Release includes the optional GPG checksum signature step',
  );
  assert(release.includes('SHA256SUMS.txt.asc'), 'Release uploads the GPG signature of the checksums');
  assert(
    release.includes('expected_count=5') && release.includes('expected_count=6'),
    'Release accepts the asset count with and without GPG signature',
  );
  assert(
    !release.includes('forceCodeSigning: true'),
    'Release never hard-fails builds when signing secrets are absent',
  );
  const uploadBlock = release.slice(
    release.indexOf('uses: actions/upload-artifact'),
    release.indexOf('uses: actions/download-artifact'),
  );
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
