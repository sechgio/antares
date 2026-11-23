#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const AREAS = ['typecheck', 'build', 'contracts', 'electron', 'frontend', 'backend'];

const EVERYTHING = [...AREAS];
const DOCS = [];

const RULES = [
  { re: /^(?:\.github|scripts|shared|electron)\//, areas: EVERYTHING },
  {
    re: /^(?:package\.json|bun\.lock|\.gitattributes|\.node-version|\.oxlintrc\.json|\.oxfmtrc\.json|.*\.config\.(?:js|ts|mjs|cjs)|tsconfig[^/]*\.json)$/,
    areas: EVERYTHING,
  },
  { re: /^frontend\//, areas: ['typecheck', 'build', 'frontend', 'contracts', 'electron'] },
  { re: /^backend\//, areas: ['typecheck', 'backend', 'electron', 'contracts'] },
  { re: /^(?:pyproject\.toml|uv\.lock)$/, areas: ['typecheck', 'backend', 'electron', 'contracts'] },
  { re: /^media\//, areas: ['backend', 'electron'] },
  { re: /^tests\/[^/]*\.py$/, areas: ['backend', 'electron'] },
  { re: /^tests\/.*\.py$/, areas: ['backend', 'electron'] },
  { re: /^tests\/.*\.(?:js|mjs|cjs|ts)$/, areas: ['contracts', 'electron'] },
  { re: /^tests\//, areas: ['backend', 'electron'] },
  { re: /^(?:docs\/|[^/]*\.md$|LICENSE[^/]*|\.gitignore$|\.editorconfig$)/, areas: DOCS },
];

function classify(changedPaths) {
  const selected = new Set();
  for (const file of changedPaths) {
    const rule = RULES.find((entry) => entry.re.test(file));
    const areas = rule ? rule.areas : EVERYTHING;
    for (const area of areas) selected.add(area);
  }
  return Object.fromEntries(AREAS.map((area) => [area, selected.has(area)]));
}

function changedFiles(baseRef) {
  const mergeBase = execFileSync('git', ['merge-base', baseRef, 'HEAD'], { encoding: 'utf8' }).trim();
  return execFileSync('git', ['diff', '--name-only', '--no-renames', `${mergeBase}...HEAD`], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  const baseRef = process.argv[2] || process.env.GITHUB_BASE_REF;
  const selectionEvent = process.argv[3] || process.env.GITHUB_EVENT_NAME || 'pull_request';
  const select = selectionEvent === 'pull_request' && baseRef;
  const files = select ? changedFiles(baseRef.startsWith('origin/') ? baseRef : `origin/${baseRef}`) : [];
  const outputs = select ? classify(files) : Object.fromEntries(AREAS.map((area) => [area, true]));

  const lines = Object.entries(outputs).map(([area, on]) => `${area}=${on}`);
  console.log(`selection=${select ? 'affected' : 'full'} files=${files.length}`);
  if (files.length > 0) console.log(files.map((file) => `  ${file}`).join('\n'));
  console.log(lines.join('\n'));

  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

if (require.main === module) main();

module.exports = { classify, AREAS };
