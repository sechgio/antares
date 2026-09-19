import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import { LayerRow } from '../editor/LayerRow';

const noops = {
  onToggleExpanded: () => {},
  onSelect: () => {},
  onStartRename: () => {},
  onRenameDraftChange: () => {},
  onCommitRename: () => {},
  onCancelRename: () => {},
  onToggleVisible: () => {},
  onToggleLocked: () => {},
  onMoveLayer: () => {},
  onDropHover: () => {},
};

describe('LayerRow ghost de drag', () => {
  it('retira el fantasma si la fila se desmonta a mitad de arrastre', () => {
    const layer = createLayer('rect');
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => ''),
      setDragImage: vi.fn(),
      effectAllowed: 'move',
      dropEffect: 'move',
    };
    const { container, unmount } = render(
      <ul>
        <LayerRow
          layer={layer}
          depth={0}
          hasChildren={false}
          expanded={false}
          selected={false}
          renaming={false}
          renameDraft=""
          dropPosition={null}
          layerRenameRef={{ current: null }}
          {...noops}
        />
      </ul>
    );
    const row = container.querySelector<HTMLElement>('.canvas-list-row')!;

    fireEvent.dragStart(row, { dataTransfer });
    expect(document.body.querySelector('.canvas-layer-drag-ghost')).not.toBeNull();

    // La lista va ventaneada: salir de la ventana de render sin dragend es lo que
    // dejaba el nodo colgado de document.body.
    unmount();
    expect(document.body.querySelector('.canvas-layer-drag-ghost')).toBeNull();
  });
});
