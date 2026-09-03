const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataRoot = path.join(os.tmpdir(), `antares-observability-${process.pid}-${Date.now()}`);
process.env.LOCALAPPDATA = dataRoot;
process.env.ANTARES_OBSERVABILITY_MAX_FILE_BYTES = '512';

const contract = require('../shared/observability-contract.json');
const appLog = require('../electron/app-log.js');

function readEvents() {
  const names = fs.readdirSync(appLog.getLogsDir())
    .filter((name) => /^antares-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/.test(name))
    .sort();
  return names.flatMap((name) => fs.readFileSync(path.join(appLog.getLogsDir(), name), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line)));
}

try {
  assert.strictEqual(contract.schema_version, 1, 'contrato versionado');
  for (const field of ['event', 'level', 'component', 'timestamp', 'app_version', 'session_id']) {
    assert(contract.required_fields.includes(field), `contrato requiere ${field}`);
  }
  assert(!contract.allowed_labels.includes('request_id'), 'request_id no es label agregable');
  assert(contract.sensitive_fields.includes('token'), 'contrato bloquea tokens');
  assert(contract.sensitive_fields.includes('path'), 'contrato bloquea rutas');

  appLog.setAppContext({ appVersion: '0.10.20-test', backendVersion: '0.10.20-backend' });
  const firstSession = appLog.getSessionId();
  assert.match(firstSession, /^[0-9a-f-]{36}$/i, 'session_id tiene formato UUID');
  assert.strictEqual(appLog.getSessionId(), firstSession, 'la sesión permanece estable');

  appLog.appendLogEvent('ERROR', 'backend.stderr', {
    component: 'backend',
    pid: 1234,
    backend_pid: 1234,
    stream: 'stderr',
    outcome: 'failed',
    request_id: '11111111-1111-4111-8111-111111111111',
    message: 'Authorization: Bearer secret-value access_token=token-value en C:\\Users\\Alice\\secret.txt alice@example.com',
    token: 'must-not-be-serialized',
    path: 'C:\\Users\\Alice\\secret.txt',
  });
  appLog.appendLogLine('INFO', 'linea con salto\ninterno');

  const events = readEvents();
  const firstEvent = events.find((event) => event.event === 'backend.stderr');
  assert(firstEvent, 'evento estructurado escrito en JSONL');
  assert.strictEqual(firstEvent.schema_version, 1, 'evento usa el schema versionado');
  assert.strictEqual(firstEvent.component, 'backend', 'evento identifica el backend');
  assert.strictEqual(firstEvent.backend_pid, 1234, 'evento conserva el PID del backend');
  assert.strictEqual(firstEvent.app_version, '0.10.20-test', 'evento conserva versión de app');
  assert.strictEqual(firstEvent.backend_version, '0.10.20-backend', 'evento conserva versión de backend');
  assert.strictEqual(firstEvent.session_id, firstSession, 'evento conserva la sesión');
  assert(!firstEvent.message.includes('secret-value'), 'redacta bearer token');
  assert(!firstEvent.message.includes('token-value'), 'redacta access token');
  assert(!firstEvent.message.includes('C:\\Users\\Alice\\secret.txt'), 'redacta ruta completa');
  assert(!firstEvent.message.includes('alice@example.com'), 'redacta email');
  assert.strictEqual(firstEvent.token, undefined, 'omite campos no permitidos');
  assert.strictEqual(firstEvent.path, undefined, 'omite rutas como campos');

  for (let i = 0; i < 4; i += 1) {
    appLog.appendLogEvent('INFO', `test.rotation.${i}`, { message: 'x'.repeat(180) });
  }
  const rotatedFiles = fs.readdirSync(appLog.getLogsDir())
    .filter((name) => /\.jsonl$/.test(name));
  assert(rotatedFiles.length > 1, 'el JSONL rota por tamaño');

  const droppedBefore = appLog.getDroppedEventCount();
  const originalAppend = fs.appendFileSync;
  fs.appendFileSync = () => { throw new Error('simulated unwritable sink'); };
  try {
    appLog.appendLogEvent('ERROR', 'test.sink_failure', { message: 'must remain fail-open' });
  } finally {
    fs.appendFileSync = originalAppend;
  }
  assert(appLog.getDroppedEventCount() > droppedBefore, 'cuenta eventos descartados sin bloquear');

  const backendSpawner = require('../electron/backend-spawner.js');
  backendSpawner._recordStderr(
    Buffer.from('[ERROR] Python exception in C:\\Users\\Alice\\private.txt\n'),
    5678,
  );
  const stderrEvent = readEvents().find((event) => event.event === 'backend.stderr' && event.backend_pid === 5678);
  assert(stderrEvent, 'stderr del backend llega al sink durable');
  assert.strictEqual(stderrEvent.stream, 'stderr', 'stderr identifica el stream');
  assert.strictEqual(stderrEvent.session_id, firstSession, 'stderr usa la sesión de la app');
  assert.strictEqual(stderrEvent.backend_pid, 5678, 'stderr conserva el PID del proceso hijo');

  backendSpawner._recordStderr(
    Buffer.from(`${JSON.stringify({
      event: 'backend.ipc',
      level: 'WARN',
      message: 'request degraded',
      request_id: 'req-2',
      method: 'canvas_save',
      lane: 'heavy',
      outcome: 'degraded',
      duration_ms: 321,
    })}\n`),
    5679,
  );
  const structuredEvent = readEvents().find((event) => event.event === 'backend.ipc');
  assert(structuredEvent, 'el spawner conserva eventos JSON del backend');
  assert.strictEqual(structuredEvent.request_id, 'req-2', 'evento conserva request_id');
  assert.strictEqual(structuredEvent.method, 'canvas_save', 'evento conserva método');
  assert.strictEqual(structuredEvent.lane, 'heavy', 'evento conserva lane');
  assert.strictEqual(structuredEvent.outcome, 'degraded', 'evento conserva outcome');
  assert.strictEqual(structuredEvent.duration_ms, 321, 'evento conserva duración');

  const humanLog = fs.readdirSync(appLog.getLogsDir())
    .find((name) => /\.log$/.test(name));
  assert(humanLog, 'se conserva el log humano existente');
  const humanContent = fs.readFileSync(path.join(appLog.getLogsDir(), humanLog), 'utf8');
  assert(humanContent.includes(`session_id=${firstSession}`), 'log humano incluye contexto de sesión');
  assert(!humanContent.includes('\ninterno'), 'log humano no permite inyección de líneas');

  console.log('observability context/sink: TODO OK');
} finally {
  fs.rmSync(dataRoot, { recursive: true, force: true });
}
