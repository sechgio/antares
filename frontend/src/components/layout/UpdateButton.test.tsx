import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dialog from '../ui/Dialog';
import { DialogProvider } from '../../hooks/useDialog';
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

  const renderUpdateButton = () => render(
    <DialogProvider>
      <UpdateButton />
      <Dialog />
    </DialogProvider>
  );

  it('highlights the update status with a circular active theme badge when an update is available', () => {
    renderUpdateButton();

    act(() => {
      emitStatus?.({ status: 'available', version: '0.6.8', progress: 0 });
    });

    const button = screen.getByRole('button', { name: 'Actualización disponible' });
    expect(button).not.toHaveClass('bg-[var(--accent-primary)]');
    const badge = screen.getByTestId('update-status-badge');
    expect(badge).toHaveClass('rounded-full');
    expect(badge).toHaveClass('bg-[var(--accent-primary)]');
    expect(badge).toHaveClass('text-[var(--text-on-accent)]');
    expect(screen.queryByText(/Instalar/i)).not.toBeInTheDocument();
  });

  it('shows a friendlier install prompt when the update is ready', async () => {
    renderUpdateButton();

    act(() => {
      emitStatus?.({ status: 'ready', version: '0.6.8', progress: 100 });
    });

    expect(await screen.findByRole('heading', { name: 'Actualización lista' })).toBeInTheDocument();
    expect(screen.getByText(/ANTARES 0.6.8 ya se descargó/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar e instalar' }));

    await waitFor(() => expect(autoUpdateInstall).toHaveBeenCalledTimes(1));
  });
});
