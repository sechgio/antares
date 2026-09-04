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

const { getLogsDir } = require('../electron/app-log');
const {
  recordRendererError,
  recordRendererEvent,
  sanitizeRendererError,
  sanitizeRendererEvent,
} = require('../electron/renderer-observability');

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
    const allNow = fs.readFileSync(path.join(getLogsDir(), jsonl), 'utf8').trim().split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const quitEvent = allNow.find((entry) => entry.event === 'canvas.quit_flush');
  assert(quitEvent, 'canvas.quit_flush pasa la allowlist y se persiste');
  assert.strictEqual(quitEvent.outcome, 'failed');
  assert.strictEqual(quitEvent.reason, 'canvas_save_failed');
  assert.strictEqual(quitEvent.duration_ms, 8123);

  console.log('renderer observability: OK');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  if (previousXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousXdgDataHome;
}
