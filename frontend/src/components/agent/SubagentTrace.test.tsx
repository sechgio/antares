import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { AgentToolCall } from '../../api/agentApi';
import SubagentTrace from './SubagentTrace';

function call(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: 'c1',
    name: 'subagent_run',
    params: { agent: 'Investigador', task: '¿Qué documentos hay?' },
    gated: false,
    status: 'done',
    result: JSON.stringify({
      agent: { id: 'p1', name: 'Investigador' },
      status: 'done',
      text: 'Hay 2 documentos.',
      steps: [
        { name: 'canvas_list', status: 'done', detail: '2 documentos' },
        { name: 'templates_catalog', status: 'failed', detail: 'sin permisos' },
      ],
      ms: 820,
    }),
    ...overrides,
  };
}

it('resume la delegación con sus pasos y la devolución del subagente', () => {
  render(<SubagentTrace call={call()} />);
  expect(screen.getByText('Investigador')).toBeInTheDocument();
  expect(screen.getByText('completado')).toBeInTheDocument();
  expect(screen.getByText('820 ms')).toBeInTheDocument();
  expect(screen.getByText('Listar documentos de Canvas')).toBeInTheDocument();
  expect(screen.getByText('Consultar las plantillas disponibles')).toBeInTheDocument();
  expect(screen.getByText('Hay 2 documentos.')).toBeInTheDocument();
  expect(screen.getByText('¿Qué documentos hay?')).toBeInTheDocument();
});

it('muestra el trabajo en curso antes de recibir el comprobante', () => {
  render(<SubagentTrace call={call({ status: 'running', result: undefined })} />);
  expect(screen.getByText('delegando')).toBeInTheDocument();
  expect(screen.queryByText(/completado/)).toBeNull();
  expect(screen.getByText('¿Qué documentos hay?')).toBeInTheDocument();
});

it('cierra sola una delegación resuelta y respeta el clic del usuario', () => {
  render(<SubagentTrace call={call()} />);
  const toggle = screen.getByRole('button', { name: 'Delegación en Investigador' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

it('expone el error del subagente y permite plegar la traza', () => {
  render(<SubagentTrace call={call({ status: 'failed', result: JSON.stringify({ error: 'El agente indicado no está disponible para delegar' }) })} />);
  expect(screen.getByText('El agente indicado no está disponible para delegar')).toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Delegación en Investigador' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
