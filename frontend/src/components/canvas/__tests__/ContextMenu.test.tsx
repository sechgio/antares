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
    expect(screen.getByRole('menuitem', { name: /^CopiarCtrl\+C$/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Eliminar/i })).toBeInTheDocument();
  });

  it('shows Seleccionar contenedor when the layer has a parent', () => {
    const onAction = vi.fn();
    render(
      <ContextMenu menu={baseMenu({ hasParent: true })} onAction={onAction} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Seleccionar contenedor/i }));
    expect(onAction).toHaveBeenCalledWith('selectParent');
  });

  it('renders a page submenu and emits moveToPage with the index', () => {
    const onAction = vi.fn();
    render(
      <ContextMenu
        menu={baseMenu({
          pageTargets: [
            { index: 0, label: 'Portada' },
            { index: 2, label: 'Anexos' },
          ],
        })}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('menuitem', { name: /Mover a página/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Anexos' }));
    expect(onAction).toHaveBeenCalledWith('moveToPage', 2);
  });

  it('renders layers under cursor submenu and emits selectUnderCursor with the id', () => {
    const onAction = vi.fn();
    render(
      <ContextMenu
        menu={baseMenu({
          underCursor: [
            { id: 'l1', name: 'Foto' },
            { id: 'l2', name: 'Marco' },
          ],
        })}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Marco' }));
    expect(onAction).toHaveBeenCalledWith('selectUnderCursor', 'l2');
  });

  it('disables Pegar propiedades without a props clipboard', () => {
    render(
      <ContextMenu menu={baseMenu({ canPasteProps: false })} onAction={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('menuitem', { name: /Pegar propiedades/i })).toBeDisabled();
  });
});
