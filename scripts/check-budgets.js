#!/usr/bin/env node
/**
 * Gate: ensure canvas-appear + shell-preload budgets are enforced even when
 * frontend/dist is absent (CI never builds frontend before `npm test`).
 *
 * - If dist is missing → builds frontend (which already runs both budgets).
 * - If dist exists   → runs the two budget scripts directly (fast).
 *
 * Exit 0 = green, 1 = red. Keeps `npm test` from silently skipping budgets.
 */
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
  // build includes both budgets (see frontend/package.json build script)
  sh('npm run build:frontend');
  process.exit(0);
}

// Dist exists — run budgets directly
sh('node frontend/scripts/canvas-appear-budget.mjs');
sh('node frontend/scripts/shell-preload-budget.mjs');
