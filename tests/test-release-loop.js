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
  const loopUtils = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'loop-utils.js'), 'utf8');

  assert(content.includes('runQualityGate'), 'quality gate delegates to the shared fail-closed helper');
  assert(loopUtils.includes("runQualityCommand('npm run ci 2>&1'"), 'shared quality gate runs npm run ci');
  assert(
    !content.includes("trySh('npm run lint:python") &&
      !content.includes("trySh('npm run typecheck:backend") &&
      !content.includes("trySh('npm run typecheck:frontend"),
    'quality gate does not swallow mandatory command failures'
  );
  assert(!content.includes("trySh('npm run ci"), 'quality gate cannot fail open');
  assert(!loopUtils.includes("trySh('npm run ci"), 'shared quality gate cannot fail open');

  assert(
    content.includes('const remoteTag = sh('),
    'remote tag lookup must fail closed when git ls-remote fails',
  );
  assert(
    content.includes('shDetailed('),
    'GitHub release lookup must distinguish not-found from command failures',
  );
  assert(
    content.includes('git fetch --dry-run origin main') && content.includes('refreshRemote'),
    'dry-run must not mutate git refs while ship mode refreshes origin/main',
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
