import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import Artboard from '../editor/Artboard';
import { createEmptyDocument, type CanvasLayer } from '../types';

function rectAt(id: string, xMm: number, yMm: number, parentId?: string): CanvasLayer {
  return createLayer('rect', {
    id,
    parentId,
    cssVars: {
      ...createLayer('rect').cssVars,
      '--translate-x': `${xMm}mm`,
      '--translate-y': `${yMm}mm`,
      '--width': '50mm',
      '--height': '50mm',
    },
  });
}

function setup(
  layers: CanvasLayer[],
  selectedIds: string[],
  extra: Partial<Parameters<typeof Artboard>[0]> = {},
) {
  const document = createEmptyDocument('Test');
  document.layers.push(...layers);
  const onSelect = vi.fn();
  const onSelectIds = vi.fn();
  const utils = render(
    <Artboard
      document={document}
      selectedIds={selectedIds}
      zoom={1}
      tool="select"
      pan={{ x: 0, y: 0 }}
      onPan={() => {}}
      onSelect={onSelect}
      onSelectIds={onSelectIds}
      onChangeLayers={() => {}}
      {...extra}
    />,
  );
  const nodeOf = (id: string) =>
    utils.container.querySelector<HTMLElement>(`[data-layer-id="${id}"]`)!;
  return { ...utils, onSelect, onSelectIds, nodeOf };
}

describe('Artboard deep select', () => {
  it('Ctrl+click selects the topmost unselected layer under the cursor', () => {
    const below = rectAt('below', 10, 10);
    const top = rectAt('top', 10, 10);
    const { onSelect, nodeOf } = setup([below, top], [top.id]);

    fireEvent.pointerDown(nodeOf('top'), { button: 0, clientX: 100, clientY: 100, ctrlKey: true });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100, ctrlKey: true });

    expect(onSelect).toHaveBeenCalledWith('below', false);
  });

  it('plain click still selects the clicked layer', () => {
    const below = rectAt('below', 10, 10);
    const top = rectAt('top', 10, 10);
    const { onSelect, nodeOf } = setup([below, top], []);

    fireEvent.pointerDown(nodeOf('top'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });

    expect(onSelect).toHaveBeenCalledWith('top', false);
  });
});

describe('Artboard group isolation (enter group)', () => {
  function withGroup() {
    const group = createLayer('group', {
      id: 'g1',
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '50mm',
        '--height': '50mm',
      },
    });
    const child = rectAt('child', 15, 15, 'g1');
    const outsider = rectAt('outsider', 10, 10);
    return { group, child, outsider };
  }

  it('click inside selects only descendants of the entered group', () => {
    const { group, child, outsider } = withGroup();
    const { onSelect, nodeOf } = setup([group, child, outsider], [], {
      enteredGroupId: 'g1',
      onExitGroupEdit: vi.fn(),
    });

    fireEvent.pointerDown(nodeOf('outsider'), { button: 0, clientX: 80, clientY: 80 });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 80 });

    expect(onSelect).toHaveBeenCalledWith('child', false);
  });

  it('click outside the group exits isolation and deselects', () => {
    const { group, child, outsider } = withGroup();
    const onExitGroupEdit = vi.fn();
    const { onSelectIds, nodeOf } = setup([group, child, outsider], [child.id], {
      enteredGroupId: 'g1',
      onExitGroupEdit,
    });

    fireEvent.pointerDown(nodeOf('outsider'), { button: 0, clientX: 700, clientY: 700 });
    fireEvent.pointerUp(window, { clientX: 700, clientY: 700 });

    expect(onExitGroupEdit).toHaveBeenCalled();
    expect(onSelectIds).toHaveBeenCalledWith([]);
  });
});

describe('Artboard eyedropper', () => {
  it('samples the fill of the topmost layer under the cursor', () => {
    const layer = rectAt('a', 10, 10);
    layer.cssVars['--background-color'] = '#112233';
    const onEyedropperPick = vi.fn();
    const { nodeOf } = setup([layer], [layer.id], {
      eyedropperActive: true,
      onEyedropperPick,
    });

    fireEvent.pointerDown(nodeOf('a'), { button: 0, clientX: 100, clientY: 100 });
    expect(onEyedropperPick).toHaveBeenCalledWith('#112233');
  });

  it('samples page white on empty canvas', () => {
    const onEyedropperPick = vi.fn();
    const { container } = setup([], [], {
      eyedropperActive: true,
      onEyedropperPick,
    });
    const frame = container.querySelector<HTMLElement>('[data-testid="canvas-artboard"]')!;
    fireEvent.pointerDown(frame, { button: 0, clientX: 500, clientY: 500 });
    expect(onEyedropperPick).toHaveBeenCalledWith('#FFFFFF');
  });
});
