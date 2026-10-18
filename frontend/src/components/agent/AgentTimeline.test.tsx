import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApprovalCard, MessageRow } from './AgentTimeline';

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
