const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const previousLocalAppData = process.env.LOCALAPPDATA;
const previousXdgDataHome = process.env.XDG_DATA_HOME;
const testRoot = path.join(os.tmpdir(), `antares-renderer-observability-${process.pid}`);
process.env.LOCALAPPDATA = testRoot;
process.env.XDG_DATA_HOME = testRoot;
fs.rmSync(testRoot, { recursive: true, force: true });

const { flushLogQueue, getLogsDir } = require('../electron/app-log');
const {
  recordRendererError,
  recordRendererEvent,
  sanitizeRendererError,
  sanitizeRendererEvent,
} = require('../electron/renderer-observability');

async function main() {
try {
  const raw = {
    kind: 'react_error',
    view: 'canvas/editor',
    name: 'TypeError',
    message: 'Failed for alice@example.com at C:\\Users\\Alice\\secret.txt',
    stack: 'TypeError: boom\n    at C:\\Users\\Alice\\secret.txt:1:2',
    componentStack: '\n    at Canvas (C:\\Users\\Alice\\secret.tsx:1:1)',
  };
  const safe = sanitizeRendererError(raw);

  assert.strictEqual(safe.kind, 'react_error');
  assert.strictEqual(safe.view, 'canvas_editor');
  assert(!safe.message.includes('alice@example.com'), 'renderer payload redacts email');
  assert(!safe.message.includes('C:\\Users\\Alice'), 'renderer payload redacts absolute path');
  assert(safe.message.length <= 4000, 'renderer payload is bounded');

  recordRendererError(raw);
  await flushLogQueue();
  const jsonl = fs.readdirSync(getLogsDir()).find((name) => name.endsWith('.jsonl'));
  assert(jsonl, 'renderer event creates a structured log');
  const events = fs.readFileSync(path.join(getLogsDir(), jsonl), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const event = events.find((entry) => entry.event === 'renderer.error');
  assert(event, 'renderer error event is persisted');
  assert.strictEqual(event.component, 'renderer');
  assert.strictEqual(event.outcome, 'failed');
  assert.strictEqual(event.reason, 'react_error');
  assert.strictEqual(event.view, 'canvas_editor');
  assert(!event.message.includes('alice@example.com'), 'persisted renderer event has no email');
  assert(!event.message.includes('C:\\Users\\Alice'), 'persisted renderer event has no absolute path');

  const realtime = sanitizeRendererEvent({
    event: 'canvas.realtime',
    level: 'INFO',
    fields: {
      view: 'canvas',
      status_class: 'live',
      count: 2,
      message: 'document=doc-1 should not be emitted',
    },
  });
  assert.strictEqual(realtime.event, 'canvas.realtime');
  assert.strictEqual(realtime.fields.count, 2);
  assert.strictEqual(realtime.fields.message, undefined);
  recordRendererEvent({
    event: 'canvas.realtime',
    level: 'INFO',
    fields: { view: 'canvas', status_class: 'live', count: 2 },
  });
  await flushLogQueue();
  const realtimeEvent = events
    .concat(fs.readFileSync(path.join(getLogsDir(), jsonl), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line)))
    .find((entry) => entry.event === 'canvas.realtime');
  assert(realtimeEvent, 'canvas realtime event is persisted');
  assert.strictEqual(realtimeEvent.count, 2);

  recordRendererEvent({
    event: 'canvas.quit_flush',
    level: 'ERROR',
    fields: { outcome: 'failed', reason: 'canvas_save_failed', duration_ms: 8123 },
  });
  await flushLogQueue();
    const allNow = fs.readFileSync(path.join(getLogsDir(), jsonl), 'utf8').trim().split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const quitEvent = allNow.find((entry) => entry.event === 'canvas.quit_flush');
  assert(quitEvent, 'canvas.quit_flush pasa la allowlist y se persiste');
  assert.strictEqual(quitEvent.outcome, 'failed');
  assert.strictEqual(quitEvent.reason, 'canvas_save_failed');
  recordRendererError({
    kind: 'toast_error',
    view: 'toast',
    name: 'ToastError',
    message: 'No se pudo exportar el informe',
  });
  recordRendererError({
    kind: 'api_error',
    view: 'api:process_start',
    name: 'AntaresAPIError[TIMEOUT]',
    message: 'IPC timeout: process_start',
    request_id: 'req-frontend-correlation-1',
  });

  recordRendererEvent({
    event: 'canvas.push',
    level: 'WARN',
    fields: { outcome: 'degraded', reason: 'lww_rpc_v2_missing' },
  });
  recordRendererEvent({
    event: 'espacios.sync',
    level: 'ERROR',
    fields: { outcome: 'failed', reason: 'load_failed', view: 'espacios' },
  });
  recordRendererEvent({
    event: 'storage.local',
    level: 'WARN',
    fields: { outcome: 'degraded', reason: 'canvas_asset_put_failed' },
  });
  recordRendererEvent({
    event: 'worker.error',
    level: 'WARN',
    fields: { outcome: 'failed', reason: 'worker_timeout', view: 'image-optimizer' },
  });
  recordRendererEvent({
    event: 'canvas.cloud_sync',
    level: 'INFO',
    fields: { outcome: 'success', request_id: 'req-sync-42' },
  });
  const rejectedUnknown = recordRendererEvent({
    event: 'not.in.allowlist',
    level: 'INFO',
    fields: { outcome: 'failed' },
  });
  assert.strictEqual(rejectedUnknown, null, 'eventos fuera de la allowlist se descartan');
  const hostile = sanitizeRendererEvent({
    event: 'canvas.push',
    fields: { request_id: "a'b; DROP TABLE--\nsecond line" },
  });
  assert(hostile && /^[a-zA-Z0-9_.:-]+$/.test(hostile.fields.request_id), 'request_id hostil queda sanitizado a token seguro');
  await flushLogQueue();

  const updatedEvents = fs.readFileSync(path.join(getLogsDir(), jsonl), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const toastEvent = updatedEvents.find((entry) => entry.event === 'renderer.error' && entry.reason === 'toast_error');
  assert(toastEvent, 'toast_error renderer event is persisted');
  assert.strictEqual(toastEvent.reason, 'toast_error');
  assert.strictEqual(toastEvent.view, 'toast');
  assert(toastEvent.message.includes('No se pudo exportar el informe'));

  const apiEvent = updatedEvents.find((entry) => entry.event === 'renderer.error' && entry.reason === 'api_error');
  assert(apiEvent, 'api_error renderer event is persisted');
  assert.strictEqual(apiEvent.reason, 'api_error');
  assert.strictEqual(apiEvent.view, 'api:process_start');
  assert.strictEqual(apiEvent.request_id, 'req-frontend-correlation-1', 'api_error conserva request_id para correlación con ipc.request');
  assert(apiEvent.message.includes('AntaresAPIError[TIMEOUT]'));

  const pushEvent = updatedEvents.find((entry) => entry.event === 'canvas.push');
  assert(pushEvent, 'canvas.push pasa la allowlist y se persiste');
  assert.strictEqual(pushEvent.outcome, 'degraded');
  const syncEvent = updatedEvents.find((entry) => entry.event === 'canvas.cloud_sync');
  assert(syncEvent, 'canvas.cloud_sync pasa la allowlist y se persiste');
  assert.strictEqual(syncEvent.request_id, 'req-sync-42', 'renderer-event conserva request_id para correlación');
  const espaciosEvent = updatedEvents.find((entry) => entry.event === 'espacios.sync');
  assert(espaciosEvent, 'espacios.sync pasa la allowlist y se persiste');
  assert.strictEqual(espaciosEvent.view, 'espacios');
  const storageEvent = updatedEvents.find((entry) => entry.event === 'storage.local');
  assert(storageEvent, 'storage.local pasa la allowlist y se persiste');
  const workerEvent = updatedEvents.find((entry) => entry.event === 'worker.error');
  assert(workerEvent, 'worker.error pasa la allowlist y se persiste');

  console.log('renderer observability: OK');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  if (previousXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousXdgDataHome;
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
