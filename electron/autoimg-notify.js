const { getMainWindow } = require('./window-manager');
const { appendLogEvent } = require('./app-log');

function emit(method, params) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', method, params);
}

function emitError(code, detail) {
  appendLogEvent('ERROR', 'autoimg.error', {
    component: 'electron',
    error_code: code,
    outcome: 'failed',
    message: detail,
  });
  emit('autoimg.error', { code, detail });
}

module.exports = { emit, emitError };
