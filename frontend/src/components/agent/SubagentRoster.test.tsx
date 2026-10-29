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

it('muestra la ronda de la sala y el turno en curso', () => {
  render(<SubagentRoster items={[delegation({
    room: { id: 'room-1', topic: 'Contrato y anexo', status: 'open', round: 2, rounds: 3, members: 2,
      turn_member: 'delegate-1', turn_agent: 'Investigador' },
  })]} />);
  expect(screen.getByText('Sala 2/3 · turno de Investigador')).toBeInTheDocument();
  expect(screen.getByTitle('Contrato y anexo · turno de Investigador')).toBeInTheDocument();
  expect(screen.getByText('trabajando')).toBeInTheDocument();
});

it('avisa cuando la delegación espera al usuario', () => {
  render(<SubagentRoster items={[delegation({ awaiting_user: true, question: '¿Qué contrato reviso?' })]} />);
  const waiting = screen.getByText('espera al usuario');
  expect(waiting).toBeInTheDocument();
  expect(waiting).toHaveAttribute('title', '¿Qué contrato reviso?');
});

it('marca la entrega aplazada y la que sigue fallando', () => {
  render(<SubagentRoster items={[
    delegation({ delivery: { state: 'deferred', attempts: 2, retry_at: Date.now() + 120000, error: 'proveedor caído' } }),
    delegation({ session_id: 'delegate-2', agent: 'Revisor', delivery: { state: 'unreachable', attempts: 3 } }),
  ]} />);
  expect(screen.getByText('reintento · 2')).toBeInTheDocument();
  expect(screen.getByText('sin entrega · 3')).toBeInTheDocument();
  expect(screen.getByTitle(/proveedor caído/)).toBeInTheDocument();
});
