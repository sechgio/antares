#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');
function resolveBunCommand() {
  if (process.env.BUN_BIN) return process.env.BUN_BIN;
  const homeBun = path.join(os.homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
  if (fs.existsSync(homeBun)) return homeBun;
  return process.platform === 'win32' ? 'bun.exe' : 'bun';
}
const bunCommand = resolveBunCommand();

const CONTRACT_TESTS = [
  'test-version-sync.js',
  'test-ci-workflows.js',
  'test-push-loop.js',
  'test-pr-fix-loop.js',
  'test-release-loop.js',
  'test-branch-protection.js',
  'test-chunk-graph.js',
  'test-tailwind-alpha-utilities.js',
  'test-quality-ratchet.js',
  'test-review-policy.js',
  'test-admin-create-user-contract.js',
  'test-admin-delete-user-contract.js',
];

const allNodeTests = fs
  .readdirSync(TESTS_DIR)
  .filter((name) => /^test-.*\.js$/.test(name))
  .sort((a, b) => a.localeCompare(b));

const ELECTRON_TESTS = allNodeTests.filter((name) => !CONTRACT_TESTS.includes(name));

function run(command, args, cwd = ROOT) {
  const printable = [command, ...args].join(' ');
  console.log(`\n$ ${printable}`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32' && String(command).toLowerCase().endsWith('.cmd'),
  });
  if (result.error) {
    console.error(`Failed to start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runNodeTests(testNames) {
  for (const name of testNames) {
    run(process.execPath, [path.join(TESTS_DIR, name)]);
  }
}

// require('electron') downloads and extracts the zip when dist is missing.
// Parallel workers on Windows then fail creating electron.exe or dxcompiler.dll
// with access denied. install.js returns immediately once the binary is present.
function ensureElectronBinary() {
  const installScript = path.join(ROOT, 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(installScript)) return;
  run(process.execPath, [installScript]);
}

const PARALLEL_NODE_CONCURRENCY = readParallelConcurrency();

function readParallelConcurrency() {
  const parsed = Number.parseInt(process.env.ANTARES_NODE_TEST_CONCURRENCY ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 4;
}

async function runNodeTestsParallel(testNames) {
  if (testNames.length === 0) return;
  const total = testNames.length;
  const concurrency = Math.min(PARALLEL_NODE_CONCURRENCY, total);
  const pending = [...testNames];
  const failures = [];
  let queued = 0;
  let completed = 0;
  console.log(
    `\n$ node tests/<file> x${total} (bounded pool of ${concurrency} workers; ` +
      'ANTARES_NODE_TEST_CONCURRENCY overrides it)',
  );
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      let name;
      while ((name = pending.shift()) !== undefined) {
        queued += 1;
        console.log(`$ node tests/${name} (${queued}/${total})`);
        const prefix = `[${name}] `;
        const child = spawn(process.execPath, [path.join(TESTS_DIR, name)], {
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        for (const stream of [child.stdout, child.stderr]) {
          stream.setEncoding('utf8');
          let carry = '';
          stream.on('data', (chunk) => {
            carry += chunk;
            let newlineAt = carry.indexOf('\n');
            while (newlineAt !== -1) {
              console.log(prefix + carry.slice(0, newlineAt));
              carry = carry.slice(newlineAt + 1);
              newlineAt = carry.indexOf('\n');
            }
          });
          stream.on('end', () => {
            if (carry.length > 0) console.log(prefix + carry);
          });
        }
        const code = await new Promise((resolve) => {
          child.on('close', resolve);
        });
        completed += 1;
        if (code !== 0) failures.push({ name, code });
        console.log(`\n${prefix}finished with exit code ${code ?? 'signal'} (${completed}/${total} done)`);
      }
    }),
  );
  if (failures.length > 0) {
    const summary = failures.map((failure) => `${failure.name} (exit ${failure.code ?? 'signal'})`).join(', ');
    throw new Error(`node tests failed: ${summary}`);
  }
}

function runFrontendSuite(shard) {
  const frontend = path.join(ROOT, 'frontend');
  if (shard) {
    run(bunCommand, ['run', 'test', '--', `--shard=${shard}`], frontend);
    if (shard.split('/')[0] === '1') run(bunCommand, ['run', 'test:static'], frontend);
    return;
  }
  run(bunCommand, ['run', 'test:all'], frontend);
}

async function runSuite(name, shard = null) {
  switch (name) {
    case 'contracts':
      runNodeTests(CONTRACT_TESTS);
      return;
    case 'backend':
      // `python -m pytest` en vez del console script: con el launcher pytest.exe
      // tempfile no logra escribir en %LOCALAPPDATA%\Temp en algunos entornos
      // Windows y gettempdir() cae al cwd, contaminando backend/ con artefactos.
      run(
        'uv',
        ['run', '--project', ROOT, '--locked', '--extra', 'dev', 'python', '-m', 'pytest', '../tests', '-v'],
        path.join(ROOT, 'backend'),
      );
      return;
    case 'electron':
      ensureElectronBinary();
      await runNodeTestsParallel(ELECTRON_TESTS);
      return;
    case 'turns':
      run(bunCommand, ['run', 'test:turns'], ROOT);
      return;
    case 'frontend':
      runFrontendSuite(shard);
      return;
    default:
      throw new Error(`Unknown test suite: ${name}`);
  }
}

const requestedSuite = process.argv[2];
const requestedShard = process.argv[3];
if (requestedShard && !/^\d+\/\d+$/.test(requestedShard)) {
  throw new Error(`Invalid shard (expected <index>/<count>): ${requestedShard}`);
}
const suites = requestedSuite ? [requestedSuite] : ['contracts', 'backend', 'electron', 'turns', 'frontend'];

async function main() {
  try {
    for (const suite of suites) await runSuite(suite, requestedShard);
    console.log('\nAll requested test suites passed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
