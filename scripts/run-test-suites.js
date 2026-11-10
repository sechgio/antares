#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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

const PARALLEL_NODE_CONCURRENCY = readParallelConcurrency();

function readParallelConcurrency() {
  const parsed = Number.parseInt(process.env.ANTARES_NODE_TEST_CONCURRENCY ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 4;
}

// Runs plain-Node test files in a bounded worker pool: every file keeps running
// even after another one fails, and the aggregate always fails closed.
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
    run(npmCommand, ['run', 'test', '--', `--shard=${shard}`], frontend);
    if (shard.split('/')[0] === '1') run(npmCommand, ['run', 'test:static'], frontend);
    return;
  }
  run(npmCommand, ['run', 'test:all'], frontend);
}

async function runSuite(name, shard = null) {
  switch (name) {
    case 'contracts':
      runNodeTests(CONTRACT_TESTS);
      return;
    case 'backend':
      run('uv', ['run', '--project', ROOT, '--locked', '--extra', 'dev', 'pytest', '../tests', '-v'], path.join(ROOT, 'backend'));
      return;
    case 'electron':
      await runNodeTestsParallel(ELECTRON_TESTS);
      return;
    case 'turns':
      run(npmCommand, ['run', 'test:turns'], ROOT);
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
