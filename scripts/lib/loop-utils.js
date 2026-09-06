const path = require('path');
const { execFileSync, execSync } = require('child_process');

const REPO_OWNER = 'sechgio';
const REPO_NAME = 'antares';
const BASE_BRANCH = 'main';
const ROOT = path.resolve(__dirname, '..', '..');
const QUALITY_GATE_TIMEOUT_MS = 900000;

function sh(command, opts = {}) {
  const { silent: _, ...execOpts } = opts;
  const result = execSync(command, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 50 * 1024 * 1024,
    ...execOpts,
  });
  return (result || '').toString().trim();
}

function trySh(command, opts = {}) {
  try {
    return sh(command, opts);
  } catch {
    return null;
  }
}

function shDetailed(command, opts = {}) {
  try {
    return { ok: true, output: sh(command, opts), status: 0 };
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .map((value) => value.toString())
      .join('')
      .trim();
    return { ok: false, output, status: error.status || null };
  }
}

function step(label, fn) {
  process.stdout.write(`  ${label} ... `);
  try {
    const result = fn();
    console.log('✅');
    return result;
  } catch (err) {
    console.log('❌');
    console.error(`    ${err.message}`);
    const e = new Error(err.message || 'Step failed');
    e.code = err.status || err.code || 1;
    throw e;
  }
}

function skip(label, reason) {
  console.log(`  ${label} ... ⏭️  (${reason})`);
}

function die(message, code = 1) {
  console.error(`\n✗ ${message}`);
  process.exit(code);
}

function detectRepo() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    const match = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

function requireGhAuth() {
  const ghStatus = trySh('gh auth status 2>&1');
  if (!ghStatus) {
    throw new Error('GitHub CLI (gh) no está autenticado. Corre: gh auth login');
  }
}

function requireOriginRepo() {
  const remoteUrl = trySh('git remote get-url origin');
  if (!remoteUrl || !remoteUrl.includes(`${REPO_OWNER}/${REPO_NAME}`)) {
    throw new Error(
      `Remote origin debe apuntar a ${REPO_OWNER}/${REPO_NAME}, actual: ${remoteUrl || '(sin remote)'}`,
    );
  }
}

function currentBranch() {
  return sh('git rev-parse --abbrev-ref HEAD');
}

function workingTreeDirty() {
  return Boolean(sh('git status --porcelain'));
}

function findOpenPrNumber(branch) {
  const json = trySh(
    `gh pr list --head "${branch}" --base "${BASE_BRANCH}" --state open --json number --jq ".[0].number" 2>&1`,
  );
  if (!json || json.includes('error') || json === 'null') return null;
  const num = Number(json);
  return Number.isFinite(num) ? num : null;
}

function mergePr(prNumber) {
  sh(`gh pr merge ${prNumber} --merge --delete-branch`);
  console.log(`    PR #${prNumber} mergeado a ${BASE_BRANCH}.`);
}

function sleepMs(ms) {
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration);
}

function runQualityCommand(command, label, options = {}) {
  try {
    return execSync(command, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 50 * 1024 * 1024,
      ...options,
    }).trim();
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .map((value) => value.toString())
      .join('\n')
      .trim();
    const status = Number.isInteger(error.status) ? error.status : 1;
    const failure = new Error(`${label} falló (exit ${status}):\n${output.slice(0, 800)}`);
    failure.code = status;
    throw failure;
  }
}

function runQualityGate() {
  console.log('');
  runQualityCommand('npm run ci 2>&1', 'Quality gate (npm run ci)', { timeout: QUALITY_GATE_TIMEOUT_MS });
}

module.exports = {
  REPO_OWNER,
  REPO_NAME,
  BASE_BRANCH,
  ROOT,
  QUALITY_GATE_TIMEOUT_MS,
  sh,
  trySh,
  shDetailed,
  step,
  skip,
  die,
  detectRepo,
  requireGhAuth,
  requireOriginRepo,
  currentBranch,
  workingTreeDirty,
  findOpenPrNumber,
  mergePr,
  sleepMs,
  runQualityCommand,
  runQualityGate,
};
