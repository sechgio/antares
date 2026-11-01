'use strict';

// Techo absoluto por firma: el polling con resultados nuevos no puede superarlo.
const MAX_CALLS_PER_SIGNATURE = 10;
const MAX_SILENT_TURNS = 5;
// Código con el que pi-durable marca una llamada bloqueada por `beforeTool`.
const BLOCKED_DIAGNOSTIC = 'blocked';
const SILENT_TURN_NOTE = `El agente encadenó ${MAX_SILENT_TURNS} turnos seguidos sin salida visible. `
  + 'Detuve el turno para evitar un bucle; intenta enviar el encargo de nuevo.';

// Una ronda de herramientas reinicia el silencio solo si avanzó: un resultado
// nuevo o un error que no fue un bloqueo del propio motor.
async function trackSilentToolRound(turn, results, api, context) {
  if (!turn.pendingSilent) return;
  turn.pendingSilent = false;
  let progressed = !!turn.roundProgress;
  try {
    for (const entry of await Promise.all((results || []).map((id) => api.entry(id, context)))) {
      const message = entry && Array.isArray(entry.model) ? entry.model[0] : null;
      if (!message || !message.isError) continue;
      const diagnostics = entry.data && Array.isArray(entry.data.diagnostics) ? entry.data.diagnostics : [];
      if (!diagnostics.some((diagnostic) => diagnostic && diagnostic.code === BLOCKED_DIAGNOSTIC)) progressed = true;
    }
  } catch (err) {
    console.error('[agent] no se pudo revisar la ronda de herramientas:', (err && err.message) || err);
    progressed = true;
  }
  turn.silentTurns = progressed ? 0 : turn.silentTurns + 1;
  turn.roundProgress = false;
}

// `visible` lo calcula agent-execution.js con el mismo criterio que usa para
// decidir si una respuesta llegó vacía.
function trackSilentTurn(message, turn, visible) {
  if (visible) {
    turn.silentTurns = 0;
    turn.pendingSilent = false;
    return;
  }
  if (message.errorMessage || message.stopReason === 'aborted' || message.stopReason === 'error') return;
  if ((message.content || []).some((block) => block && block.type === 'toolCall')) {
    turn.pendingSilent = true;
    turn.roundProgress = false;
  } else {
    turn.silentTurns += 1;
  }
  // El corte se evalúa al recibir la respuesta, así que una respuesta con texto
  // visible siempre reinicia el contador antes de cerrar el turno por silencio.
  if (turn.silentTurns >= MAX_SILENT_TURNS) {
    message.stopReason = 'error';
    message.errorMessage = SILENT_TURN_NOTE;
    message.content.push({ type: 'text', text: SILENT_TURN_NOTE });
  }
}

module.exports = { MAX_CALLS_PER_SIGNATURE, MAX_SILENT_TURNS, trackSilentTurn, trackSilentToolRound };
