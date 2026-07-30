import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ContextMenu, { type CanvasContextMenuState } from '../editor/ContextMenu';

function baseMenu(overrides: Partial<CanvasContextMenuState> = {}): CanvasContextMenuState {
  return {
    x: 40,
    y: 40,
    layerId: 'layer-1',
    locked: false,
    visible: true,
    isContainer: false,
    canGroup: false,
    canUngroup: false,
    canPaste: false,
    ...overrides,
  };
}

describe('ContextMenu', () => {
  it('shows Mismo tamaño para todos when canMatchGridSlotSize is true', () => {
    const onAction = vi.fn();
    render(
      <ContextMenu
        menu={baseMenu({ canMatchGridSlotSize: true })}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );
    const item = screen.getByRole('menuitem', { name: /Mismo tamaño para todos/i });
    fireEvent.click(item);
    expect(onAction).toHaveBeenCalledWith('matchGridSlotSize');
  });

  it('hides Mismo tamaño para todos when canMatchGridSlotSize is false', () => {
    render(
      <ContextMenu menu={baseMenu({ canMatchGridSlotSize: false })} onAction={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('menuitem', { name: /Mismo tamaño para todos/i })).toBeNull();
  });

  it('keeps existing actions like Copiar and Eliminar', () => {
    render(<ContextMenu menu={baseMenu()} onAction={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('menuitem', { name: /Copiar/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Eliminar/i })).toBeInTheDocument();
  });
});
