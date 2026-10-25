import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApprovalCard } from './AgentTimeline';

it('muestra el contexto de equipo y concede la app desde el tercer botón', () => {
  const decide = vi.fn();
  render(<ApprovalCard busy={false} onDecide={decide} approval={{
    id: 'approval-ui', session_id: 'session', call_id: 'call', method: 'ui_click',
    params: { window_id: 'w1a2b', element_id: 'e3' }, status: 'pending', created_at: 1, decided_at: null,
    context: { computer: { app: 'notepad.exe', window: 'Sin título - Bloc de notas', element: 'Edit «Búsqueda»' } },
  }} />);
  expect(screen.getByText('Aplicación: notepad.exe')).toBeInTheDocument();
  expect(screen.getByText('Ventana: Sin título - Bloc de notas')).toBeInTheDocument();
  expect(screen.getByText('Elemento: Edit «Búsqueda»')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Permitir esta acción y las siguientes sobre notepad.exe/ }));
  expect(decide).toHaveBeenCalledWith('approval-ui', true, { grantApp: true });
  fireEvent.click(screen.getByRole('button', { name: 'Permitir esta acción' }));
  expect(decide).toHaveBeenCalledWith('approval-ui', true);
});
