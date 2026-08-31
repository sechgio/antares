/**
 * Feedback loop: app-shell modulepreload must stay free of heavy vendors.
 *
 * Symptom: AuthProvider / LoginScreen static imports pulled vendor-supabase
 * (~209 KB) and vendor-framer (~127 KB) into index.html modulepreload, so every
 * cold start paid for cloud-auth + motion before the local PreviewPanel painted.
 *
 * Usage (after `npm run build` / vite build in frontend/):
 *   node frontend/scripts/shell-preload-budget.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.resolve(__dirname, '../dist/index.html');

/** Must never appear in entry script or modulepreload hrefs. */
const BUDGETS_PATH = path.resolve(__dirname, '../../shared/budgets.json');
let FORBIDDEN_SHELL = ['vendor-supabase', 'vendor-framer', 'vendor-jspdf', 'vendor-pdfjs', 'vendor-fullcalendar'];
try {
  const _b = JSON.parse(fs.readFileSync(BUDGETS_PATH, 'utf8'));
  if (Array.isArray(_b?.shellPreload?.forbiddenShell)) FORBIDDEN_SHELL = _b.shellPreload.forbiddenShell;
} catch {}

function fail(msg) {
  console.error(`RED: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
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
