import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TitleBar from './TitleBar';
import { DialogProvider } from '../../hooks/useDialog';

function renderTitleBar() {
  return render(
    <DialogProvider>
      <TitleBar />
    </DialogProvider>,
  );
}

describe('TitleBar', () => {
  it('renders the Spanish app menu and themed titlebar container', () => {
    renderTitleBar();

    const titlebar = screen.getByTestId('app-titlebar');
    expect(titlebar).toHaveClass('bg-[var(--bg-surface)]');
    expect(titlebar).toHaveClass('text-[var(--text-secondary)]');

    for (const label of ['Archivo', 'Editar', 'Ver', 'Ventana', 'Ayuda']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('calls Electron window controls from the custom buttons', () => {
    const minimizeWindow = vi.fn(async () => ({}));
    const maximizeWindow = vi.fn(async () => ({}));
    const closeWindow = vi.fn(async () => ({}));

    const electronAPI = window.electronAPI!;
    window.electronAPI = {
      ...electronAPI,
      minimizeWindow,
      maximizeWindow,
      closeWindow,
    };

    renderTitleBar();

    fireEvent.click(screen.getByRole('button', { name: 'Minimizar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maximizar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(minimizeWindow).toHaveBeenCalledTimes(1);
    expect(maximizeWindow).toHaveBeenCalledTimes(1);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('opens Electron menus from the Spanish menu buttons', () => {
    const showAppMenu = vi.fn(async () => ({}));
    const electronAPI = window.electronAPI!;
    window.electronAPI = {
      ...electronAPI,
      showAppMenu,
    };

    renderTitleBar();

    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));

    expect(showAppMenu).toHaveBeenCalledWith(2, expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });
});
