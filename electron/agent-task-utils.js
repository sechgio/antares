'use strict';

const MAX_RUNS = 10;

function isActiveTask(task) {
  return ['pending', 'delivering'].includes(task.status);
}

function pruneTasks(doc) {
  const tasks = Object.values(doc.tasks);
  for (const old of tasks.filter((task) => !isActiveTask(task)).slice(0, Math.max(0, tasks.length - 199))) {
    delete doc.tasks[old.id];
  }
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

module.exports = { MAX_RUNS, MAX_TASK_CONTINUATIONS, isActiveTask, pruneTasks, recordRun, submitContinuation };
