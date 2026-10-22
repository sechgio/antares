'use strict';

const { randomUUID } = require('node:crypto');
const pending = new Map();

function isRendererAvailable(win = require('./window-manager').getMainWindow()) {
  return !!win && !win.isDestroyed() && !win.webContents.isDestroyed() && !win.webContents.isCrashed?.();
}

function runRendererTool(method, params = {}, { gated = false } = {}) {
  if (pending.size >= 2) return Promise.reject(new Error('Hay dos funciones en curso; espera a que termine una antes de continuar'));
  const win = require('./window-manager').getMainWindow();
  if (!isRendererAvailable(win)) {
    return Promise.reject(new Error('Abre Antares para usar esta función'));
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const interrupted = (reason) => {
      const err = new Error(reason);
      err.uncertain = gated;
      finish();
      reject(err);
    };
    const gone = () => interrupted('La pantalla se cerró durante la operación; comprueba su resultado antes de repetir');
    const timer = setTimeout(() => interrupted('La función excedió su tiempo; comprueba su resultado antes de repetir'), 300_000);
    function finish() {
      clearTimeout(timer);
      pending.delete(id);
      win.webContents.removeListener('render-process-gone', gone);
      win.webContents.removeListener('destroyed', gone);
    }
    pending.set(id, { resolve, reject, finish, gated });
    win.webContents.once('render-process-gone', gone);
    win.webContents.once('destroyed', gone);
    try { win.webContents.send('ipc-notify', 'agent.renderer-tool', { id, method, params }); }
    catch (err) { finish(); reject(err); }
  });
}

function acceptRendererResult(params) {
  const request = pending.get(params.id);
  if (!request) throw new Error('La solicitud de Agent ya no está activa');
  request.finish();
  if (params.error) {
    const error = new Error(String(params.error).slice(0, 500));
    error.uncertain = request.gated && params.uncertain === true;
    request.reject(error);
  }
  else request.resolve(params.result);
  return { accepted: true };
}

module.exports = { runRendererTool, acceptRendererResult, isRendererAvailable };
