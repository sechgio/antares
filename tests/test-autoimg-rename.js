/**
 * Renombre NIS → SGIO_secuencia + carpeta DESTINO
 */

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

const {
  normalizeSgio,
  normalizeDestino,
  buildSgioFilename,
  buildNisMetaMap,
  buildRenameJobs,
  uniqueDestinos,
} = require('../electron/autoimg-rename');

assert(normalizeSgio('70942759') === '70942759', 'SGIO 8 dígitos');
assert(normalizeSgio(' 70942759 ') === '70942759', 'SGIO con espacios');
assert(normalizeSgio('SGIO:70942759') === '70942759', 'SGIO embebido');
assert(normalizeSgio('6553447') === null, '7 dígitos no es SGIO');
assert(normalizeSgio('') === null, 'vacío');

assert(normalizeDestino('  ZONA NORTE  ') === 'ZONA NORTE', 'DESTINO trim');
assert(normalizeDestino('A/B\\C') === 'A-B-C', 'DESTINO sin slash');
assert(normalizeDestino('') === null, 'DESTINO vacío');
assert(normalizeDestino('   ') === null, 'DESTINO solo espacios');

assert(buildSgioFilename('70942759', 1, '6553447_1.jpg') === '70942759_1.jpg', 'rename _1.jpg');
assert(buildSgioFilename('70942759', 2, '6553447-2.JPEG') === '70942759_2.jpeg', 'rename jpeg');
assert(buildSgioFilename('70942759', 3, '6553447-3C.png') === '70942759_3.png', 'rename png');

const meta = buildNisMetaMap([
  ['NIS', 'SGIO', 'DESTINO'],
  ['6553447', '70942759', 'SECTOR A'],
  ['1111111', '', 'SECTOR A'],
  ['2222222', '88888888', ''],
  ['3333333', '99999999', 'SECTOR B'],
]);
assert(meta.get('6553447').sgio === '70942759', 'meta SGIO');
assert(meta.get('6553447').destino === 'SECTOR A', 'meta DESTINO');
assert(meta.get('1111111').sgio === null, 'sin SGIO');
assert(meta.get('2222222').destino === null, 'sin DESTINO');
assert(meta.get('3333333').destino === 'SECTOR B', 'otro DESTINO');

const { jobs, skipped } = buildRenameJobs(
  [
    {
      nis: '6553447',
      count: 3,
      files: [
        { id: 'a', name: '6553447_1.jpg', slot: 1 },
        { id: 'b', name: '6553447-2.jpeg', slot: 2 },
        { id: 'c', name: '6553447-3C.png', slot: 3 },
      ],
    },
    {
      nis: '1111111',
      count: 3,
      files: [{ id: 'd', name: '1111111_1.jpg', slot: 1 }],
    },
    {
      nis: '2222222',
      count: 3,
      files: [
        { id: 'e1', name: '2222222_1.jpg', slot: 1 },
        { id: 'e2', name: '2222222_2.jpg', slot: 2 },
        { id: 'e3', name: '2222222_3.jpg', slot: 3 },
      ],
    },
    {
      nis: '3333333',
      count: 3,
      files: [
        { id: 'f1', name: '3333333_1.jpg', slot: 1 },
        { id: 'f2', name: '3333333_2.jpg', slot: 2 },
        { id: 'f3', name: '3333333_3.jpg', slot: 3 },
      ],
    },
  ],
  meta,
  { onlyCompletos: true },
);

assert(jobs.length === 6, '3+3 jobs con SGIO y DESTINO');
assert(jobs.every((j) => j.destino), 'cada job tiene destino');
assert(jobs.filter((j) => j.destino === 'SECTOR A').length === 3, 'SECTOR A');
assert(jobs.filter((j) => j.destino === 'SECTOR B').length === 3, 'SECTOR B');
assert(jobs[0].toName === '70942759_1.jpg', 'job 1 nombre');
assert(skipped.some((s) => s.nis === '1111111' && s.reason === 'sin_sgio'), 'skip sin SGIO');
assert(skipped.some((s) => s.nis === '2222222' && s.reason === 'sin_destino'), 'skip sin DESTINO');

const destinos = uniqueDestinos(jobs);
assert(destinos.join(',') === 'SECTOR A,SECTOR B', 'uniqueDestinos orden');

// Same SGIO name allowed in different DESTINO folders
const multi = buildRenameJobs(
  [
    {
      nis: '6553447',
      count: 1,
      files: [{ id: 'x', name: '6553447_1.jpg', slot: 1 }],
    },
    {
      nis: '3333333',
      count: 1,
      files: [{ id: 'y', name: '3333333_1.jpg', slot: 1 }],
    },
  ],
  new Map([
    ['6553447', { sgio: '11111111', destino: 'A' }],
    ['3333333', { sgio: '22222222', destino: 'B' }],
  ]),
  { onlyCompletos: false },
);
assert(multi.jobs.length === 2, 'dos destinos distintos');

// Slim scan stubs (id + name only, no modifiedTime) must still plan rename jobs.
const slimScanJobs = buildRenameJobs(
  [
    {
      nis: '6553447',
      count: 3,
      files: [
        { id: 'f1', name: '6553447_1.jpg' },
        { id: 'f2', name: '6553447_2.jpg' },
        { id: 'f3', name: '6553447_3.jpg' },
      ],
    },
  ],
  new Map([['6553447', { sgio: '70942759', destino: 'SECTOR A' }]]),
  { onlyCompletos: true },
);
assert(slimScanJobs.jobs.length === 3, 'slim files stubs producen 3 jobs');
assert(slimScanJobs.skipped.length === 0, 'slim files stubs no omiten NIS');

console.log('[PASS] autoimg-rename: SGIO + DESTINO + plan de jobs');
