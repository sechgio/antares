#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FORMAT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.css']);
const EXCLUDED =
  /^(bun\.lock|frontend\/bun\.lock|dist\/|dist-electron\/|frontend\/dist\/|node_modules\/|frontend\/node_modules\/|\.venv\/|scratch\/)/;

function resolveBun() {
  if (process.env.BUN_BIN) return process.env.BUN_BIN;
  const homeBun = path.join(os.homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
  if (fs.existsSync(homeBun)) return homeBun;
  return process.platform === 'win32' ? 'bun.exe' : 'bun';
}

function resolveChangedFiles(baseRef) {
  const candidates = baseRef
    ? [baseRef]
    : [process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null, 'origin/main', 'HEAD~1'].filter(
        Boolean,
      );

  for (const ref of candidates) {
    try {
      const mergeBase = execFileSync('git', ['merge-base', ref, 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const committed = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', `${mergeBase}...HEAD`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const working = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return [
        ...new Set(
          `${committed}\n${working}`
            .split(/\r?\n/)
            .map((f) => f.trim())
            .filter(Boolean),
        ),
      ];
    } catch {
      continue;
    }
  }
  return [];
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const baseIdx = argv.indexOf('--base');
  const baseRef = baseIdx !== -1 ? argv[baseIdx + 1] : null;
  const explicitFiles = argv.filter((arg, idx) => !arg.startsWith('--') && (baseIdx === -1 || idx !== baseIdx + 1));

  const rawFiles = explicitFiles.length > 0 ? explicitFiles : resolveChangedFiles(baseRef);
  const files = rawFiles
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => FORMAT_EXT.has(path.extname(f)) && !EXCLUDED.test(f) && fs.existsSync(path.join(ROOT, f)));

  if (files.length === 0) {
    console.log('oxfmt: no new format-eligible files to check.');
    return;
  }

  const args = ['x', 'oxfmt', '-c', '.oxfmtrc.json', ...(write ? [] : ['--check']), ...files];
  const result = spawnSync(resolveBun(), args, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  if (result.error) {
    console.error(`oxfmt failed to start: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
