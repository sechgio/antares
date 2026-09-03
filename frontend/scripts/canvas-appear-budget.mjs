import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const jsDir = path.join(distDir, 'assets/js');
const indexHtmlPath = path.join(distDir, 'index.html');

const BUDGETS_PATH = path.resolve(__dirname, '../../shared/budgets.json');
let FORBIDDEN_STATIC = [
  'vendor-jspdf',
  'vendor-dnd',
  'vendor-pdfjs',
  'vendor-data',
  'vendor-fullcalendar',
  'vendor-supabase',
];
let INCREMENTAL_BUDGET_KB = 500;
try {
  const _b = JSON.parse(fs.readFileSync(BUDGETS_PATH, 'utf8'));
  if (Array.isArray(_b?.canvasAppear?.forbiddenStatic)) FORBIDDEN_STATIC = _b.canvasAppear.forbiddenStatic;
  if (typeof _b?.canvasAppear?.incrementalBudgetKb === 'number') INCREMENTAL_BUDGET_KB = _b.canvasAppear.incrementalBudgetKb;
} catch {}

function fail(msg) {
  console.error(`RED: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

function kb(bytes) {
  return Math.round((bytes / 1024) * 10) / 10;
}

if (!fs.existsSync(jsDir)) {
  fail(`missing production build at ${jsDir} — run npm run build:frontend first`);
}

const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
const canvasChunk = files.find((f) => {
  const text = fs.readFileSync(path.join(jsDir, f), 'utf8');
  return text.includes('Cargando Canvas');
});

if (!canvasChunk) {
  fail('no dist chunk contains "Cargando Canvas" — rebuild frontend');
}

const canvasPath = path.join(jsDir, canvasChunk);
const canvasText = fs.readFileSync(canvasPath, 'utf8');
const canvasKb = kb(fs.statSync(canvasPath).size);

const staticFrom = [...canvasText.matchAll(/from\s*["']\.\/([^"']+)["']/g)].map((m) => m[1]);
const uniqueStatic = [...new Set(staticFrom)];

const alreadyLoaded = new Set();
if (fs.existsSync(indexHtmlPath)) {
  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  for (const m of html.matchAll(/assets\/js\/([^"']+\.js)/g)) {
    alreadyLoaded.add(m[1]);
  }
}

console.log(`canvas chunk: ${canvasChunk} (${canvasKb} KB)`);
console.log(`shell already loaded: ${[...alreadyLoaded].sort().join(', ') || '(none)'}`);
console.log('static imports:');

let criticalKb = 0;
let incrementalKb = 0;
for (const rel of uniqueStatic) {
  const p = path.join(jsDir, rel);
  const sizeKb = fs.existsSync(p) ? kb(fs.statSync(p).size) : null;
  const preloaded = alreadyLoaded.has(rel);
  console.log(
    `  - ${rel}${sizeKb != null ? ` (${sizeKb} KB)` : ' (missing)'}${preloaded ? ' [shell]' : ''}`,
  );
  if (sizeKb != null) {
    criticalKb += sizeKb;
    if (!preloaded) incrementalKb += sizeKb;
  }
}

if (!alreadyLoaded.has(canvasChunk)) {
  incrementalKb += canvasKb;
}
criticalKb += canvasKb;

console.log(`critical-path total: ${Math.round(criticalKb * 10) / 10} KB`);
console.log(
  `incremental (beyond shell): ${Math.round(incrementalKb * 10) / 10} KB (budget ${INCREMENTAL_BUDGET_KB} KB)`,
);

const forbiddenHit = uniqueStatic.find((rel) =>
  FORBIDDEN_STATIC.some((needle) => rel.includes(needle)),
);
if (forbiddenHit) {
  fail(
    `Canvas chunk statically imports "${forbiddenHit}" — packaged open pays for that vendor before the editor can mount`,
  );
}

if (incrementalKb > INCREMENTAL_BUDGET_KB) {
  fail(
    `incremental Canvas open ${Math.round(incrementalKb)} KB exceeds ${INCREMENTAL_BUDGET_KB} KB budget`,
  );
}

ok(
  `Canvas incremental ${Math.round(incrementalKb * 10) / 10} KB within budget; no forbidden static vendors`,
);
process.exit(0);
