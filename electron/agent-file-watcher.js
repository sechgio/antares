'use strict';

// Vigilante de carpetas para triggers file_changed: un fs.watch por carpeta
// con encargos pendientes, sincronizado con el estado durable. Los eventos se
// despachan por la vía atómica de agent-tasks, así la deduplicación y la
// entrega sobreviven a reinicios y a ráfagas del sistema de archivos.

const fs = require('node:fs');
const path = require('node:path');
const { shared, ctx } = require('./agent-shared');
const { normalizePath } = require('./agent-triggers');

const watchers = new Map(); // carpeta normalizada -> { watcher, folder }
let stopped = false;

function dropWatcher(key) {
  const entry = watchers.get(key);
  if (!entry) return;
  try {
    entry.watcher.close();
  } catch (err) {
    void err;
  }
  watchers.delete(key);
}

function handleEvent(folder, eventType, filename) {
  if (stopped || !filename) return;
  const name = String(filename);
  if (!name || name.includes('/') || name.includes('\\')) {
    // fs.watch a veces anida rutas; los triggers de archivo solo cubren el nivel directo.
    if (name.includes('..')) return;
  }
  const full = path.join(folder, name);
  require('./agent-tasks')
    .fireEvent({
      type: 'file_changed',
      path: full,
      kind: eventType === 'rename' ? 'created' : 'modified',
      at: Date.now(),
    })
    .catch((err) => console.warn('[agent] trigger file_changed falló:', err?.message));
}

function ensureWatcher(folder) {
  const key = normalizePath(folder);
  if (watchers.has(key) || stopped) return;
  try {
    const watcher = fs.watch(folder, { persistent: false }, (eventType, filename) =>
      handleEvent(folder, eventType, filename),
    );
    watcher.on('error', () => dropWatcher(key));
    watchers.set(key, { watcher, folder });
  } catch (err) {
    console.warn('[agent] no se pudo vigilar la carpeta del trigger:', err?.message);
  }
}

async function syncWatchers() {
  const state = shared.state;
  if (!state || stopped) return;
  let doc;
  try {
    doc = await state.harness.snapshot(state.TasksDoc, ctx());
  } catch (err) {
    void err;
    return;
  }
  const needed = new Map();
  for (const task of Object.values((doc && doc.tasks) || {})) {
    if (!task || task.status !== 'pending' || !task.trigger || task.trigger.type !== 'file_changed') continue;
    needed.set(normalizePath(task.trigger.path), task.trigger.path);
  }
  for (const key of [...watchers.keys()]) if (!needed.has(key)) dropWatcher(key);
  for (const folder of needed.values()) ensureWatcher(folder);
}

function stop() {
  stopped = true;
  for (const key of [...watchers.keys()]) dropWatcher(key);
}

function reset() {
  for (const key of [...watchers.keys()]) dropWatcher(key);
  stopped = false;
}

module.exports = { syncWatchers, stop, reset, _watchers: watchers };
