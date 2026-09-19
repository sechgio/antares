// Tailwind 3 no puede aplicar un modificador de alfa a un valor arbitrario que sea
// `var(--token)`: la utilidad no se genera y la clase queda muerta en silencio (no
// hay error ni aviso en el build). Lo mismo pasa con `shadow-[... var(--x)/NN ...]`,
// que emite una declaration CSS inválida. Este guard fallar si vuelve a aparecer
// alguna de las dos formas en el fuente de la UI.
//
// Formas correctas:
//   - color de la paleta del tema: `bg-mc-ink/50` (tailwind.config.js resuelve el
//     alfa con color-mix).
//   - token CSS arbitrario: `bg-[color:color-mix(in_srgb,var(--x)_50%,transparent)]`.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const EXTRA = [path.join(ROOT, 'frontend', 'index.html')];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.html']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

const DEAD_ALPHA_RE =
  /[a-zA-Z0-9:_-]*-\[[^\]{}]*var\(--[^\)]*\)[^\]{}]*\][/]([0-9]{1,3}|[[][0-9a-fA-F]+[]])/g;
const INVALID_SHADOW_RE = /shadow-\[[^\]{}]*var\(--[^\)]*\)[/][0-9]+[^\]{}]*\]/g;

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* sourceFiles(path.join(dir, entry.name));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

function scan(file, re, label) {
  const text = fs.readFileSync(file, 'utf8');
  const hits = [];
  for (const match of text.matchAll(re)) {
    const line = text.slice(0, match.index).split('\n').length;
    hits.push(`${path.relative(ROOT, file).split(path.sep).join('/')}:${line}  ${label}: ${match[0]}`);
  }
  return hits;
}

const findings = [];
for (const file of [...sourceFiles(SRC), ...EXTRA.filter((f) => fs.existsSync(f))]) {
  findings.push(...scan(file, DEAD_ALPHA_RE, 'alfa sobre var() (no genera regla)'));
  findings.push(...scan(file, INVALID_SHADOW_RE, 'sombra con var()/NN (CSS inválido)'));
}

if (findings.length) {
  console.error(`[FAIL] ${findings.length} utilidad(es) de Tailwind con alfa sobre var() no compilable(s):`);
  for (const f of findings) console.error(`  ${f}`);
  console.error('\n  Reemplazar por bg-[color:color-mix(in_srgb,var(--token)_NN%,transparent)]');
  console.error('  o por un color de la paleta del tema (bg-mc-*, bg-dark-*, text-txt-*, ...).');
  process.exit(1);
}

console.log('[PASS] Ninguna utilidad Tailwind aplica alfa sobre un var() sin compilar');
