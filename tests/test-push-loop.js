const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const scriptPath = path.join(ROOT, 'scripts', 'push-loop.js');

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
  console.log('Testing push-loop script...\n');

  assert(fs.existsSync(scriptPath), 'scripts/push-loop.js exists');

  const content = fs.readFileSync(scriptPath, 'utf8');
  assert(content.includes('PR-first'), 'script documents PR-first workflow');
  assert(content.includes('ensureFeatureBranch'), 'script has branch guard logic');
  assert(content.includes("'pr', 'create'") || content.includes('gh pr create'), 'script creates PRs via gh');
  assert(content.includes('function runQualityCommand'), 'quality gate tracks command exit codes');
  assert(!content.includes('const tcBackend = trySh'), 'backend typecheck does not use output-only validation');

  const hookPath = path.join(ROOT, '.githooks', 'pre-push');
  assert(fs.existsSync(hookPath), '.githooks/pre-push exists');
  const hook = fs.readFileSync(hookPath, 'utf8');
  assert(hook.includes('main'), 'pre-push hook protects main');

  try {
    execSync('node --check scripts/push-loop.js', { cwd: ROOT, stdio: 'pipe' });
    assert(true, 'push-loop.js parses without syntax errors');
  } catch {
    assert(false, 'push-loop.js parses without syntax errors');
  }

  const { runQualityCommand } = require('../scripts/push-loop');
  const successCommand = `"${process.execPath}" -e "process.stdout.write('quality-gate-passed')"`;
  assert(
    runQualityCommand(successCommand, 'Comando correcto') === 'quality-gate-passed',
    'quality gate returns successful command output',
  );

  const nodeCommand = `"${process.execPath}" -e "process.stdout.write('quality-gate-failed'); process.exit(7)"`;
  try {
    runQualityCommand(nodeCommand, 'Typecheck de backend');
    assert(false, 'non-zero quality command fails even without the word error');
  } catch (err) {
    assert(err.message.includes('exit 7'), 'quality gate reports the command exit code');
    assert(err.message.includes('quality-gate-failed'), 'quality gate preserves command output');
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run();
