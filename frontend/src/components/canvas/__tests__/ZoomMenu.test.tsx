import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ZoomMenu from '../editor/ZoomMenu';

describe('ZoomMenu', () => {
  it('portals the open menu into .canvas-app so overflow:hidden panels do not clip it', () => {
    const { container } = render(
      <div className="canvas-app">
        <aside style={{ width: 272, overflow: 'hidden' }}>
          <ZoomMenu zoom={0.8} onZoom={vi.fn()} onZoomFit={vi.fn()} />
        </aside>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom' }));
    const menu = screen.getByTestId('canvas-zoom-menu');
    const canvasApp = container.querySelector('.canvas-app');
    expect(canvasApp).toBeTruthy();
    expect(canvasApp!.contains(menu)).toBe(true);
    expect(menu.parentElement).toBe(canvasApp);
    expect(screen.getByText('Zoom para encajar')).toBeInTheDocument();
  });

  it('closes when clicking outside the trigger and portaled menu', () => {
    render(
      <div className="canvas-app">
        <ZoomMenu zoom={1} onZoom={vi.fn()} onZoomFit={vi.fn()} />
        <button type="button">outside</button>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom' }));
    expect(screen.getByTestId('canvas-zoom-menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByTestId('canvas-zoom-menu')).toBeNull();
  });
});
