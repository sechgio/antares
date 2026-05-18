import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UpdateButton from './UpdateButton';

type UpdateStatusPayload = {
  status: string;
  version: string | null;
  progress: number;
};

describe('UpdateButton', () => {
  let emitStatus: ((payload: UpdateStatusPayload) => void) | null;
  let autoUpdateInstall: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    emitStatus = null;
    autoUpdateInstall = vi.fn(async () => ({ success: true }));

    window.electronAPI = {
      ...window.electronAPI!,
      autoUpdateCheck: vi.fn(async () => ({ success: true })),
      autoUpdateInstall,
      onAutoUpdateStatus: (callback) => {
        emitStatus = callback;
        return () => {};
      },
    };
  });

  it('highlights the whole button with the active theme accent when an update is available', () => {
    render(<UpdateButton />);

    act(() => {
      emitStatus?.({ status: 'available', version: '0.6.8', progress: 0 });
    });

    const button = screen.getByRole('button', { name: 'Actualización disponible' });
    expect(button).toHaveClass('bg-[var(--accent-primary)]');
    expect(button).toHaveClass('text-[var(--text-on-accent)]');
    expect(screen.queryByText(/Instalar/i)).not.toBeInTheDocument();
  });

  it('keeps the ready state icon-only and installs when clicked', () => {
    render(<UpdateButton />);

    act(() => {
      emitStatus?.({ status: 'ready', version: '0.6.8', progress: 100 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Actualización lista para instalar' }));

    expect(autoUpdateInstall).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Instalar/i)).not.toBeInTheDocument();
  });
});
