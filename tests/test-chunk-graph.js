const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { assert, finish } = require('./helpers/harness');

const ROOT = path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'frontend', 'scripts', 'lib', 'chunk-graph.mjs');

function eq(actual, expected, message) {
  assert(
    actual === expected,
    `${message} (esperado: ${JSON.stringify(expected)}, actual: ${JSON.stringify(actual)})`,
  );
}

function tmpDist(chunks, indexHtml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-chunkgraph-'));
  const jsDir = path.join(dir, 'assets', 'js');
  fs.mkdirSync(jsDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), indexHtml);
  for (const [name, code] of Object.entries(chunks)) {
    fs.writeFileSync(path.join(jsDir, name), code);
  }
  return { dir, jsDir };
}

async function main() {
  console.log('Chunk graph del shell\n');
  const { shellChunkNames, staticClosure, importChain } = await import(pathToFileURL(HELPER).href);

  console.log('\nSemillas declaradas en index.html:');
  const html = `<!doctype html><html><head>
<link rel="stylesheet" href="./assets/css/index-aaa.css">
<link rel="modulepreload" crossorigin href="./assets/js/vendor-react-1.js">
<link rel="preload" as="script" href="./assets/js/not-preloaded-9.js">
<script src="./theme-init.js"></script>
<script type="module" crossorigin src="./assets/js/index-2.js"></script>
</head><body><div id="root"></div></body></html>`;
  const seeds = shellChunkNames(html).sort();
  eq(seeds.join(','), 'index-2.js,vendor-react-1.js', 'toman el module script y el modulepreload');
  assert(!seeds.includes('not-preloaded-9.js'), 'un preload as="script" no es parte del shell');
  assert(!seeds.includes('theme-init.js'), 'un script clásico sin type=module no es del grafo ESM');
  assert(!seeds.some((s) => s.endsWith('.css')), 'las hojas de estilo no cuentan como JS');

  console.log('\nCierre de imports estáticos:');
  const fixture = tmpDist(
    {
      'index-2.js': `import{r}from"./vendor-react-1.js";import"./side-effect-3.js";export*from"./reexport-4.js";`,
      'vendor-react-1.js': 'const r=1;',
      'side-effect-3.js': 'import"./deep-5.js";',
      'reexport-4.js': 'export const x=1;',
      'deep-5.js': 'const lazy=()=>import("./dynamic-6.js");',
      'dynamic-6.js': 'export const late=1;',
      'orphan-7.js': 'export const o=1;',
    },
    html,
  );
  try {
    const closure = staticClosure({ jsDir: fixture.jsDir, seeds: ['index-2.js'] });
    const names = [...closure.keys()].sort();
    eq(names.join(','), 'deep-5.js,index-2.js,reexport-4.js,side-effect-3.js,vendor-react-1.js',
      'sigue import, export-from y side-effect en transitivo');
    assert(!closure.has('dynamic-6.js'), 'un import() dinámico NO es grafo estático del shell');
    assert(!closure.has('orphan-7.js'), 'un chunk sin referenciante no entra');
    eq(closure.get('index-2.js'), null, 'la semilla no tiene padre');
    eq(importChain(closure, 'deep-5.js').join(' → '),
      'index-2.js → side-effect-3.js → deep-5.js', 'la cadena reporta por qué se pagó el chunk');

    const missingSeed = staticClosure({ jsDir: fixture.jsDir, seeds: ['index-2.js', 'no-existe.js'] });
    eq(missingSeed.size, closure.size, 'una semilla inexistente se ignora sin romper');

    const selfLoop = tmpDist({ 'a.js': 'import"./b.js";', 'b.js': 'import"./a.js";' }, html);
    try {
      eq(staticClosure({ jsDir: selfLoop.jsDir, seeds: ['a.js'] }).size, 2,
        'un ciclo de imports no cuelga el recorrido');
    } finally {
      fs.rmSync(selfLoop.dir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
