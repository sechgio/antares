import { expect, it } from 'vitest';
import { PROGRESS_LIMIT, mergeAgentProgress, parseAgentProgress, progressLabel, progressName, type AgentProgressItem } from './AgentProgress';

function item(id: string, event: AgentProgressItem['event'], status = 'running'): AgentProgressItem {
  return {
    key: `subagent:${id}`, source: 'subagent', id, name: id, event, status, detail: '', output: '',
    cancellable: event === 'start' || event === 'step',
  };
}

it('interpreta solo el progreso de la sesión activa', () => {
  expect(parseAgentProgress('s1', {
    session_id: 's2', source: 'subagent', event: 'start', id: 'c1', name: 'Investigador', cancellable: true,
  })).toBeNull();
  const parsed = parseAgentProgress('s1', {
    session_id: 's1', source: 'shell_job', event: 'step', id: 'j1', name: 'build',
    status: 'running', stdout: 'Compilando…', cancellable: true,
  });
  expect(parsed).toMatchObject({ key: 'shell_job:j1', source: 'shell_job', output: 'Compilando…' });
});

it('conserva las filas activas al superar el límite', () => {
  let items: AgentProgressItem[] = [];
  for (let index = 0; index < PROGRESS_LIMIT + 2; index += 1) {
    items = mergeAgentProgress(items, item(String(index), 'start'));
  }
  expect(items).toHaveLength(PROGRESS_LIMIT + 2);
  for (let index = 0; index < PROGRESS_LIMIT; index += 1) {
    items = mergeAgentProgress(items, item(String(index), 'finish', 'done'));
  }
  expect(items.filter((entry) => entry.event === 'start')).toHaveLength(2);
  expect(items).toHaveLength(PROGRESS_LIMIT);
});

it('traduce los estados terminales', () => {
  expect(progressLabel(item('c1', 'finish', 'cancelled'))).toBe('fin · cancelado');
  expect(progressLabel(item('c2', 'finish', 'exited'))).toBe('fin · completado');
});

it('respeta el contrato de cancelación sin perder el nombre del job', () => {
  const start = parseAgentProgress('s1', {
    session_id: 's1', source: 'shell_job', event: 'start', id: 'j1', name: 'npm run build', cancellable: true,
  });
  const step = parseAgentProgress('s1', {
    session_id: 's1', source: 'shell_job', event: 'step', id: 'j1', status: 'running', cancellable: false,
  });
  expect(step?.cancellable).toBe(false);
  const [merged] = mergeAgentProgress([start!], step!);
  expect(progressName(merged)).toBe('npm run build');
  const unnamed = parseAgentProgress('s1', { session_id: 's1', source: 'subagent', event: 'start', id: 'c1' });
  expect(progressName(unnamed!)).toBe('Subagente');
});
