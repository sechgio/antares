const { appendLogEvent, redactText } = require('./app-log');

const MAX_RENDERER_MESSAGE_LENGTH = 4000;
const ALLOWED_KINDS = new Set([
  'react_error',
  'global_error',
  'unhandled_rejection',
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

function registerRendererObservability(ipcMain) {
  if (!ipcMain || typeof ipcMain.on !== 'function') return;
  ipcMain.on('renderer-error', (_event, payload) => {
    try {
      recordRendererError(payload);
    } catch {
      // Renderer diagnostics must never affect the main process.
    }
  });
}

module.exports = {
  recordRendererError,
  registerRendererObservability,
  sanitizeRendererError,
};
