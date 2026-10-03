const { getMainWindow } = require('./window-manager');
const { appendLogEvent } = require('./app-log');
const { sanitizeErrorMessage } = require('./autoimg-security');

function emit(method, params) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', method, params);
}

function emitError(code, detail) {
  // Los errores de Google llegan con el body crudo (p.ej. "Google API error
  // (403): {...}"): la ruta IPC sanitiza en el handler pero este canal no.
  const safe = sanitizeErrorMessage(detail);
  appendLogEvent('ERROR', 'autoimg.error', {
    component: 'electron',
    error_code: code,
    outcome: 'failed',
    message: safe,
  });
  emit('autoimg.error', { code, detail: safe });
}

module.exports = { emit, emitError };
