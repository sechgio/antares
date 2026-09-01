import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ToastContainer from './Toast';
import { ToastProvider, useToast } from '../../hooks/useToast';

function ToastTrigger() {
  const { addToast } = useToast();
  return (
    <button type="button" onClick={() => addToast({ message: 'Guardado', type: 'success', duration: 0 })}>
      Mostrar toast
    </button>
  );
}

describe('ToastContainer', () => {
  it('announces notifications and exposes an accessible close action', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
        <ToastContainer />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar toast' }));

    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar notificación' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
