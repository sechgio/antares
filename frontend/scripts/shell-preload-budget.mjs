import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.resolve(__dirname, '../dist/index.html');

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
const shellJs = [...html.matchAll(/assets\/js\/([^"']+\.js)/g)].map((m) => m[1]);

console.log(`shell JS: ${shellJs.join(', ') || '(none)'}`);

const hit = shellJs.find((rel) => FORBIDDEN_SHELL.some((needle) => rel.includes(needle)));
if (hit) {
  fail(
    `shell preloads "${hit}" — cold start must not pay for this vendor (lazy-load Auth/Login/features instead)`,
  );
}

ok(`shell preload clean (${shellJs.length} JS assets); no forbidden heavy vendors`);
process.exit(0);
