import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApprovalCard, MessageRow, ThinkingRow } from './AgentTimeline';

it('muestra cuenta y recursos revisados antes de una decisión explícita', () => {
  const decide = vi.fn();
  render(<ApprovalCard busy={false} onDecide={decide} approval={{
    id: 'approval', session_id: 'session', call_id: 'call', method: 'autoimg_sheets_write_range',
    params: { range: 'CONFIG!A1', values: [['dato']] }, status: 'pending', created_at: 1, decided_at: null,
    context: { account: 'prueba@example.com', sheet_id: 'hoja-de-prueba' },
    resources: [{ path: 'C:\\trabajos\\informe.pdf', sha256: 'revision' }],
  }} />);
  expect(screen.getByText('Cuenta: prueba@example.com')).toBeInTheDocument();
  expect(screen.getByText('Hoja: hoja-de-prueba')).toBeInTheDocument();
  expect(screen.getByText('Archivo: C:\\trabajos\\informe.pdf')).toBeInTheDocument();
  expect(decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
  expect(decide).toHaveBeenCalledWith('approval', true);
});

it('resume más de dos pasos de herramientas y los abre si alguno necesita atención', () => {
  const step = (id: string, status: string) => ({ id, name: 'templates_catalog', params: {}, status, gated: false });
  const { container, rerender } = render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1,
    tool_calls: [step('a', 'done'), step('b', 'done'), step('c', 'done')] } as never} />);
  expect(screen.getByText('3 pasos · 3 completados')).toBeInTheDocument();
  expect(container.querySelector('details')?.open).toBe(false);
  rerender(<MessageRow msg={{ role: 'assistant', content: '', ts: 1,
    tool_calls: [step('a', 'done'), step('b', 'failed'), step('c', 'done')] } as never} />);
  expect(container.querySelector('details')?.open).toBe(true);
});

it('dibuja la delegación en otro agente como una traza con sus pasos', () => {
  render(<MessageRow agent={{ seed: 'antares', name: 'Antares' }} msg={{ role: 'assistant', content: 'Listo.', ts: 1,
    tool_calls: [{
      id: 'sub', name: 'subagent_run', params: { agent: 'Investigador', task: 'Busca documentos' }, status: 'done', gated: false,
      result: JSON.stringify({
        agent: { id: 'p1', name: 'Investigador' }, status: 'done', text: 'Encontré dos.', ms: 300,
        steps: [{ name: 'canvas_list', status: 'done' }],
      }),
    }] } as never} />);
  expect(screen.getByText('Investigador')).toBeInTheDocument();
  expect(screen.getByText('Listar documentos de Canvas')).toBeInTheDocument();
  expect(screen.getByText('Encontré dos.')).toBeInTheDocument();
  expect(screen.getByText('completado')).toBeInTheDocument();
});

it('anima al agente solo durante la respuesta y mantiene un estado textual de trabajo', () => {
  const agent = { seed: 'antares', name: 'Antares' };
  const { rerender } = render(<MessageRow agent={agent} msg={{ role: 'assistant', content: 'Preparando', partial: true, ts: 1 }} />);
  expect(screen.getByRole('img', { name: 'Antares' })).toHaveAttribute('data-working', 'true');
  rerender(<MessageRow agent={agent} msg={{ role: 'assistant', content: 'Listo', ts: 1 }} />);
  expect(screen.getByRole('img', { name: 'Antares' })).toHaveAttribute('data-working', 'false');
  rerender(<ThinkingRow agent={agent} elapsedSeconds={61} />);
  expect(screen.getByRole('status')).toHaveTextContent('El agente está trabajando');
  expect(screen.getByRole('status')).toHaveTextContent('1m 1s');
});

it('muestra el razonamiento abierto mientras piensa y lo pliega al responder sin pisar la elección del usuario', () => {
  const reasoning = 'Comparo las dos plantillas';
  const { rerender } = render(<MessageRow msg={{ role: 'assistant', content: '', reasoning, partial: true, ts: 1 }} />);
  const toggle = screen.getByRole('button', { name: /Pensando/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(reasoning).closest('[aria-hidden="true"]')).toBeNull();

  rerender(<MessageRow msg={{ role: 'assistant', content: 'Usa la B', reasoning, partial: true, ts: 1 }} />);
  expect(screen.getByRole('button', { name: /Pensó/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText(reasoning).closest('[aria-hidden="true"]')).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Pensó/ }));
  rerender(<MessageRow msg={{ role: 'assistant', content: 'Usa la B', reasoning, ts: 1 }} />);
  expect(screen.getByRole('button', { name: /Pensó/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(reasoning).closest('[aria-hidden="true"]')).toBeNull();
});

it('no dibuja bloque de razonamiento cuando el modelo no lo expone', () => {
  render(<MessageRow msg={{ role: 'assistant', content: 'Listo', ts: 1 }} />);
  expect(screen.queryByRole('button', { name: /Pens/ })).toBeNull();
});

it('indica cuánto tardó en pensar', () => {
  const { rerender } = render(<MessageRow msg={{ role: 'assistant', content: 'Listo', reasoning: 'Analizo', reasoning_ms: 12_400, ts: 1 }} />);
  expect(screen.getByRole('button', { name: 'Pensó durante 12 s' })).toBeInTheDocument();
  rerender(<MessageRow msg={{ role: 'assistant', content: 'Listo', reasoning: 'Analizo', reasoning_ms: 75_000, ts: 1 }} />);
  expect(screen.getByRole('button', { name: 'Pensó durante 1 min 15 s' })).toBeInTheDocument();
  rerender(<MessageRow msg={{ role: 'assistant', content: 'Listo', reasoning: 'Analizo', ts: 1 }} />);
  expect(screen.getByRole('button', { name: 'Pensó' })).toBeInTheDocument();
});
