'use strict';

const { assert, finish, counters } = require('./helpers/harness');
const { loadIpcRouter } = require('./helpers/ipc-router');

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

const structured = router._toRendererIpcError(Object.assign(new Error('Recuperación'), {
  details: { retryable: true, recovery: [{ path: 'C:/private/recovery.json' }, '\\\\host\\share\\recovery.json'] },
}));
const { details } = JSON.parse(structured.message.slice('ANTARES_IPC_ERROR:'.length));
assert(details.retryable === true, 'structured flags are preserved');
assert(details.recovery[0].path === '[ruta interna]' && details.recovery[1] === '[ruta interna]',
  'nested error details redact drive and UNC paths');

console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
finish();
