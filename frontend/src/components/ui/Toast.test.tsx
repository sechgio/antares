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

  it('renders a compact pill below the titlebar so it does not cover window or modal close controls', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
        <ToastContainer />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar toast' }));

    const container = screen.getByTestId('app-toast-container');
    const toast = screen.getByTestId('app-toast');

    expect(container).toHaveClass('top-20');
    expect(container).toHaveClass('right-4');
    expect(container).toHaveClass('items-end');
    expect(toast).toHaveClass('items-center');
    expect(toast).toHaveClass('rounded-full');
    expect(toast).not.toHaveClass('items-start');
    expect(toast).not.toHaveClass('min-w-[280px]');
    expect(toast.className).toContain('bg-[var(--bg-elevated)]');
    expect(toast.className).toContain('text-[var(--text-primary)]');
  });

  it('keeps error and info alerts on the same appearance pill', () => {
    function TypedTriggers() {
      const { addToast } = useToast();
      return (
        <>
          <button type="button" onClick={() => addToast({ message: 'Falló', type: 'error', duration: 0 })}>
            Error
          </button>
          <button type="button" onClick={() => addToast({ message: 'Listo', type: 'info', duration: 0 })}>
            Info
          </button>
        </>
      );
    }

    render(
      <ToastProvider>
        <TypedTriggers />
        <ToastContainer />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Error' }));
    fireEvent.click(screen.getByRole('button', { name: 'Info' }));

    const [errorToast, infoToast] = screen.getAllByTestId('app-toast');
    expect(errorToast).toHaveAttribute('role', 'alert');
    expect(infoToast).toHaveAttribute('role', 'status');
    expect(errorToast).toHaveClass('rounded-full');
    expect(infoToast).toHaveClass('rounded-full');
  });
});
