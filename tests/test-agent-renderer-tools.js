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
  const calls = [];
  const nativeModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/agent-native-tools.js'), 'utf8'), {
    module: nativeModule, Buffer, require: (id) => {
      if (id === './agent-renderer-tools') return api;
      if (id === './ipc-router') return { _callBackend: async (method, params) => {
        calls.push({ method, params });
        if (params.expected_updated_at !== 'revision-vigente') throw new Error('La revisión cambió');
        return { id: params.id, layers: [{ id: 'guardada' }] };
      } };
      return require(require.resolve(id, { paths: [path.join(__dirname, '../electron')] }));
    },
  });
  const native = nativeModule.exports;
  const approvedContext = await native.nativeToolContext('canvas_apply_layers');
  wc.isCrashed = () => true;
  const saving = native.runNativeTool('canvas_apply_layers', { id: 'doc', expected_updated_at: 'revision-vigente', layers: [] }, { approvedContext });
  await new Promise(setImmediate);
  assert.equal(calls.length, 1, 'Canvas usa el backend si el proceso del renderer ha caído');
  const saved = await saving;
  assert.equal(saved.layers[0].id, 'guardada');
  assert.equal(calls[0].method, 'agent_canvas_apply_layers');
  await assert.rejects(native.runNativeTool('canvas_apply_layers', { id: 'doc', expected_updated_at: 'antigua' }, { approvedContext }), /revisión/);
  wc.isCrashed = () => false;
  const guarded = native.runNativeTool('canvas_apply_layers', { id: 'doc', expected_updated_at: 'revision-vigente' }, { approvedContext });
  const guardedRejected = assert.rejects(guarded, /cambios sin guardar/);
  await new Promise(setImmediate);
  api.acceptRendererResult({ id: sent.at(-1)[2].id, error: 'Canvas tiene cambios sin guardar' });
  await guardedRejected;
  assert.equal(calls.length, 2, 'un rechazo del editor no se reintenta en el backend');
  console.log('[PASS] Renderer: correlación, límite, respuestas tardías e incertidumbre tras cierre/timeout.');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
