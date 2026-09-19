import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellChunkNames, staticClosure, importChain } from './lib/chunk-graph.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const jsDir = path.join(distDir, 'assets/js');
const indexHtmlPath = path.join(distDir, 'index.html');

const BUDGETS_PATH = path.resolve(__dirname, '../../shared/budgets.json');
const budgets = JSON.parse(fs.readFileSync(BUDGETS_PATH, 'utf8'));
const FORBIDDEN_SHELL = budgets.shellPreload?.forbiddenShell;

function fail(msg) {
  console.error(`RED: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

if (!Array.isArray(FORBIDDEN_SHELL)) {
  fail(`missing shellPreload.forbiddenShell in ${BUDGETS_PATH}`);
}

if (!fs.existsSync(indexHtmlPath)) {
  fail(`missing ${indexHtmlPath} — run frontend build first`);
}

const html = fs.readFileSync(indexHtmlPath, 'utf8');
const seeds = shellChunkNames(html);
if (!seeds.length) {
  fail(`index.html declares no module script or modulepreload chunk — the shell graph is unreadable`);
}

const closure = staticClosure({ jsDir, seeds });
const shellJs = [...closure.keys()];

console.log(`shell entry/preloads: ${seeds.sort().join(', ')}`);
console.log(`static closure: ${shellJs.length} chunks — ${shellJs.sort().join(', ')}`);

const hit = shellJs.find((rel) => FORBIDDEN_SHELL.some((needle) => rel.includes(needle)));
if (hit) {
  const chain = importChain(closure, hit).join(' → ');
  const hop = closure.get(hit) ? `reached statically through ${chain}` : 'declared by index.html itself';
  fail(
    `shell loads "${hit}" (${hop}) — cold start must not pay for this vendor (lazy-load Auth/Login/features instead)`,
  );
}

ok(`shell preload clean (${shellJs.length} chunks in the static graph); no forbidden heavy vendors`);
process.exit(0);
