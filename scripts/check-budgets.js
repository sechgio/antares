#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const distJsDir = path.join(ROOT, 'frontend', 'dist', 'assets', 'js');

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execFileSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    ...opts,
  });
}

if (!fs.existsSync(distJsDir)) {
  console.log(`frontend/dist missing at ${distJsDir} — building frontend to verify budgets...`);
  sh('npm run build:frontend');
  process.exit(0);
}

sh('node frontend/scripts/canvas-appear-budget.mjs');
sh('node frontend/scripts/shell-preload-budget.mjs');
