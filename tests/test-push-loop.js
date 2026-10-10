const fs = require('fs');
const path = require('path');

const { assert, finish } = require('./helpers/harness');

const ROOT = path.join(__dirname, '..');
const scriptPath = path.join(ROOT, 'scripts', 'push-loop.js');

function run() {
  console.log('Testing push-loop script...\n');

  const content = fs.readFileSync(scriptPath, 'utf8');
  assert(content.includes('PR-first'), 'script documents PR-first workflow');
  assert(content.includes('ensureFeatureBranch'), 'script has branch guard logic');
  assert(content.includes("'pr', 'create'") || content.includes('gh pr create'), 'script creates PRs via gh');
  const loopUtils = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'loop-utils.js'), 'utf8');
  assert(
    loopUtils.includes("git diff --cached --name-only"),
    'commitAll respeta el índice: solo recurre a git add -A cuando está vacío',
  );
  assert(!content.includes('const tcBackend = trySh'), 'backend typecheck does not use output-only validation');

  const hookPath = path.join(ROOT, '.githooks', 'pre-push');
  const hook = fs.readFileSync(hookPath, 'utf8');
  assert(hook.includes('main'), 'pre-push hook protects main');

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

  finish();
}

run();
