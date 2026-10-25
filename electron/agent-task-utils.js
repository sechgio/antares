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

module.exports = { MAX_RUNS, isActiveTask, pruneTasks, recordRun };
