const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createAsyncLogWriter } = require('../electron/async-log-writer');

process.env.LOCALAPPDATA = path.join(os.tmpdir(), 'alog-fix-test');
fs.rmSync(process.env.LOCALAPPDATA, { recursive: true, force: true });
const l = require('../electron/app-log.js');

const tmp = os.tmpdir();
const OLD = Date.now() - 2 * 24 * 60 * 60 * 1000;
const FRESH = Date.now() - 60 * 1000;

function makeDir(name, contentMtime) {
  const p = path.join(tmp, name);
  fs.rmSync(p, { recursive: true, force: true });
  fs.mkdirSync(p, { recursive: true });
  const f = path.join(p, 'payload.tmp');
  fs.writeFileSync(f, 'x');
  if (contentMtime) fs.utimesSync(f, contentMtime / 1000, contentMtime / 1000);
  fs.utimesSync(p, OLD / 1000, OLD / 1000);
  return p;
}

async function main() {

makeDir('antares-staged-99999999', OLD);
makeDir(`antares-staged-${process.pid}`, OLD);
makeDir('antares-staged-88888888', FRESH);
makeDir('antares-pdf-x1y2z3', OLD);
makeDir('antares-backend-command-abc', OLD);

const removed = l.cleanStaleTempDirs();
console.log('removed:', removed);

assert(fs.existsSync(path.join(tmp, 'antares-staged-99999999')) === false, 'A: staging muerto debe borrarse');
assert(fs.existsSync(path.join(tmp, `antares-staged-${process.pid}`)) === true, 'B: staging de pid vivo NO debe borrarse');
assert(fs.existsSync(path.join(tmp, 'antares-staged-88888888')) === true, 'C: staging con contenido reciente NO debe borrarse');
assert(fs.existsSync(path.join(tmp, 'antares-pdf-x1y2z3')) === false, 'D: pdf viejo debe borrarse');
assert(fs.existsSync(path.join(tmp, 'antares-backend-command-abc')) === false, 'E: backend-command viejo debe borrarse');
console.log('cleanStaleTempDirs: 5/5 escenarios OK');

const dir = l.initAppLogs();
const redactedJson = l.redactText('{"access_token":"secret-token","cookie":"secret-cookie"}');
assert(!redactedJson.includes('secret-token') && !redactedJson.includes('secret-cookie'));
const redactedCookieHeader = l.redactText('Cookie: sessionid=secret-one; csrf=secret-two');
assert(!redactedCookieHeader.includes('secret-one') && !redactedCookieHeader.includes('secret-two'));
const redactedCookieValue = l.redactText('cookie=sessionid=secret-one; csrf=secret-two');
assert(!redactedCookieValue.includes('secret-one') && !redactedCookieValue.includes('secret-two'));
console.log('redacción de secretos en JSON y cookies: OK');

let syncAppendCalls = 0;
const originalAppendFileSync = fs.appendFileSync;
fs.appendFileSync = (...args) => {
  syncAppendCalls += 1;
  return originalAppendFileSync(...args);
};
l.appendLogLine('INFO', 'linea normal con\nsalto de linea inyectado');
await l.flushLogQueue();
fs.appendFileSync = originalAppendFileSync;
assert.strictEqual(syncAppendCalls, 0, 'logging frecuente no debe usar appendFileSync');
const d = new Date();
const yyyy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, '0');
const dd = String(d.getDate()).padStart(2, '0');
const logFile = path.join(dir, `antares-${yyyy}-${mm}-${dd}.log`);
const content = fs.readFileSync(logFile, 'utf8');
assert(content.includes('linea normal con salto de linea inyectado'), 'CRLF sanitizado');
assert(!content.includes('\n[') || content.split('\n').length === 2, 'una sola linea');
console.log('appendLogLine + sanitización CRLF: OK');

try {
  fs.unlinkSync(logFile);
  fs.symlinkSync(path.join(dir, 'victima.txt'), logFile, 'file');
  l.appendLogLine('INFO', 'tras symlink');
  await l.flushLogQueue();
  const st = fs.lstatSync(logFile);
  assert(!st.isSymbolicLink(), 'el symlink debe haberse eliminado');
  const c2 = fs.readFileSync(logFile, 'utf8');
  assert(c2.includes('tras symlink'), 'log escrito en archivo plano');
  assert(!fs.existsSync(path.join(dir, 'victima.txt')) || fs.statSync(path.join(dir, 'victima.txt')).size === 0, 'victima no contaminada');
  console.log('symlink hardening: OK');
} catch (err) {
  if (err.code === 'EPERM' || err.code === 'EACCES') {
    console.log('symlink hardening: SKIP (Windows sin privilegios para crear symlinks)');
  } else {
    throw err;
  }
}

// flushSync persiste lo encolado sin esperar el tick asincrono (ruta de cierre/crash).
l.appendLogLine('INFO', 'pendiente en cierre sincrono');
l.flushLogQueueSync();
assert(fs.readFileSync(logFile, 'utf8').includes('pendiente en cierre sincrono'), 'flushSync escribe el pending');
console.log('flushSync en cierre sincrono: OK');

// Un fallo de escritura no debe envenenar la cadena: lo posterior sigue llegando.
fs.unlinkSync(logFile);
fs.mkdirSync(logFile, { recursive: true }); // appendFile sobre un directorio falla (EISDIR/EPERM)
l.appendLogLine('INFO', 'linea hacia destino roto');
await l.flushLogQueue();
fs.rmdirSync(logFile);
l.appendLogLine('INFO', 'linea posterior al fallo');
await l.flushLogQueue();
assert(fs.readFileSync(logFile, 'utf8').includes('linea posterior al fallo'), 'la cola sigue viva tras un writeBatch fallido');
console.log('cadena de drain inmune a rechazos: OK');

const originalEventAppend = fs.promises.appendFile;
const dropsBeforeEventFailures = l.getDroppedEventCount();
fs.promises.appendFile = async () => { throw new Error('simulated write failure'); };
try {
  l.appendLogEvent('WARN', 'event failure one');
  await l.flushLogQueue();
  l.appendLogEvent('WARN', 'event failure two');
  await l.flushLogQueue();
} finally {
  fs.promises.appendFile = originalEventAppend;
}
assert.strictEqual(l.getDroppedEventCount(), dropsBeforeEventFailures + 2, 'cada fallo mantiene su cuenta acumulada');
console.log('eventos descartados acumulados tras fallos de escritura: OK');

// flush debe seguir el encadenado si llega otro lote mientras el anterior escribe.
const raceDir = path.join(process.env.LOCALAPPDATA, 'flush-race');
const raceFile = path.join(raceDir, 'antares-2026-09-18.log');
const realAppendFile = fs.promises.appendFile.bind(fs.promises);
let startFirst;
let startSecond;
let releaseFirst;
let releaseSecond;
const firstStarted = new Promise((resolve) => { startFirst = resolve; });
const secondStarted = new Promise((resolve) => { startSecond = resolve; });
const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
fs.promises.appendFile = async (target, text, encoding) => {
  if (text.includes('primer lote')) {
    startFirst();
    await firstGate;
  }
  if (text.includes('segundo lote')) {
    startSecond();
    await secondGate;
  }
  return realAppendFile(target, text, encoding);
};
try {
  const writer = createAsyncLogWriter({
    getLogsDir: () => raceDir,
    getMaxFileBytes: () => 1024 * 1024,
    managedLogPattern: /^antares-.*\.log$/,
    maxDirectoryBytes: 1024 * 1024,
    onDrop: () => {},
  });
  writer.append(raceFile, 'primer lote\n');
  const flushing = writer.flush();
  let flushResolved = false;
  void flushing.then(() => { flushResolved = true; });
  await firstStarted;
  writer.append(raceFile, 'segundo lote\n');
  await Promise.resolve();
  releaseFirst();
  await secondStarted;
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(flushResolved, false, 'flush no debe resolver con un lote encadenado en vuelo');
  releaseSecond();
  await flushing;
  await writer.flush();
  assert(fs.readFileSync(raceFile, 'utf8').includes('segundo lote'), 'flush espera el lote encadenado');
} finally {
  releaseFirst?.();
  releaseSecond?.();
  fs.promises.appendFile = realAppendFile;
}
console.log('flush espera lotes encadenados: OK');

// El límite incluye los lotes ya extraídos del pending pero aún sin escribir.
const boundedDir = path.join(process.env.LOCALAPPDATA, 'bounded-queue');
const boundedFile = path.join(boundedDir, 'antares-bounded.log');
const originalBoundedAppend = fs.promises.appendFile;
let releaseBounded;
let boundedStarted;
const boundedGate = new Promise((resolve) => { releaseBounded = resolve; });
const boundedStart = new Promise((resolve) => { boundedStarted = resolve; });
let dropped = 0;
fs.promises.appendFile = async (...args) => {
  boundedStarted();
  await boundedGate;
  return originalBoundedAppend.apply(fs.promises, args);
};
try {
  const writer = createAsyncLogWriter({
    getLogsDir: () => boundedDir,
    getMaxFileBytes: () => 1024 * 1024,
    managedLogPattern: /^antares-.*\.log$/,
    maxDirectoryBytes: 1024 * 1024,
    maxPendingEntries: 1,
    onDrop: () => { dropped += 1; },
  });
  writer.append(boundedFile, 'primer mensaje\n');
  await boundedStart;
  writer.append(boundedFile, 'mensaje descartado\n');
  assert.strictEqual(dropped, 1, 'el lote en vuelo ocupa capacidad de la cola');
  releaseBounded();
  await writer.flush();
  writer.append(boundedFile, 'mensaje posterior\n');
  await writer.flush();
  const boundedContent = fs.readFileSync(boundedFile, 'utf8');
  assert(boundedContent.includes('primer mensaje') && boundedContent.includes('mensaje posterior'));
  assert(!boundedContent.includes('mensaje descartado'));
} finally {
  releaseBounded?.();
  fs.promises.appendFile = originalBoundedAppend;
}
console.log('límite de cola con escritura en vuelo: OK');

for (const name of ['antares-staged-99999999', `antares-staged-${process.pid}`, 'antares-staged-88888888', 'antares-pdf-x1y2z3', 'antares-backend-command-abc']) {
  fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
}
fs.rmSync(process.env.LOCALAPPDATA, { recursive: true, force: true });
console.log('TODO OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
