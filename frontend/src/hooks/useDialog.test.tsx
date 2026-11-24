import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { DialogProvider, useDialog } from './useDialog';
import Dialog from '../components/ui/Dialog';

function Harness({ onResult }: { onResult: (value: boolean) => void }): ReactNode {
  const { confirm } = useDialog();
  return (
    <button
      type="button"
      onClick={() => {
        void confirm({ title: '¿Salir sin guardar cambios?' }).then(onResult);
      }}
    >
      abrir
    </button>
  );
}

function setup(onResult: (value: boolean) => void) {
  return render(
    <DialogProvider>
      <Harness onResult={onResult} />
      <Dialog />
    </DialogProvider>,
  );
}

describe('ui/Dialog promise resolution', () => {
  it('resolves false when Escape closes the dialog', async () => {
    const results: boolean[] = [];
    setup((value) => results.push(value));

    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    expect(await screen.findByTestId('app-dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(results).toEqual([false]));
  });

  it('resolves false when the overlay is clicked', async () => {
    const results: boolean[] = [];
    setup((value) => results.push(value));

    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    fireEvent.click(await screen.findByTestId('app-dialog-overlay'));

    await waitFor(() => expect(results).toEqual([false]));
  });

  it('resolves true when the confirm button is pressed', async () => {
    const results: boolean[] = [];
    setup((value) => results.push(value));

    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar' }));

    await waitFor(() => expect(results).toEqual([true]));
  });

  it('resolves false when the cancel button is pressed', async () => {
    const results: boolean[] = [];
    setup((value) => results.push(value));

    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(results).toEqual([false]));
  });

  it('keeps the dialog hidden and inert during its exit animation, then unmounts it', async () => {
    setup(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    const overlay = screen.getByTestId('app-dialog-overlay');
    expect(overlay).toHaveAttribute('data-closing', 'true');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('app-dialog-overlay')).not.toBeInTheDocument());
  });
});
