'use strict';

const MAX_RUNS = 10;
const MAX_EVENTS = 50;
const MAX_QUESTION_CHARS = 500;
const MAX_OUTPUT_CHARS = 4000;
const MAX_STOP_REASON_CHARS = 400;

const NEEDS_INPUT = /NECESITA ENTRADA:\s*([\s\S]+)$/i;
const BLOCKED_MARKER = /BLOQUEADO:\s*([\s\S]+)$/i;

function isActiveTask(task) {
  return ['pending', 'delivering', 'needs_input'].includes(task.status);
}

function pruneTasks(doc) {
  const tasks = Object.values(doc.tasks);
  for (const old of tasks.filter((task) => !isActiveTask(task)).slice(0, Math.max(0, tasks.length - 199))) {
    delete doc.tasks[old.id];
  }
}

function transition(task, to, reason) {
  if (task.status === to) {
    task.updated_at = Date.now();
    return;
  }
  task.events = Array.isArray(task.events) ? task.events.slice(-(MAX_EVENTS - 1)) : [];
  task.events.push({
    at: Date.now(),
    from: String(task.status || ''),
    to,
    ...(reason ? { reason: String(reason).slice(0, MAX_STOP_REASON_CHARS) } : {}),
  });
  task.status = to;
  task.updated_at = Date.now();
}

function recordRun(task, entry) {
  task.runs = Array.isArray(task.runs) ? task.runs.slice(-(MAX_RUNS - 1)) : [];
  task.runs.push(entry);
  task.last_run_at = entry.at;
  task.last_status = entry.status;
  task.updated_at = entry.at;
  if (entry.error) task.last_error = entry.error;
  else if (entry.status === 'delivered') delete task.last_error;
}

function unmarked(text) {
  const shared = require('./agent-shared').shared;
  return String(text || '')
    .replaceAll(shared.CONTEXT_MARKER, '(Contexto de Antares)')
    .replaceAll(shared.CHECK_MARKER, '(Comprobación de Antares)');
}

function lastAnswerText(entries) {
  const answer = entries.findLast(
    (entry) =>
      entry.kind === 'pi.assistant' &&
      entry.model?.[0] &&
      !entry.model[0].content.some((block) => block.type === 'toolCall'),
  )?.model[0];
  return unmarked(
    require('./agent-execution').sanitizeProviderError(
      (answer?.content || [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    ),
  ).trim();
}

function taskOutcome(text) {
  const input = NEEDS_INPUT.exec(text);
  if (input) {
    return {
      kind: 'needs_input',
      question: input[1].trim().slice(0, MAX_QUESTION_CHARS),
      output: text.slice(0, input.index).trim().slice(0, MAX_OUTPUT_CHARS),
    };
  }
  const blocked = BLOCKED_MARKER.exec(text);
  if (blocked) {
    return {
      kind: 'blocked',
      reason: blocked[1].trim().slice(0, MAX_STOP_REASON_CHARS),
      output: text.slice(0, blocked.index).trim().slice(0, MAX_OUTPUT_CHARS),
    };
  }
  return { kind: 'done', output: String(text || '').trim().slice(0, MAX_OUTPUT_CHARS) };
}

const MAX_TASK_CONTINUATIONS = 3;

async function submitContinuation(state, session, task, requestId) {
  const { shared, ctx, conversation, continuationContext } = require('./agent-shared');
  try {
    const conv = await conversation(session.id);
    const checkpoint = (await continuationContext(session)) ||
      'El turno anterior se interrumpió antes de completar el encargo.';
    const placed = await conv.submit(
      {
        type: 'input',
        content:
          shared.CONTEXT_MARKER + '\n' +
          'Continuación automática del encargo retenido: reanuda el trabajo donde quedó. ' +
          checkpoint,
        requestId,
        whenBusy: 'followUp',
      },
      ctx(),
    );
    return !!placed;
  } catch (err) {
    console.warn('[agent] continuación automática falló:', require('./agent-execution').sanitizeProviderError(String((err && err.message) || err)));
    return false;
  }
}

module.exports = {
  MAX_RUNS,
  MAX_EVENTS,
  MAX_QUESTION_CHARS,
  MAX_TASK_CONTINUATIONS,
  NEEDS_INPUT,
  BLOCKED_MARKER,
  isActiveTask,
  pruneTasks,
  recordRun,
  transition,
  unmarked,
  lastAnswerText,
  taskOutcome,
  submitContinuation,
};
