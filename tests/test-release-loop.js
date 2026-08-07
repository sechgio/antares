const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const scriptPath = path.join(ROOT, 'scripts', 'release-loop.js');

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
  console.log('Testing release-loop quality gate...\n');

  assert(fs.existsSync(scriptPath), 'scripts/release-loop.js exists');

  const content = fs.readFileSync(scriptPath, 'utf8');
  const qualityGateStart = content.indexOf('function runQualityGate()');
  const buildStart = content.indexOf('function runBuild()');
  const qualityGate = content.slice(qualityGateStart, buildStart);

  assert(qualityGate.includes("const lintResult = sh('npm run lint:python 2>&1'"), 'lint propagates command failures');
  assert(qualityGate.includes("const tcBackend = sh('npm run typecheck:backend 2>&1'"), 'backend typecheck propagates command failures');
  assert(qualityGate.includes("const tcFrontend = sh('npm run typecheck:frontend 2>&1'"), 'frontend typecheck propagates command failures');
  assert(
    !qualityGate.includes("trySh('npm run lint:python") &&
      !qualityGate.includes("trySh('npm run typecheck:backend") &&
      !qualityGate.includes("trySh('npm run typecheck:frontend"),
    'quality gate does not swallow mandatory command failures'
  );
  assert(
    qualityGate.includes("sh('npm run audit:python 2>&1'"),
    'Python dependency audit propagates command failures'
  );
  assert(
    !qualityGate.includes("trySh('npm run audit:python"),
    'Python dependency audit cannot fail open'
  );

  assert(
    content.includes('HEAD...origin/main') || content.includes('HEAD === origin/main'),
    'release requires local HEAD to equal origin/main'
  );
  assert(content.includes('git tag -a'), 'release creates an annotated tag');
  assert(!content.includes('gh release create'), 'local release loop leaves publication to GitHub Actions');

  try {
    execSync('node --check scripts/release-loop.js', { cwd: ROOT, stdio: 'pipe' });
    assert(true, 'release-loop.js parses without syntax errors');
  } catch {
    assert(false, 'release-loop.js parses without syntax errors');
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run();
