import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ToastProvider, useToast } from './useToast';

describe('useToast telemetry', () => {
  const reportRendererError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI = {
      ...window.electronAPI!,
      reportRendererError,
    };
  });

  function TestComponent({
    action,
  }: {
    action: (ctx: ReturnType<typeof useToast>) => void;
  }) {
    const toast = useToast();
    return (
      <button type="button" onClick={() => action(toast)}>
        Trigger
      </button>
    );
  }

  it('automatically reports error to telemetry when toast.type is error', () => {
    render(
      <ToastProvider>
        <TestComponent
          action={({ addToast }) =>
            addToast({
              message: 'No se pudo cargar el archivo',
              type: 'error',
            })
          }
        />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'Trigger' }).click();
    });

    expect(reportRendererError).toHaveBeenCalledTimes(1);
    expect(reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'toast_error',
        view: 'toast',
        name: 'ToastError',
        message: 'No se pudo cargar el archivo',
      }),
    );
  });

  it('preserves error instance details and custom view if provided', () => {
    const sampleError = new TypeError('Error de tipo específico');

    render(
      <ToastProvider>
        <TestComponent
          action={({ addToast }) =>
            addToast({
              message: 'Fallo en render',
              type: 'error',
              view: 'fichas_tecnicas',
              error: sampleError,
            })
          }
        />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'Trigger' }).click();
    });

    expect(reportRendererError).toHaveBeenCalledTimes(1);
    expect(reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'toast_error',
        view: 'fichas_tecnicas',
        name: 'TypeError',
        message: 'Fallo en render',
        stack: expect.stringContaining('TypeError: Error de tipo específico'),
      }),
    );
  });

  it('does not report to telemetry on success, info, or warning toasts', () => {
    render(
      <ToastProvider>
        <TestComponent
          action={({ addToast }) => {
            addToast({ message: 'Guardado con éxito', type: 'success' });
            addToast({ message: 'Información general', type: 'info' });
            addToast({ message: 'Atención con este archivo', type: 'warning' });
          }}
        />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'Trigger' }).click();
    });

    expect(reportRendererError).not.toHaveBeenCalled();
  });

  it('handles non-Error objects in error property gracefully', () => {
    render(
      <ToastProvider>
        <TestComponent
          action={({ addToast }) =>
            addToast({
              message: 'Error de cadena',
              type: 'error',
              error: { name: 'CustomErrObj', details: 'info' },
            })
          }
        />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'Trigger' }).click();
    });

    expect(reportRendererError).toHaveBeenCalledTimes(1);
    expect(reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'toast_error',
        name: 'CustomErrObj',
        message: 'Error de cadena',
      }),
    );
  });

  it('does not crash when window.electronAPI is missing reportRendererError', () => {
    window.electronAPI = undefined as unknown as typeof window.electronAPI;

    render(
      <ToastProvider>
        <TestComponent
          action={({ addToast }) =>
            addToast({
              message: 'Sin bridge',
              type: 'error',
            })
          }
        />
      </ToastProvider>,
    );

    expect(() => {
      act(() => {
        screen.getByRole('button', { name: 'Trigger' }).click();
      });
    }).not.toThrow();
  });
});
