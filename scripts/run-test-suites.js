#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const CONTRACT_TESTS = [
  'test-version-sync.js',
  'test-ci-workflows.js',
  'test-push-loop.js',
  'test-pr-fix-loop.js',
  'test-release-loop.js',
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

function runSuite(name) {
  switch (name) {
    case 'contracts':
      runNodeTests(CONTRACT_TESTS);
      return;
    case 'backend':
      run('uv', ['run', '--project', ROOT, '--locked', '--extra', 'dev', 'pytest', '../tests', '-v'], path.join(ROOT, 'backend'));
      return;
    case 'electron':
      runNodeTests(ELECTRON_TESTS);
      return;
    case 'frontend':
      run(npmCommand, ['run', 'test:all'], path.join(ROOT, 'frontend'));
      return;
    default:
      throw new Error(`Unknown test suite: ${name}`);
  }
}

const requestedSuite = process.argv[2];
const suites = requestedSuite ? [requestedSuite] : ['contracts', 'backend', 'electron', 'frontend'];

try {
  for (const suite of suites) runSuite(suite);
  console.log('\nAll requested test suites passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
