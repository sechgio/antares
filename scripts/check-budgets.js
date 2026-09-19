#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'frontend', 'dist', 'index.html');
const SOURCE_ROOTS = [path.join(ROOT, 'frontend'), path.join(ROOT, 'shared')];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'coverage', '.vite']);

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execFileSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    ...opts,
  });
}

function newestMtimeMs(dir) {
  let newest = 0;
  const stack = [dir];
  while (stack.length) {
    let entries;
    const current = stack.pop();
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {}
    }
  }
  return newest;
}

// Los budgets se miden sobre el bundle, así que un dist viejo aprobaría el check con
// artefactos que ya no corresponden al código: se reconstruye antes de medir.
function distMatchesSources() {
  if (!fs.existsSync(INDEX_HTML)) return false;
  const builtAt = fs.statSync(INDEX_HTML).mtimeMs;
  return SOURCE_ROOTS.every((src) => newestMtimeMs(src) <= builtAt);
}

if (!distMatchesSources()) {
  console.log('frontend/dist está ausente o más viejo que sus fuentes — construyendo para medir...');
  sh('npm run build:frontend');
}

sh('node frontend/scripts/canvas-appear-budget.mjs');
sh('node frontend/scripts/shell-preload-budget.mjs');
