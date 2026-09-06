const path = require('path');
const { execFileSync, execSync } = require('child_process');

const REPO_OWNER = 'sechgio';
const REPO_NAME = 'antares';
const BASE_BRANCH = 'main';
const ROOT = path.resolve(__dirname, '..', '..');

function sh(command, opts = {}) {
  const result = execSync(command, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 50 * 1024 * 1024,
    ...opts,
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

module.exports = {
  REPO_OWNER,
  REPO_NAME,
  BASE_BRANCH,
  ROOT,
  sh,
  trySh,
  shDetailed,
  step,
  skip,
  die,
  detectRepo,
};
