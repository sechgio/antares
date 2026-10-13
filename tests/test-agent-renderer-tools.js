'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function main() {
  const wc = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (...args) => sent.push(args) });
  const sent = [];
  const timers = new Set();
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/agent-renderer-tools.js'), 'utf8'), {
    module, require: (id) => id === './window-manager' ? { getMainWindow: () => ({ isDestroyed: () => false, webContents: wc }) } : require(id),
    setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn),
  });
  const api = module.exports;
  const first = api.runRendererTool('document_render', {});
  const second = api.runRendererTool('espacios_tarea_update', {}, { gated: true });
  await assert.rejects(api.runRendererTool('padron_describe'), /dos funciones/);
  assert.throws(() => api.acceptRendererResult({ id: 'foreign', result: {} }), /no está activa/);
  const id = sent[0][2].id;
  api.acceptRendererResult({ id, result: { html: '<p>Documento</p>' } });
  assert.equal((await first).html, '<p>Documento</p>');
  assert.throws(() => api.acceptRendererResult({ id, result: {} }), /no está activa/);
  const cancelled = assert.rejects(second, (err) => err.uncertain === true);
  wc.emit('render-process-gone');
  await cancelled;
  assert.equal(wc.listenerCount('destroyed'), 0);
  assert.equal(timers.size, 0);
  const timed = api.runRendererTool('espacios_tarea_create', {}, { gated: true });
  const rejected = assert.rejects(timed, (err) => err.uncertain === true);
  [...timers][0]();
  await rejected;
  assert.equal(timers.size, 0);
  const lost = api.runRendererTool('espacios_espacio_create', {}, { gated: true });
  const lostRejected = assert.rejects(lost, (err) => err.uncertain === true);
  api.acceptRendererResult({ id: sent.at(-1)[2].id, error: 'Respuesta perdida', uncertain: true });
  await lostRejected;
  const confirmed = api.runRendererTool('espacios_espacio_create', {}, { gated: true });
  const confirmedRejected = assert.rejects(confirmed, (err) => !err.uncertain);
  api.acceptRendererResult({ id: sent.at(-1)[2].id, error: 'Permiso denegado' });
  await confirmedRejected;
  console.log('[PASS] Renderer: correlación, límite, respuestas tardías e incertidumbre tras cierre/timeout.');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
