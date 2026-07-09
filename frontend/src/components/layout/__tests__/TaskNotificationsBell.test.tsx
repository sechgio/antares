import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskNotificationsBell from '../TaskNotificationsBell';

const refresh = vi.fn();
const useDueNotifications = vi.fn();

vi.mock('../../espacios/hooks/useDueNotifications', () => ({
  useDueNotifications: (...args: unknown[]) => useDueNotifications(...args),
}));

vi.mock('../../espacios/utils/focusTarget', () => ({
  writeEspaciosFocusTarget: vi.fn(),
}));

describe('TaskNotificationsBell', () => {
  beforeEach(() => {
    refresh.mockReset();
    useDueNotifications.mockReturnValue({
      items: [
        {
          id: 't1',
          title: 'Revisar planos',
          due_date: '2026-07-08',
          status: 'todo',
          proyecto_id: 'p1',
          proyecto_name: 'Obra A',
          espacio_id: 'e1',
          espacio_name: 'Espacio',
          daysUntil: 0,
          urgency: 'today',
        },
      ],
      count: 1,
      loading: false,
      error: null,
      refresh,
    });
  });

  it('shows badge count and opens the panel', async () => {
    render(<TaskNotificationsBell onOpenEspacios={vi.fn()} />);

    const bell = screen.getByTestId('titlebar-notifications-button');
    expect(bell).toHaveAttribute('aria-label', expect.stringContaining('1'));
    expect(screen.getByText('1')).toBeInTheDocument();

    fireEvent.click(bell);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Tareas cercanas a vencer/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Revisar planos')).toBeInTheDocument();
    expect(screen.getByText('Obra A')).toBeInTheDocument();
  });

  it('navigates to Espacios from footer action', async () => {
    const onOpenEspacios = vi.fn();
    render(<TaskNotificationsBell onOpenEspacios={onOpenEspacios} />);

    fireEvent.click(screen.getByTestId('titlebar-notifications-button'));
    fireEvent.click(await screen.findByRole('button', { name: /Ir a Espacios/i }));

    expect(onOpenEspacios).toHaveBeenCalledTimes(1);
  });
});
