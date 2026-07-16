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
  it('renders the themed titlebar container', () => {
    renderTitleBar();

    const titlebar = screen.getByTestId('app-titlebar');
    expect(titlebar).toHaveClass('bg-[var(--bg-surface)]');
    expect(titlebar).toHaveClass('text-[var(--text-secondary)]');
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

  it('renders settings with hover tooltip and no native title', () => {
    render(
      <DialogProvider>
        <TitleBar onOpenSettings={vi.fn()} />
      </DialogProvider>,
    );

    const settings = screen.getByTestId('titlebar-settings-button');
    expect(settings).not.toHaveAttribute('title');
    expect(screen.getByText('Configuración')).toBeInTheDocument();
  });

  it('renders window control hover tooltips without native titles', () => {
    renderTitleBar();

    for (const name of ['Minimizar', 'Maximizar', 'Cerrar'] as const) {
      const button = screen.getByRole('button', { name });
      expect(button).not.toHaveAttribute('title');
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
