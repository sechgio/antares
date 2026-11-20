#!/usr/bin/env node
// Runs a command and fails the step when it exceeds a hard wall-clock budget.
// Usage: node scripts/with-budget.js <seconds> -- <command> [args...]

const { spawnSync } = require('node:child_process');

const [budgetArg, sep, ...cmd] = process.argv.slice(2);
const budget = Number(budgetArg);
if (!Number.isFinite(budget) || budget <= 0 || sep !== '--' || cmd.length === 0) {
  console.error('usage: node scripts/with-budget.js <seconds> -- <command> [args...]');
  process.exit(2);
}

const started = Date.now();
const result = spawnSync(cmd[0], cmd.slice(1), {
  stdio: 'inherit',
  shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(cmd[0]),
});
const elapsed = (Date.now() - started) / 1000;

console.log(`\n[budget] ${cmd.join(' ')} took ${elapsed.toFixed(1)}s (budget ${budgetArg}s)`);

if (result.error) {
  console.error(`[budget] failed to start: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
if (elapsed > budget) {
  console.error(`[budget] exceeded: ${elapsed.toFixed(1)}s > ${budgetArg}s — investigate before raising the limit`);
  process.exit(1);
}
