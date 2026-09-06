const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ratchet = require(path.join(ROOT, 'scripts', 'quality-ratchet.js'));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function eq(actual, expected, message) {
  assert(
    actual === expected,
    `${message} (esperado: ${JSON.stringify(expected)}, actual: ${JSON.stringify(actual)})`,
  );
}

const tmpDirs = [];

function tmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-ratchet-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testArtifacts() {
  console.log('\nArtefactos:');
  const baselinePath = path.join(ROOT, '.quality-baseline.json');
  assert(fs.existsSync(baselinePath), '.quality-baseline.json existe');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  assert(!!baseline.metrics, 'el baseline tiene métricas');
  eq(baseline.metrics.typeIgnore.direction, 'max', 'typeIgnore se trinqua como techo');
  assert(Number.isFinite(baseline.metrics.typeIgnore.value), 'typeIgnore tiene valor numérico');
}

function testCounters() {
  console.log('\nContadores:');

  const dir = tmpProject({
    'backend/core/a.py': 'x = 1  # type: ignore\n' + 'y = 2  # type: ignore\n' + 'z = 3\n',
    'tests/test_b.py': 'w = 4  # type: ignore\n',
    'frontend/src/a.ts': 'const a: any = 1;\nconst b = c as any;\nconst d: number = 2;\n',
    'frontend/src/b.tsx': 'function f<T = any>() {}\n',
  });

  const files = ratchet.collectSourceFiles(dir);
  eq(ratchet.countTypeIgnore(files), 2, 'sólo cuenta type: ignore de backend/, no de tests/');
  eq(ratchet.countAny(files), 3, 'cuenta anotaciones, casts y genéricos any');

  const big = tmpProject({ 'backend/core/big.py': 'l\n'.repeat(600), 'backend/core/small.py': 'l\n'.repeat(10) });
  eq(ratchet.countLargeFiles(ratchet.collectSourceFiles(big)), 1, 'cuenta archivos > 500 líneas');

  const measured = ratchet.measure(dir);
  eq(measured.typeIgnore, 2, 'measure() reporta typeIgnore');
  eq(measured.anyInFrontend, 3, 'measure() reporta anyInFrontend');
  eq(Object.keys(measured).length, 3, 'measure() sólo expone métricas fiables');

  const empty = tmpProject({ 'backend/core/a.py': 'x = 1\n' });
  eq(ratchet.countTypeIgnore(ratchet.collectSourceFiles(empty)), 0, 'sin ocurrencias cuenta 0');
  eq(
    ratchet.countTypeIgnore(ratchet.collectSourceFiles(path.join(os.tmpdir(), 'no-existe-' + Date.now()))),
    0,
    'un directorio inexistente no rompe, cuenta 0',
  );
}

function testCompare() {
  console.log('\nComparación contra el techo:');
  const base = (value) => ({ metrics: { typeIgnore: { value, direction: 'max' } } });
  const metric = ratchet.METRICS.find((m) => m.id === 'typeIgnore');

  eq(ratchet.compare(metric, 27, null), 'nodata', 'sin baseline no se juzga');
  eq(ratchet.compare(metric, 27, { metrics: { typeIgnore: { value: null } } }), 'nodata', 'techo nulo no se juzga');
  eq(ratchet.compare(metric, 27, base(27)), 'ok', 'igual se mantiene');
  eq(ratchet.compare(metric, 25, base(27)), 'improved', 'bajar es una mejora');
  eq(ratchet.compare(metric, 30, base(27)), 'regression', 'subir bloquea');

  const rows = ratchet.evaluate({ typeIgnore: 30, anyInFrontend: 1, largeFiles: 1 }, {
    metrics: { typeIgnore: { value: 27 }, anyInFrontend: { value: 1 }, largeFiles: { value: 1 } },
  });
  eq(rows.filter((r) => r.status === 'regression').length, 1, 'evaluate() marca una sola regresión');
  eq(rows.filter((r) => r.status === 'ok').length, 2, 'las métricas estables quedan en ok');
  eq(
    ratchet.evaluate({ typeIgnore: 1 }, null).filter((r) => r.status === 'nodata').length,
    3,
    'sin baseline ninguna métrica se juzga',
  );
}

function testNextBaseline() {
  console.log('\nActualización de techos:');
  const previous = { updatedAt: '2026-01-01', metrics: { typeIgnore: { value: 27, direction: 'max' } } };

  const lower = ratchet.nextBaseline({ typeIgnore: 20 }, previous);
  eq(lower.baseline.metrics.typeIgnore.value, 20, 'bajar el techo se permite siempre');
  eq(lower.blocked.length, 0, 'bajar no genera bloqueos');

  const raise = ratchet.nextBaseline({ typeIgnore: 30 }, previous);
  eq(raise.baseline.metrics.typeIgnore.value, 27, 'subir el techo se rechaza sin --force');
  eq(raise.blocked.length, 1, 'subir queda registrado como bloqueado');
  eq(raise.blocked[0].from, 27, 'el bloqueo informa el techo anterior');

  const forced = ratchet.nextBaseline({ typeIgnore: 30 }, previous, { force: true });
  eq(forced.baseline.metrics.typeIgnore.value, 30, 'con --force sí se puede subir');
  eq(forced.blocked.length, 0, 'con --force no hay bloqueos');

  const fresh = ratchet.nextBaseline({ typeIgnore: 5 }, null);
  eq(fresh.baseline.metrics.typeIgnore.value, 5, 'sin baseline previo se crea con el valor actual');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(fresh.baseline.updatedAt), 'el baseline guarda fecha ISO');
}

function testReport() {
  console.log('\nInforme:');
  const rows = ratchet.evaluate({ typeIgnore: 27, anyInFrontend: 30, largeFiles: 16 }, {
    metrics: {
      typeIgnore: { value: 27 },
      anyInFrontend: { value: 30 },
      largeFiles: { value: 16 },
    },
  });
  const report = ratchet.renderReport(rows);
  assert(report.includes('Trinquete de calidad'), 'el informe tiene título');
  assert(report.includes('type: ignore'), 'el informe nombra la métrica');
  assert(!report.includes('sin baseline'), 'con baseline no pide actualizar');

  const empty = ratchet.renderReport(rows, { baselineMissing: true });
  assert(empty.includes('quality-ratchet.js --update'), 'sin baseline explica cómo crearlo');
}

function run() {
  console.log('Quality ratchet\n');

  try {
    testArtifacts();
    testCounters();
    testCompare();
    testNextBaseline();
    testReport();
  } finally {
    cleanup();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run();
