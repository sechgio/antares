#!/usr/bin/env node
// Fast pre-push gate: oxfmt + oxlint on changed files plus a whole-project
// `bun check`. Hard budget: 9 seconds wall clock.

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BUDGET_SECONDS = 9;
const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const LINT_DIRS = /^(?:frontend\/src|electron|shared|scripts|tests)\//;

function bun() {
  if (process.env.BUN_BIN) return process.env.BUN_BIN;
  const homeBun = path.join(os.homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
  return fs.existsSync(homeBun) ? homeBun : process.platform === 'win32' ? 'bun.exe' : 'bun';
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles() {
  let base = null;
  try {
    const upstream = git(['rev-parse', '--abbrev-ref', '@{upstream}'])[0];
    if (upstream) base = git(['merge-base', upstream, 'HEAD'])[0];
  } catch {
    /* no upstream yet */
  }
  if (!base) {
    for (const ref of ['origin/main', 'HEAD~1']) {
      try {
        base = git(['merge-base', ref, 'HEAD'])[0];
        if (base) break;
      } catch {
        /* try next ref */
      }
    }
  }
  const committed = base ? git(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]) : [];
  const working = git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
  const staged = git(['diff', '--name-only', '--diff-filter=ACMR', '--cached', 'HEAD']);
  return [...new Set([...committed, ...working, ...staged])].filter((file) => fs.existsSync(path.join(ROOT, file)));
}

function run(label, command, args, cwd = ROOT) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.error || result.status !== 0) {
    console.error(`✗ ${label} failed (${seconds}s)`);
    process.exit(result.status ?? 1);
  }
  console.log(`✓ ${label} (${seconds}s)`);
}

const started = Date.now();
const files = changedFiles();
const jsFiles = files.filter((file) => JS_EXT.has(path.extname(file)) && LINT_DIRS.test(file));

console.log(`[pre-push] checking ${files.length} changed file(s)`);
if (files.length > 0) run('format', process.execPath, ['scripts/check-format.js', ...files]);
if (jsFiles.length > 0) run('oxlint', bun(), ['x', 'oxlint', '-c', '.oxlintrc.json', ...jsFiles]);
run('typecheck (bun check)', bun(), ['check'], path.join(ROOT, 'frontend'));

const elapsed = (Date.now() - started) / 1000;
console.log(`[pre-push] done in ${elapsed.toFixed(1)}s (budget ${BUDGET_SECONDS}s)`);
if (elapsed > BUDGET_SECONDS) {
  console.error(`[pre-push] exceeded ${BUDGET_SECONDS}s — narrow the checks, do not remove them`);
  process.exit(1);
}
