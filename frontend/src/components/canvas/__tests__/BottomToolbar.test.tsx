import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BottomToolbar from '../editor/BottomToolbar';

describe('BottomToolbar discoverability', () => {
  it('shows names for the primary tools while preserving accessible controls', () => {
    render(
      <div className="canvas-app">
        <BottomToolbar tool="select" onTool={vi.fn()} />
      </div>,
    );

    expect(screen.getByText('Seleccionar')).toBeVisible();
    expect(screen.getByText('Mano')).toBeVisible();
    expect(screen.getByText('Rectángulo')).toBeVisible();
    expect(screen.getByText('Texto')).toBeVisible();
    expect(screen.getByText('Campo Excel')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Seleccionar' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('canvas-toolbar-dock')).toHaveClass('top-3');
  });

  it('keeps visible labels connected to the existing tool callback', () => {
    const onTool = vi.fn();
    render(
      <div className="canvas-app">
        <BottomToolbar tool="select" onTool={onTool} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Texto' }));

    expect(onTool).toHaveBeenCalledWith('text');
  });

  it('groups less frequent insertion tools behind a Figma-like overflow menu', () => {
    const onTool = vi.fn();
    render(
      <div className="canvas-app">
        <BottomToolbar tool="select" onTool={onTool} />
      </div>,
    );

    expect(screen.queryByText('Logo')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Más herramientas' }));

    expect(screen.getByRole('menu', { name: 'Más herramientas' })).toBeVisible();
    expect(screen.getByText('Contenido')).toBeVisible();
    expect(screen.getByText('Estructura')).toBeVisible();

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Cuadrícula' }));

    expect(onTool).toHaveBeenCalledWith('grid');
    expect(screen.queryByRole('menu', { name: 'Más herramientas' })).toBeNull();
  });

  it('keeps the selected secondary tool represented in the overflow menu', () => {
    render(
      <div className="canvas-app">
        <BottomToolbar tool="grid" onTool={vi.fn()} />
      </div>,
    );

    const moreButton = screen.getByRole('button', { name: 'Más herramientas' });
    expect(moreButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(moreButton);

    expect(screen.getByRole('menuitemradio', { name: 'Cuadrícula' })).toHaveAttribute('aria-checked', 'true');
  });

  it('closes the overflow menu with Escape', () => {
    render(
      <div className="canvas-app">
        <BottomToolbar tool="select" onTool={vi.fn()} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Más herramientas' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('menu', { name: 'Más herramientas' })).toBeNull();
  });

  it('lets the user move the toolbar to the top or bottom', () => {
    const onPositionChange = vi.fn();
    const { rerender } = render(
      <div className="canvas-app">
        <BottomToolbar
          tool="select"
          onTool={vi.fn()}
          position="top"
          onPositionChange={onPositionChange}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Más herramientas' }));

    expect(screen.getByRole('menuitemradio', { name: 'Parte superior' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Parte inferior' })).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Parte inferior' }));
    expect(onPositionChange).toHaveBeenCalledWith('bottom');

    rerender(
      <div className="canvas-app">
        <BottomToolbar
          tool="select"
          onTool={vi.fn()}
          position="bottom"
          onPositionChange={onPositionChange}
        />
      </div>,
    );

    const dock = screen.getByTestId('canvas-toolbar-dock');
    expect(dock).toHaveClass('bottom-3');
    expect(dock).not.toHaveClass('top-3');
    fireEvent.click(screen.getByRole('button', { name: 'Más herramientas' }));
    expect(screen.getByRole('menu', { name: 'Más herramientas' })).toHaveStyle({
      transform: 'translate(-50%, -100%)',
    });
    expect(screen.getByRole('menuitemradio', { name: 'Parte inferior' })).toHaveAttribute('aria-checked', 'true');
  });
});
