import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { AgentDelegation } from '../../api/agentApi';
import SubagentRoster from './SubagentRoster';

function delegation(overrides: Partial<AgentDelegation> = {}): AgentDelegation {
  return {
    session_id: 'delegate-1',
    agent: 'Investigador',
    status: 'working',
    state: 'trabajando',
    running: true,
    ms: 2400,
    task: 'Revisa el contrato',
    last_tool: { name: 'canvas_list', failed: false },
    ...overrides,
  };
}

it('no renderiza nada sin delegaciones activas', () => {
  const { container } = render(<SubagentRoster items={[]} />);
  expect(container.firstChild).toBeNull();
});

it('resume agente, estado, herramienta observada y duración', () => {
  render(<SubagentRoster items={[delegation()]} />);
  expect(screen.getByText('Investigador')).toBeInTheDocument();
  expect(screen.getByText('trabajando')).toBeInTheDocument();
  expect(screen.getByText('Listar documentos de Canvas')).toBeInTheDocument();
  expect(screen.getByText('2,4 s')).toBeInTheDocument();
});

it('marca la última herramienta fallida sin ocultar el resto del roster', () => {
  render(<SubagentRoster items={[
    delegation(),
    delegation({ session_id: 'delegate-2', agent: 'Revisor', state: 'pendiente', running: false, ms: 300,
      last_tool: { name: 'templates_catalog', failed: true } }),
  ]} />);
  expect(screen.getByText('Revisor')).toBeInTheDocument();
  expect(screen.getByText('Consultar las plantillas disponibles · error')).toBeInTheDocument();
});
