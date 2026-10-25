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
  expect(screen.queryByText('Contrato de salida')).toBeNull();
});

it('muestra el rol del subagente y su contrato de salida validado', () => {
  render(<SubagentTrace call={call({ result: JSON.stringify({
    agent: { id: 'p1', name: 'Investigador' },
    status: 'done',
    text: 'Revisión completa.',
    steps: [],
    ms: 300,
    role: 'reviewer',
    schema_valid: true,
    output: { total: 2 },
  }) })} />);
  expect(screen.getByText('revisor')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delegación en Investigador' }));
  expect(screen.getByText('Contrato de salida')).toBeInTheDocument();
  expect(screen.getByText('validado')).toBeInTheDocument();
  expect(screen.getByText(/"total": 2/)).toBeInTheDocument();
});

it('agrupa los encargos y señala el contrato incumplido', () => {
  render(<SubagentTrace call={call({ result: JSON.stringify({
    agent: { name: 'Investigador' },
    status: 'partial',
    depth: 1,
    ms: 900,
    results: [
      {
        task: 'Revisa A', role: 'reviewer', status: 'done', text: 'A verificada',
        schema_valid: true, output: { total: 2 },
        steps: [{ name: 'canvas_list', status: 'done' }], ms: 400,
      },
      {
        task: 'Revisa B', role: 'worker', status: 'invalid', text: 'Sin contrato',
        schema_valid: false, schema_error: "total: 'dos' no es un entero", steps: [], ms: 500,
      },
    ],
  }) })} />);
  expect(screen.getByText('parcial')).toBeInTheDocument();
  expect(screen.getByText('Revisa A')).toBeInTheDocument();
  expect(screen.getByText('Revisa B')).toBeInTheDocument();
  expect(screen.getByText('revisor')).toBeInTheDocument();
  expect(screen.getByText('worker')).toBeInTheDocument();
  expect(screen.getByText('completado')).toBeInTheDocument();
  expect(screen.getByText('contrato incumplido')).toBeInTheDocument();
  expect(screen.getAllByText('Contrato de salida')).toHaveLength(2);
  expect(screen.getByText('validado')).toBeInTheDocument();
  expect(screen.getByText('incumplido')).toBeInTheDocument();
  expect(screen.getByText(/no es un entero/)).toBeInTheDocument();
  expect(screen.getByText(/"total": 2/)).toBeInTheDocument();
  expect(screen.getByText('Listar documentos de Canvas')).toBeInTheDocument();
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

it.each([['queued', 'en cola'], ['pending', 'pendiente'], ['submitted', 'enviada']] as const)(
  'no anima una delegación %s como si estuviera ejecutándose', (status, label) => {
    render(<SubagentTrace call={call({ status, result: undefined })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText('delegando')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Investigador' })).toHaveAttribute('data-working', 'false');
  },
);

it('detiene la animación al terminar y oculta el contenido plegado de la navegación', () => {
  const { rerender } = render(<SubagentTrace call={call({ status: 'running', result: undefined })} />);
  expect(screen.getByRole('img', { name: 'Investigador' })).toHaveAttribute('data-working', 'true');
  rerender(<SubagentTrace call={call()} />);
  expect(screen.getByRole('img', { name: 'Investigador' })).toHaveAttribute('data-working', 'false');
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delegación en Investigador' }));
  expect(screen.getByRole('list')).toBeVisible();
});
