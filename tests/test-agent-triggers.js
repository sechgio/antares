'use strict';

// Pruebas del núcleo puro de automatización por eventos.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const triggers = require('../electron/agent-triggers');

test('valida la forma de cada tipo de trigger', () => {
  assert.deepEqual(triggers.validateTrigger({ type: 'file_changed', path: 'C:/inbox' }), { type: 'file_changed', path: 'C:/inbox' });
  assert.throws(() => triggers.validateTrigger({ type: 'file_changed' }), /carpeta/);
  assert.throws(() => triggers.validateTrigger({ type: 'task_completed' }), /tarea origen/);
  assert.throws(() => triggers.validateTrigger({ type: 'webhook' }), /no soportado/);
  assert.throws(() => triggers.validateTrigger(null), /objeto/);
  assert.deepEqual(triggers.validateTrigger({ type: 'task_completed', task_id: 't1' }), { type: 'task_completed', task_id: 't1' });
});

test('el trigger de archivo solo cubre el nivel directo de la carpeta', () => {
  const trigger = triggers.validateTrigger({ type: 'file_changed', path: 'C:\\inbox' });
  assert.equal(triggers.matchesTrigger(trigger, { type: 'file_changed', path: 'C:\\inbox\\datos.xlsx', at: 1 }), true);
  assert.equal(triggers.matchesTrigger(trigger, { type: 'file_changed', path: 'C:\\inbox\\sub\\datos.xlsx', at: 1 }), false);
  assert.equal(triggers.matchesTrigger(trigger, { type: 'file_changed', path: 'C:\\otra\\datos.xlsx', at: 1 }), false);
  // Normalización: separadores y mayúsculas no rompen el match en Windows.
  assert.equal(triggers.matchesTrigger(trigger, { type: 'file_changed', path: 'c:/inbox/DATOS.xlsx', at: 1 }), true);
});

test('el patrón glob acota los archivos que disparan', () => {
  const trigger = triggers.validateTrigger({ type: 'file_changed', path: '/inbox', pattern: '*.xlsx' });
  assert.equal(triggers.matchesTrigger(trigger, { type: 'file_changed', path: '/inbox/ventas.xlsx', at: 1 }), true);
  assert.equal(triggers.matchesTrigger(trigger, { type: 'file_changed', path: '/inbox/notas.txt', at: 1 }), false);
});

test('el trigger de tarea solo se activa con su origen exacto', () => {
  const trigger = triggers.validateTrigger({ type: 'task_completed', task_id: 't1' });
  assert.equal(triggers.matchesTrigger(trigger, { type: 'task_completed', task_id: 't1', cycle: 3 }), true);
  assert.equal(triggers.matchesTrigger(trigger, { type: 'task_completed', task_id: 't2', cycle: 3 }), false);
  assert.equal(triggers.matchesTrigger(trigger, { type: 'file_changed', path: 'x' }), false);
});

test('la deduplicación de archivos colapsa ráfagas del mismo minuto', () => {
  const trigger = triggers.validateTrigger({ type: 'file_changed', path: '/inbox' });
  const first = triggers.inboxEntry(trigger, { type: 'file_changed', path: '/inbox/a.xlsx', at: 60000 * 5 + 100 }, 'task1');
  const second = triggers.inboxEntry(trigger, { type: 'file_changed', path: '/inbox/a.xlsx', at: 60000 * 5 + 40000 }, 'task1');
  assert.equal(first.key, second.key, 'mismo archivo y minuto comparten clave');
  let inbox = [];
  let outcome = triggers.inboxAccept(inbox, first);
  assert.ok(outcome.accepted, 'la primera entrega se acepta');
  inbox = outcome.items;
  outcome = triggers.inboxAccept(inbox, second);
  assert.equal(outcome.accepted, null, 'la ráfaga no duplica el encargo');
  const later = triggers.inboxEntry(trigger, { type: 'file_changed', path: '/inbox/a.xlsx', at: 60000 * 6 }, 'task1');
  assert.notEqual(later.key, first.key, 'otro minuto es un evento nuevo');
});

test('task_completed se entrega una vez por ciclo de vida', () => {
  const trigger = triggers.validateTrigger({ type: 'task_completed', task_id: 'origen' });
  const entry = triggers.inboxEntry(trigger, { type: 'task_completed', task_id: 'origen', cycle: 2 }, 'task1');
  let { accepted, items } = triggers.inboxAccept([], entry);
  assert.ok(accepted);
  assert.equal(triggers.inboxAccept(items, entry).accepted, null, 'el mismo ciclo no se reentrega');
  const nextCycle = triggers.inboxEntry(trigger, { type: 'task_completed', task_id: 'origen', cycle: 3 }, 'task1');
  assert.ok(triggers.inboxAccept(items, nextCycle).accepted, 'un ciclo nuevo sí dispara');
});

test('la bandeja queda acotada descartando lo más antiguo', () => {
  const trigger = triggers.validateTrigger({ type: 'file_changed', path: '/inbox' });
  let items = [];
  for (let index = 0; index < 600; index += 1) {
    const entry = triggers.inboxEntry(trigger, { type: 'file_changed', path: `/inbox/f${index}.xlsx`, at: index * 60000 }, 'task1');
    items = triggers.inboxAccept(items, entry).items;
  }
  assert.equal(items.length, 500);
});
