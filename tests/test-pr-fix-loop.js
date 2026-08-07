// Smoke test: el fixer local conserva sus guardas y el workflow remoto solo diagnostica manualmente.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const scriptPath = path.join(ROOT, 'scripts', 'pr-fix-loop.js');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'pr-fix-loop.yml');

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
  assert(content.includes('invokeDroidFixer'), 'script has droid fallback for residual errors');
  // Never delete code
  assert(/NO elimines/i.test(content) || /no elimines codigo/i.test(content), 'script instructs droid to never delete code');

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
  assert(
    [...wf.matchAll(/uses:\s+actions\/[^@\s]+@([^\s#]+)/g)].every((match) => /^[0-9a-f]{40}$/.test(match[1])),
    'workflow pins GitHub actions to full commit SHAs'
  );

  try {
    execSync('node --check scripts/pr-fix-loop.js', { cwd: ROOT, stdio: 'pipe' });
    assert(true, 'pr-fix-loop.js parses without syntax errors');
  } catch {
    assert(false, 'pr-fix-loop.js parses without syntax errors');
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run();
