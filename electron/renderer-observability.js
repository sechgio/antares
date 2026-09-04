const { appendLogEvent, redactText } = require('./app-log');

const MAX_RENDERER_MESSAGE_LENGTH = 4000;
const ALLOWED_KINDS = new Set([
  'react_error',
  'global_error',
  'unhandled_rejection',
]);
const ALLOWED_EVENT_NAMES = new Set([
  'canvas.realtime',
  'canvas.quit_flush',
]);
const ALLOWED_EVENT_FIELDS = new Set([
  'view',
  'status_class',
  'outcome',
  'duration_ms',
  'count',
  'reason',
]);
const ALLOWED_LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']);
const ALLOWED_OUTCOMES = new Set([
  'success',
  'partial',
  'degraded',
  'failed',
  'timeout',
  'cancelled',
  'rejected',
]);

function _safeToken(value, fallback) {
  const text = String(value ?? '').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
  return text || fallback;
}

function _safeText(value) {
  return redactText(value ?? '').slice(0, MAX_RENDERER_MESSAGE_LENGTH);
}

function sanitizeRendererError(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const kind = ALLOWED_KINDS.has(source.kind) ? source.kind : 'global_error';
  const view = _safeToken(source.view, 'unknown');
  const name = _safeText(source.name).slice(0, 120);
  const message = _safeText(source.message);
  const stack = _safeText(source.stack);
  const componentStack = _safeText(source.componentStack ?? source.component_stack);
  const parts = [
    name && `name=${name}`,
    message && `message=${message}`,
    stack && `stack=${stack}`,
    componentStack && `component_stack=${componentStack}`,
  ].filter(Boolean);
  return {
    kind,
    view,
    message: parts.join(' | ').slice(0, MAX_RENDERER_MESSAGE_LENGTH) || 'renderer error',
  };
}

function recordRendererError(payload) {
  const safe = sanitizeRendererError(payload);
  appendLogEvent('ERROR', 'renderer.error', {
    component: 'renderer',
    outcome: 'failed',
    reason: safe.kind,
    view: safe.view,
    message: safe.message,
  });
  return safe;
}

function sanitizeRendererEvent(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const event = ALLOWED_EVENT_NAMES.has(source.event) ? source.event : null;
  if (!event) return null;
  const sourceFields = source.fields && typeof source.fields === 'object' ? source.fields : {};
  const fields = {};
  for (const [key, value] of Object.entries(sourceFields)) {
    if (!ALLOWED_EVENT_FIELDS.has(key)) continue;
    if (key === 'outcome') {
      if (ALLOWED_OUTCOMES.has(value)) fields[key] = value;
    } else if (key === 'duration_ms') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) fields[key] = Math.round(value);
    } else if (key === 'count') {
      if (Number.isInteger(value) && value >= 0) fields[key] = value;
    } else if (key === 'view' || key === 'status_class' || key === 'reason') {
      const safe = _safeToken(value, '');
      if (safe) fields[key] = safe;
    }
  }
  return {
    event,
    level: ALLOWED_LEVELS.has(source.level) ? source.level : 'INFO',
    fields,
  };
}

function recordRendererEvent(payload) {
  const safe = sanitizeRendererEvent(payload);
  if (!safe) return null;
  appendLogEvent(safe.level, safe.event, {
    component: 'renderer',
    ...safe.fields,
  });
  return safe;
}

function registerRendererObservability(ipcMain) {
  if (!ipcMain || typeof ipcMain.on !== 'function') return;
  ipcMain.on('renderer-error', (event, payload) => {
    try {
      const { app } = require('electron');
      const { getMainWindow } = require('./window-manager');
      const { isTrustedRendererFrame } = require('./renderer-trust');
      const isDev = !app.isPackaged;
      if (!isTrustedRendererFrame(event, getMainWindow(), isDev)) return;
      recordRendererError(payload);
    } catch {
    }
  });
  ipcMain.on('renderer-event', (event, payload) => {
    try {
      const { app } = require('electron');
      const { getMainWindow } = require('./window-manager');
      const { isTrustedRendererFrame } = require('./renderer-trust');
      const isDev = !app.isPackaged;
      if (!isTrustedRendererFrame(event, getMainWindow(), isDev)) return;
      recordRendererEvent(payload);
    } catch {
    }
  });
}

module.exports = {
  recordRendererError,
  recordRendererEvent,
  registerRendererObservability,
  sanitizeRendererError,
  sanitizeRendererEvent,
};
