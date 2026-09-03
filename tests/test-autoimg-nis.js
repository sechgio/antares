
function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

const {
  extractNis,
  extractSlot,
  buildNisMap,
  mergeNisMaps,
  computeEstado,
} = require('../electron/autoimg-nis');

assert(extractNis('6553447_1.jpg') === '6553447', '6553447_1.jpg');
assert(extractNis('6553447_2.jpeg') === '6553447', '6553447_2.jpeg');
assert(extractNis('6553447_3.JPG') === '6553447', '6553447_3.JPG');
assert(extractNis('6553447_1.png') === '6553447', '6553447_1.png');

assert(extractNis('6553447-1.jpg') === '6553447', '6553447-1.jpg');
assert(extractNis('6553447-2.jpeg') === '6553447', '6553447-2.jpeg');
assert(extractNis('6553447-3') === '6553447', '6553447-3 sin extensión');

assert(extractNis('6553447-1A.jpg') === '6553447', '6553447-1A.jpg');
assert(extractNis('6553447-2B.jpeg') === '6553447', '6553447-2B.jpeg');
assert(extractNis('6553447-3C.png') === '6553447', '6553447-3C.png');
assert(extractNis('6553447_1A.jpg') === '6553447', '6553447_1A.jpg');

assert(extractNis('6553447.jpg') === '6553447', '6553447.jpg');

assert(extractNis('655344.jpg') === null, '6 dígitos no es NIS');
assert(extractNis('65534471.jpg') === null, '8 dígitos no es NIS');
assert(extractNis('foto.jpg') === null, 'sin dígitos');
assert(extractNis('') === null, 'vacío');

assert(extractSlot('6553447_1.jpg') === 1, 'slot _1');
assert(extractSlot('6553447-2.jpeg') === 2, 'slot -2');
assert(extractSlot('6553447-3C.png') === 3, 'slot -3C');
assert(extractSlot('6553447_1A.jpg') === 1, 'slot _1A');
assert(extractSlot('6553447.jpg') === null, 'sin slot');

const map = buildNisMap(
  [
    { id: 'a', name: '6553447_1.jpg' },
    { id: 'b', name: '6553447-2.jpeg' },
    { id: 'c', name: '6553447-3C.png' },
    { id: 'd', name: 'noise.txt' },
    { id: 'e', name: '9999999_1.jpg' },
  ],
  'Carpeta A',
);

assert(map['6553447']?.count === 3, 'cuenta 3 imágenes del mismo NIS con formatos mixtos');
assert(map['6553447']?.estado === undefined, 'estado se calcula fuera del map');
assert(computeEstado(map['6553447'].count) === '🟢 COMPLETO', '3 archivos = COMPLETO');
assert(map['6553447'].folders.includes('Carpeta A'), 'registra carpeta');
assert(map['9999999']?.count === 1, 'otro NIS separado');
assert(!map['noise'], 'ignora nombres sin NIS');

const {
  accumulateNisFiles,
  finalizeNisMap,
} = require('../electron/autoimg-nis');
const acc = {};
accumulateNisFiles(acc, [
  { id: 'a', name: '6553447_1.jpg' },
  { id: 'b', name: '6553447-2.jpeg' },
], 'Carpeta A');
accumulateNisFiles(acc, [
  { id: 'c', name: '6553447-3C.png' },
], 'Carpeta A');
finalizeNisMap(acc);
assert(acc['6553447'].count === 3, 'accumulate across pages');
assert(acc['6553447'].slots.join(',') === '1,2,3', 'slots finalized sorted');

const m1 = buildNisMap([{ id: '1', name: '1111111_1.jpg' }, { id: '2', name: '1111111_2.jpg' }], 'A');
const m2 = buildNisMap([{ id: '3', name: '1111111_1.jpg' }, { id: '4', name: '1111111_3.jpg' }], 'B');
const sum = mergeNisMaps([m1, m2], 'SUM');
const max = mergeNisMaps([m1, m2], 'MAX');
assert(sum['1111111'].count === 4, 'SUM suma conteos');
assert(max['1111111'].count === 2, 'MAX toma el mayor por carpeta');

console.log('[PASS] autoimg-nis: underscore/hyphen/letter patterns + map');
