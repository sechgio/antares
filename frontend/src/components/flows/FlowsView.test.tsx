import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import FlowsView from './FlowsView';
import { ToastProvider } from '../../hooks/useToast';

vi.mock('./FlowList', () => ({ default: ({ onOpen }: { onOpen: (id: string) => void }) => <button onClick={() => onOpen('example')}>Abrir ejemplo</button> }));
vi.mock('./FlowEditor', () => ({ default: () => {
  const [value, setValue] = useState('');
  return <input aria-label="Borrador del paso" value={value} onChange={(e) => setValue(e.target.value)} />;
} }));
vi.mock('./ProvidersView', () => ({ default: () => <p>Configurar proveedores</p> }));

it('mantiene el borrador al visitar otra sección y regresar al editor', () => {
  render(<ToastProvider><FlowsView /></ToastProvider>);
  fireEvent.click(screen.getByText('Abrir ejemplo'));
  fireEvent.change(screen.getByLabelText('Borrador del paso'), { target: { value: 'Trabajo pendiente' } });
  fireEvent.click(screen.getByRole('button', { name: 'Proveedores IA' }));
  expect(screen.getByText('Configurar proveedores')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Flujos' }));
  expect(screen.getByLabelText('Borrador del paso')).toHaveValue('Trabajo pendiente');
});
