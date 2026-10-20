const fs = require('fs');
const os = require('os');
const path = require('path');

const { assert, finish, counters } = require('./helpers/harness');
const {
  RecordingSessionManager,
  RecordingQuotaExceededError,
  RecordingSequenceError,
  DEFAULT_QUOTA_BYTES,
} = require('../electron/editor-recorder');

function run() {
  console.log('Testing editor recording sessions...\n');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-rec-'));
  const manager = new RecordingSessionManager({ directory: dir, quotaBytes: 1024 * 1024 });

  const session = manager.create('rec-1');
  session.append(0, Buffer.alloc(1024, 1));
  session.append(1, Buffer.alloc(2048, 2));
  const result = manager.finish('rec-1');
  assert(result.writtenBytes === 3072, `writtenBytes=${result.writtenBytes}`);
  assert(fs.existsSync(result.path), 'el archivo de grabación existe en disco');

  const content = fs.readFileSync(result.path);
  assert(content.length === 3072, 'el archivo tiene el tamaño acumulado');
  assert(content[0] === 1 && content[1024] === 2, 'los bloques se escribieron en orden');

  const s2 = manager.create('rec-2');
  let seqError = null;
  try {
    s2.append(5, Buffer.alloc(16));
  } catch (err) {
    seqError = err;
  }
  assert(seqError instanceof RecordingSequenceError, 'bloque fuera de orden rechazado');
  manager.abort('rec-2');

  const s3 = manager.create('rec-3');
  let quotaError = null;
  try {
    for (let i = 0; i < 2000; i += 1) {
      s3.append(i, Buffer.alloc(1024, 7));
    }
  } catch (err) {
    quotaError = err;
  }
  assert(quotaError instanceof RecordingQuotaExceededError, 'la cuota corta la grabación');
  manager.abort('rec-3');

  const s4 = manager.create('rec-4');
  s4.append(0, Buffer.alloc(4096));
  const aborted = manager.abort('rec-4');
  assert(aborted.aborted === true, 'abort devuelve estado');
  assert(!fs.existsSync(aborted.path || path.join(dir, 'rec-4.webm')), 'abort borra el archivo parcial');

  let missing = null;
  try {
    manager.get('no-existe');
  } catch (err) {
    missing = err;
  }
  assert(missing !== null, 'sesión desconocida rechazada');

  manager.create('rec-5');
  let dup = null;
  try {
    manager.create('rec-5');
  } catch (err) {
    dup = err;
  }
  assert(dup !== null, 'sesión duplicada rechazada');
  manager.abort('rec-5');

  const s6 = manager.create('rec-6');
  for (let i = 0; i < 500; i += 1) {
    s6.append(i, Buffer.alloc(512, i % 256));
  }
  assert(s6.writtenBytes === 500 * 512, 'contador de bytes acumulados');
  manager.finish('rec-6');

  let badId = null;
  try {
    new RecordingSessionManager({ directory: dir }).create('../../escape');
  } catch (err) {
    badId = err;
  }
  assert(badId !== null, 'sessionId con traversal rechazado');

  assert(DEFAULT_QUOTA_BYTES === 2 * 1024 * 1024 * 1024, 'cuota por defecto de 2 GB');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
  finish();
}

run();
