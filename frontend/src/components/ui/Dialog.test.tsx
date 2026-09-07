import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Dialog from './Dialog';

vi.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({
    isOpen: true,
    options: {
      title: 'Eliminar panel',
      description: 'Se eliminará este panel y sus imágenes.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    },
    closeDialog: vi.fn(),
  }),
}));

vi.mock('../../hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn() }));

describe('Dialog', () => {
  it('does not render an outer halo around the dialog', () => {
    render(<Dialog />);

    expect(screen.getByTestId('app-dialog').style.boxShadow).toBe('');
  });
});
