import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApprovalCard } from './AgentTimeline';

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
