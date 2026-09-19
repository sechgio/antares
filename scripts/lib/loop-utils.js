const path = require('path');
const { execFile, execFileSync, execSync } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

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

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function gh(args, opts = {}) {
  const out = execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts });
  return out == null ? '' : out.trim();
}

function ghApi(args, opts = {}) {
  return gh(['api', ...args], { timeout: 60_000, maxBuffer: 40 * 1024 * 1024, ...opts });
}

// Variante no bloqueante de gh(): permite lanzar varias llamadas a la vez (auditorías de PR).
async function ghAsync(args, opts = {}) {
  const { stdout } = await execFileAsync('gh', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  });
  return (stdout || '').toString().trim();
}

async function ghApiAsync(args, opts = {}) {
  return ghAsync(['api', ...args], { timeout: 30_000, ...opts });
}

// spec: { defaults: {...}, flags: { '--flag': { key } } booleano,
// '--flag': { key, value: true, coerce?: fn } con valor }
function parseCliArgs(argv, { defaults = {}, flags = {} } = {}) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const spec = flags[argv[i]];
    if (!spec) continue;
    if (spec.value) {
      const raw = argv[++i];
      out[spec.key] = spec.coerce ? spec.coerce(raw) : raw;
    } else {
      out[spec.key] = true;
    }
  }
  return out;
}

function parseLoopArgs(argv) {
  const args = argv.slice(2);
  return {
    isShip: args.includes('--ship'),
    doMerge: args.includes('--merge'),
    has: (flag) => args.includes(flag),
    value: (flag) => {
      const idx = args.indexOf(flag);
      if (idx === -1) return null;
      const v = args[idx + 1];
      return v && !v.startsWith('--') ? v : null;
    },
  };
}

function printLoopBanner(title, isShip, shipLabel) {
  const mode = isShip ? `🚀 SHIP MODE (${shipLabel})` : '🔍 DRY-RUN (sin side effects)';
  console.log('\n════════════════════════════════════════════');
  console.log(`  ${title}`);
  console.log(`  ${mode}`);
  console.log('════════════════════════════════════════════\n');
}

function shipStep(label, enabled, fn, skipReason) {
  if (enabled) return step(label, fn);
  return skip(label, skipReason);
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

function commitAll(message) {
  git(['add', '-A']);
  git(['commit', '-m', message]);
  console.log(`    Commit creado: ${message}`);
}

function pushBranch(branch) {
  const upstream = trySh(`git rev-parse --abbrev-ref "${branch}@{upstream}" 2>&1`);
  if (upstream && !upstream.includes('fatal')) {
    sh(`git push origin "${branch}"`);
  } else {
    sh(`git push -u origin "${branch}"`);
  }
  console.log(`    Branch ${branch} pusheada a origin.`);
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
  git,
  gh,
  ghApi,
  ghAsync,
  ghApiAsync,
  parseCliArgs,
  parseLoopArgs,
  printLoopBanner,
  shipStep,
  step,
  skip,
  die,
  commitAll,
  pushBranch,
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
