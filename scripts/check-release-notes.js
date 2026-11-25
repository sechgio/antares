#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { validateFragmentText, fragmentFileNames } = require('./lib/changelog-fragments');

const ROOT = path.resolve(__dirname, '..');
const FRAGMENTS_DIR = path.join(ROOT, 'changelog.d');

function gitText(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function stagedFragments() {
  const names = gitText(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--', 'changelog.d/'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.md'));
  return names.map((name) => ({ name: path.basename(name), text: gitText(['show', `:${name}`]) }));
}

function worktreeFragments() {
  return fragmentFileNames(FRAGMENTS_DIR).map((name) => ({
    name,
    text: fs.readFileSync(path.join(FRAGMENTS_DIR, name), 'utf8'),
  }));
}

function main() {
  const staged = process.argv.slice(2).includes('--staged');
  const entries = staged ? stagedFragments() : worktreeFragments();

  if (entries.length === 0) {
    if (!staged) console.log('check-release-notes: no hay fragmentos en changelog.d/ (nada que validar).');
    return;
  }

  if (staged) console.log('Validando fragmentos de release notes staged...');
  let failures = 0;
  for (const entry of entries) {
    const errors = validateFragmentText(entry.text);
    if (errors.length === 0) {
      console.log(`  ✓ ${entry.name}`);
    } else {
      failures += 1;
      console.error(`  ✗ ${entry.name}:`);
      for (const error of errors) console.error(`    - ${error}`);
    }
  }
  if (failures > 0) {
    console.error(`\n✗ ${failures} fragmento(s) con errores de formato.`);
    console.error('  Formato: secciones "### Added|Changed|Deprecated|Removed|Fixed|Security" con items "- …".');
    process.exit(1);
  }
  if (!staged) console.log(`\ncheck-release-notes: ${entries.length} fragmento(s) válidos.`);
}

main();
