'use strict';

// Núcleo puro de automatización por eventos: evaluación de triggers y bandeja
// idempotente durable. Un mismo evento no puede lanzar dos veces el mismo
// encargo aunque el proceso se reinicie a mitad de la entrega.

const TRIGGER_TYPES = new Set(['file_changed', 'task_completed']);
const MAX_INBOX_ENTRIES = 500;

function validateTrigger(trigger) {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) throw new Error('El trigger debe ser un objeto');
  if (!TRIGGER_TYPES.has(trigger.type)) throw new Error('Tipo de trigger no soportado');
  if (trigger.type === 'file_changed') {
    if (typeof trigger.path !== 'string' || !trigger.path.trim()) throw new Error('El trigger de archivo necesita una carpeta');
    if (trigger.pattern !== undefined && (typeof trigger.pattern !== 'string' || trigger.pattern.length > 200))
      throw new Error('El patrón del trigger no es válido');
  }
  if (trigger.type === 'task_completed') {
    if (typeof trigger.task_id !== 'string' || !trigger.task_id.trim()) throw new Error('El trigger necesita la tarea origen');
  }
  return {
    type: trigger.type,
    ...(trigger.path ? { path: trigger.path.trim() } : {}),
    ...(trigger.pattern ? { pattern: trigger.pattern.trim() } : {}),
    ...(trigger.task_id ? { task_id: trigger.task_id.trim() } : {}),
  };
}

function normalizePath(value) {
  return String(value || '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function matchesPattern(name, pattern) {
  if (!pattern) return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

function matchesTrigger(trigger, event) {
  if (!trigger || !event || trigger.type !== event.type) return false;
  if (trigger.type === 'file_changed') {
    const folder = normalizePath(trigger.path);
    const file = normalizePath(event.path);
    if (!file.startsWith(`${folder}/`)) return false;
    const name = file.slice(folder.length + 1);
    if (name.includes('/')) return false; // solo el nivel directo: recursión explícita queda fuera de la v1
    return matchesPattern(name, trigger.pattern || '');
  }
  if (trigger.type === 'task_completed') return trigger.task_id === event.task_id;
  return false;
}

// Clave estable de deduplicación: mismo trigger, mismo evento, mismo minuto de
// observación para archivos (un editor puede emitir ráfagas) y entrega única
// por ciclo de vida de la tarea origen.
function dedupeKey(trigger, event) {
  if (trigger.type === 'file_changed') {
    const minute = Math.floor(Number(event.at || 0) / 60000);
    return `file:${normalizePath(event.path)}:${minute}`;
  }
  if (trigger.type === 'task_completed') return `task:${event.task_id}:${event.cycle || 0}`;
  return null;
}

function inboxEntry(trigger, event, taskId) {
  return {
    key: dedupeKey(trigger, event),
    trigger_type: trigger.type,
    task_id: taskId,
    event_at: Number(event.at || Date.now()),
    first_seen_at: Date.now(),
    payload_hash: null,
  };
}

// Inserta en la bandeja si la clave no existe. Devuelve la entrada nueva o
// null cuando el evento ya fue entregado: la ejecución es idempotente aunque
// el watcher reemita o el proceso se reinicie entre el evento y el encargo.
function inboxAccept(inbox, entry) {
  const items = Array.isArray(inbox) ? inbox : [];
  if (items.some((item) => item.key === entry.key && item.task_id === entry.task_id)) return { accepted: null, items };
  const next = [...items, entry].slice(-MAX_INBOX_ENTRIES);
  return { accepted: entry, items: next };
}

module.exports = { validateTrigger, matchesTrigger, dedupeKey, inboxEntry, inboxAccept, TRIGGER_TYPES, normalizePath, matchesPattern };
