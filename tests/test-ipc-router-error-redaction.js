'use strict';

const { assert, finish, counters } = require('./helpers/harness');
const { loadIpcRouter } = require('./helpers/ipc-router');

// ipc-bridge-024: los mensajes de error que cruzan al renderer pierden las
// rutas absolutas locales; el resto del contrato (prefijo + JSON) se mantiene.
const router = loadIpcRouter();

const err = router._toRendererIpcError(
  new Error("ENOENT: lstat 'C:\\Users\\pepe\\secreto.docx' y /home/pepe/notas.txt"),
);
assert(err.message.startsWith('ANTARES_IPC_ERROR:'), 'el error mantiene el prefijo de contrato');
const payload = JSON.parse(err.message.slice('ANTARES_IPC_ERROR:'.length));
assert(
  !payload.message.includes('secreto.docx') && payload.message.includes('[ruta interna]'),
  'las rutas absolutas de Windows se redactan en el error hacia el renderer',
);
assert(
  !payload.message.includes('/home/pepe/notas.txt'),
  'las rutas absolutas POSIX se redactan en el error hacia el renderer',
);

const clean = router._toRendererIpcError(
  new Error('La ruta de salida no está permitida. Usa el diálogo de guardado.'),
);
const cleanPayload = JSON.parse(clean.message.slice('ANTARES_IPC_ERROR:'.length));
assert(
  cleanPayload.message === 'La ruta de salida no está permitida. Usa el diálogo de guardado.',
  'los mensajes sin rutas cruzan intactos',
);

console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
finish();
