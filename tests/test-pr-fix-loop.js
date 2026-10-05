const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');

const { assert, assertActionsPinned, finish } = require('./helpers/harness');

const ROOT = path.join(__dirname, '..');
const scriptPath = path.join(ROOT, 'scripts', 'pr-fix-loop.js');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'pr-fix-loop.yml');

function run() {
  console.log('Testing pr-fix-loop script...\n');

  assert(fs.existsSync(scriptPath), 'scripts/pr-fix-loop.js exists');

  const content = fs.readFileSync(scriptPath, 'utf8');
  assert(content.includes('PR Fix Loop'), 'script documents PR fix loop purpose');
  assert(content.includes('SkipTag') || content.includes('[skip-ci-fix]'), 'script has anti-loop skip tag');
  assert(content.includes('MAX_ITER') || content.includes('maxIter'), 'script has max iterations guard');
  assert(content.includes('canAutoMerge'), 'script has auto-merge guard function');
  assert(content.includes('reviewDecision'), 'script checks PR approval before merge');
  assert(content.includes('mergeable'), 'script checks mergeable state before merge');
  assert(content.includes('APPROVED'), 'script enforces APPROVED review');
  assert(content.includes('lint:fix') || content.includes('lint:fix'), 'script applies deterministic heuristics (ruff --fix)');
  assert(content.includes('uv run --project . --locked --extra dev ruff format'), 'script formats Python with locked ruff');
  assert(!content.includes('prettier'), 'script does not invoke prettier (not a project dependency)');
  assert(!/HIDROAA|C:\\\\Users\\\\/.test(content), 'script does not hardcode a developer machine path');
  assert(content.includes('invokeDroidFixer'), 'script has droid fallback for residual errors');
  assert(/NO elimines/i.test(content) || /no elimines codigo/i.test(content), 'script instructs droid to never delete code');
  assert(content.includes('sleepMs'), 'pending-check wait uses a portable Node sleep');

  assert(fs.existsSync(workflowPath), '.github/workflows/pr-fix-loop.yml exists');
  const wf = fs.readFileSync(workflowPath, 'utf8');
  assert(wf.includes('workflow_dispatch:'), 'workflow is available for explicit manual diagnostics');
  assert(!wf.includes('pull_request:'), 'workflow does not execute automatically on untrusted PR code');
  assert(wf.includes('required: true'), 'workflow requires an explicit PR number');
  assert(wf.includes('contents: read'), 'workflow has read-only repository permission');
  assert(wf.includes('pull-requests: read'), 'workflow has read-only pull request permission');
  assert(!wf.includes('contents: write'), 'workflow cannot push commits');
  assert(!wf.includes('pull-requests: write'), 'workflow cannot comment or merge');
  assert(wf.includes('persist-credentials: false'), 'workflow checkout does not persist Git credentials');
  assert(!wf.includes('npm install'), 'workflow does not execute dependency lifecycle scripts');
  assert(!wf.includes('--ship'), 'workflow never enables fixer side effects');
  assert(!wf.includes('--merge'), 'workflow never auto-merges');
  assertActionsPinned(wf, 'pr-fix-loop workflow');

  try {
    execSync('node --check scripts/pr-fix-loop.js', { cwd: ROOT, stdio: 'pipe' });
    assert(true, 'pr-fix-loop.js parses without syntax errors');
  } catch {
    assert(false, 'pr-fix-loop.js parses without syntax errors');
  }

  const commands = [];
  const messages = [];
  const waits = [];
  let snapshots = [];
  const loop = vm.runInNewContext(
    content.replace(/\bmain\(\);\s*$/, '') + '\n({ allChecksPass, anyCheckFails, canAutoMerge, runLoop })',
    {
      require: () => ({
        ROOT,
        trySh: (command) => {
          commands.push(command);
          if (command.startsWith('gh pr view')) return JSON.stringify({ state: 'OPEN', headRefName: 'feature' });
          if (command.startsWith('gh pr checks')) return JSON.stringify(snapshots.shift() || []);
          if (command.startsWith('gh run list')) return '[]';
          throw new Error(`Unexpected command: ${command}`);
        },
        sleepMs: (ms) => waits.push(ms),
        skip: () => {},
      }),
      console: { log: (message) => messages.push(message) },
    },
  );
  const green = [{ bucket: 'pass' }, { bucket: 'skipping' }];
  assert(loop.allChecksPass(green), 'gh pass/skipping buckets are successful');
  assert(!loop.allChecksPass([]), 'an empty check list cannot pass');
  assert(!loop.allChecksPass([{ bucket: 'unknown' }]), 'an unknown bucket cannot pass');
  assert(!loop.anyCheckFails(green), 'successful or skipped checks are not failures');
  const approved = { state: 'OPEN', reviewDecision: 'APPROVED', mergeable: 'MERGEABLE' };
  assert(loop.canAutoMerge(approved, green).ok, 'merge guard accepts successful gh buckets with approval');
  for (const bucket of ['fail', 'cancel']) {
    const checks = [{ bucket }];
    assert(loop.anyCheckFails(checks), `gh ${bucket} bucket is a failure`);
    assert(!loop.allChecksPass(checks), `${bucket} checks cannot pass`);
    assert(!loop.canAutoMerge(approved, checks).ok, `${bucket} checks block merge`);
  }

  const pending = [{ bucket: 'pending' }];
  assert(!loop.allChecksPass(pending), 'pending checks cannot pass');
  assert(!loop.anyCheckFails(pending), 'pending checks are not failures');
  assert(!loop.canAutoMerge(approved, pending).ok, 'pending checks block merge');
  snapshots = [green];
  assert(loop.runLoop({ prNumber: 187, maxIter: 1, isShip: false, doMerge: false }), 'green checks resolve the loop');
  assert(!commands.some((command) => command.startsWith('gh run list')), 'green checks do not inspect failed runs');

  commands.length = 0;
  messages.length = 0;
  snapshots = [pending];
  assert(!loop.runLoop({ prNumber: 187, maxIter: 1, isShip: false, doMerge: false }), 'pending dry-run stays unresolved');
  assert(messages.some((message) => message.includes('Checks pendientes')), 'pending dry-run reports pending checks');
  assert(!commands.some((command) => command.startsWith('gh run list')), 'pending checks do not inspect failed runs');

  commands.length = 0;
  snapshots = [pending, green];
  try {
    assert(loop.runLoop({ prNumber: 187, maxIter: 2, isShip: true, doMerge: false }), 'pending then green resolves without invoking fixers');
  } catch (error) {
    assert(false, `pending then green resolves without invoking fixers: ${error.message}`);
  }
  assert(waits.length === 1 && waits[0] === 30000, 'ship waits once before rechecking pending checks');

  finish();
}

run();
