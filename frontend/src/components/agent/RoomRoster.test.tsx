import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { AgentRoom } from '../../api/agentApi';
import RoomRoster from './RoomRoster';

function room(overrides: Partial<AgentRoom> = {}): AgentRoom {
  return {
    room_id: 'room-1',
    topic: 'Contrato y anexo',
    status: 'open',
    round: 2,
    rounds: 3,
    members: [
      { session_id: 'delegate-1', agent: 'Investigador', status: 'working', awaiting_user: false },
      { session_id: 'delegate-2', agent: 'Revisor', status: 'delivered', awaiting_user: true },
    ],
    turn: { member: 'delegate-1', agent: 'Investigador', index: 1, deadline: Date.now() + 60000 },
    transcript: '- Ronda 2, Revisor: Falta el anexo.',
    ...overrides,
  };
}

it('no renderiza nada sin salas', () => {
  const { container } = render(<RoomRoster rooms={[]} />);
  expect(container.firstChild).toBeNull();
});

it('muestra la ronda, el turno, los miembros y la transcripción', () => {
  render(<RoomRoster rooms={[room()]} />);
  expect(screen.getByText('Sala «Contrato y anexo»')).toBeInTheDocument();
  expect(screen.getByText('Ronda 2/3')).toBeInTheDocument();
  expect(screen.getByText('turno de Investigador')).toBeInTheDocument();
  expect(screen.getByText('Revisor · espera al usuario')).toBeInTheDocument();
  expect(screen.getByText('- Ronda 2, Revisor: Falta el anexo.')).toBeInTheDocument();
});

it('resume una sala cerrada con su motivo', () => {
  render(<RoomRoster rooms={[room({ status: 'closed', turn: undefined, close_reason: 'completada' })]} />);
  expect(screen.getByText('Cerrada')).toBeInTheDocument();
  expect(screen.getByText('completada')).toBeInTheDocument();
});
