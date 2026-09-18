import { describe, expect, it, vi } from 'vitest';
import {
  createCanvasContextActionHandler,
  type CanvasContextActionsInput,
} from '../hooks/canvasContextActions';
import type { CanvasContextMenuState } from '../editor/ContextMenu';
import { createLayer } from '../constants';
import { createEmptyDocument, type CanvasDocument, type CanvasLayer } from '../types';

function makeDoc(layers: CanvasLayer[]): CanvasDocument {
  const doc = createEmptyDocument('test');
  return { ...doc, layers: [...doc.layers, ...layers] };
}

function menu(layerId: string | null): CanvasContextMenuState {
  return {
    x: 0,
    y: 0,
    layerId,
    locked: false,
    visible: true,
    isContainer: false,
    canGroup: false,
    canUngroup: false,
    canPaste: true,
  };
}

function makeInput(doc: CanvasDocument, overrides: Partial<CanvasContextActionsInput> = {}) {
  const input: CanvasContextActionsInput = {
    contextMenu: null,
    selectedIds: [],
    pageLayers: doc.layers.filter((l) => (l.pageIndex ?? 0) === 0),
    document: doc,
    setDocument: vi.fn(),
    pasteClipboard: vi.fn(),
    pasteReplaceClipboard: vi.fn(),
    copyLayersToClipboard: vi.fn(),
    sealPanelAndAbortGesture: vi.fn(),
    startContainerOrInlineEdit: vi.fn(),
    setSelectedIds: vi.fn(),
    setEyedropperActive: vi.fn(),
    setAllLayers: vi.fn(),
    propsClipboardRef: { current: null },
    ...overrides,
  };
  return input;
}

describe('createCanvasContextActionHandler', () => {
  it('paste y pasteInPlace llaman pasteClipboard con y sin offset', () => {
    const input = makeInput(makeDoc([]));
    const run = createCanvasContextActionHandler(input);
    run('paste');
    run('pasteInPlace');
    expect(vi.mocked(input.pasteClipboard).mock.calls.map((c) => c[0])).toEqual([
      undefined,
      0,
    ]);
  });

  it('selectUnderCursor selecciona la capa del arg y no selecciona ids inexistentes', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc);
    const run = createCanvasContextActionHandler(input);
    run('selectUnderCursor', a.id);
    expect(input.setSelectedIds).toHaveBeenCalledWith([a.id]);
    run('selectUnderCursor', 'no-existe');
    expect(input.setSelectedIds).toHaveBeenCalledTimes(1);
  });

  it('eyedropper selecciona la capa si no estaba seleccionada y activa el modo', () => {
    const a = createLayer('rect');
    const input = makeInput(makeDoc([a]), { contextMenu: menu(a.id), selectedIds: [] });
    createCanvasContextActionHandler(input)('eyedropper');
    expect(input.setSelectedIds).toHaveBeenCalledWith([a.id]);
    expect(input.setEyedropperActive).toHaveBeenCalledWith(true);
  });

  it('sin layerId las acciones de capa no hacen nada', () => {
    const input = makeInput(makeDoc([]), { contextMenu: menu(null) });
    const run = createCanvasContextActionHandler(input);
    for (const action of ['edit', 'copy', 'duplicate', 'delete', 'toggleLock'] as const) {
      run(action);
    }
    expect(input.setAllLayers).not.toHaveBeenCalled();
    expect(input.copyLayersToClipboard).not.toHaveBeenCalled();
    expect(input.startContainerOrInlineEdit).not.toHaveBeenCalled();
  });

  it('copy incluye descendientes de la selección', () => {
    const group = createLayer('group');
    const child = { ...createLayer('rect'), parentId: group.id };
    const doc = makeDoc([group, child]);
    const input = makeInput(doc, { contextMenu: menu(group.id) });
    createCanvasContextActionHandler(input)('copy');
    const copied = vi.mocked(input.copyLayersToClipboard).mock.calls[0][0] as CanvasLayer[];
    expect(copied.map((l) => l.id).sort()).toEqual([child.id, group.id].sort());
  });

  it('copyProps guarda vars y pasteProps las aplica al target', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const doc = makeDoc([a, b]);
    const input = makeInput(doc, { contextMenu: menu(a.id) });
    createCanvasContextActionHandler(input)('copyProps');
    expect(input.propsClipboardRef.current).toBeTruthy();

    const input2 = makeInput(doc, { contextMenu: menu(b.id) });
    input2.propsClipboardRef.current = input.propsClipboardRef.current;
    createCanvasContextActionHandler(input2)('pasteProps');
    expect(input2.sealPanelAndAbortGesture).toHaveBeenCalled();
    expect(input2.setAllLayers).toHaveBeenCalledTimes(1);
  });

  it('pasteProps sin props copiadas no toca capas', () => {
    const a = createLayer('rect');
    const input = makeInput(makeDoc([a]), { contextMenu: menu(a.id) });
    createCanvasContextActionHandler(input)('pasteProps');
    expect(input.setAllLayers).not.toHaveBeenCalled();
  });

  it('toggleLock invierte el lock aunque la capa esté bloqueada', () => {
    const a = createLayer('rect', { locked: true });
    const input = makeInput(makeDoc([a]), { contextMenu: menu(a.id) });
    createCanvasContextActionHandler(input)('toggleLock');
    const layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(layers.find((l) => l.id === a.id)!.locked).toBe(false);
  });

  it('toggleVisible invierte visible', () => {
    const a = createLayer('rect', { visible: false });
    const input = makeInput(makeDoc([a]), { contextMenu: menu(a.id) });
    createCanvasContextActionHandler(input)('toggleVisible');
    const layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(layers.find((l) => l.id === a.id)!.visible).toBe(true);
  });

  it('capa bloqueada bloquea acciones destructivas pero no toggleLock', () => {
    const a = createLayer('rect', { locked: true });
    const input = makeInput(makeDoc([a]), { contextMenu: menu(a.id) });
    const run = createCanvasContextActionHandler(input);
    for (const action of ['duplicate', 'delete', 'bringFront'] as const) {
      run(action);
    }
    expect(input.setAllLayers).not.toHaveBeenCalled();
    run('toggleLock');
    expect(input.setAllLayers).toHaveBeenCalledTimes(1);
  });

  it('selectParent selecciona el padre y selectChildren los hijos', () => {
    const group = createLayer('group');
    const child = { ...createLayer('rect'), parentId: group.id };
    const doc = makeDoc([group, child]);
    const input = makeInput(doc, { contextMenu: menu(child.id) });
    createCanvasContextActionHandler(input)('selectParent');
    expect(input.setSelectedIds).toHaveBeenCalledWith([group.id]);

    const input2 = makeInput(doc, { contextMenu: menu(group.id) });
    createCanvasContextActionHandler(input2)('selectChildren');
    expect(input2.setSelectedIds).toHaveBeenCalledWith([child.id]);
  });

  it('group agrupa la selección completa cuando el contexto está seleccionado', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const doc = makeDoc([a, b]);
    const input = makeInput(doc, {
      contextMenu: menu(a.id),
      selectedIds: [a.id, b.id],
    });
    createCanvasContextActionHandler(input)('group');
    const layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    const group = layers.find((l) => l.type === 'group')!;
    expect(group).toBeDefined();
    expect(input.setSelectedIds).toHaveBeenCalledWith([group.id]);
  });

  it('group con contexto fuera de la selección solo usa el contexto y no agrupa', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const doc = makeDoc([a, b]);
    const input = makeInput(doc, {
      contextMenu: menu(a.id),
      selectedIds: [b.id],
    });
    createCanvasContextActionHandler(input)('group');
    expect(input.setAllLayers).not.toHaveBeenCalled();
  });

  it('ungroup solo actúa sobre grupos', () => {
    const a = createLayer('rect');
    const input = makeInput(makeDoc([a]), { contextMenu: menu(a.id) });
    createCanvasContextActionHandler(input)('ungroup');
    expect(input.setAllLayers).not.toHaveBeenCalled();
  });

  it('duplicate duplica los roots editables y selecciona las copias', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { contextMenu: menu(a.id), selectedIds: [a.id] });
    createCanvasContextActionHandler(input)('duplicate');
    const layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(layers.length).toBe(doc.layers.length + 1);
    const newIds = vi.mocked(input.setSelectedIds).mock.calls[0][0] as string[];
    expect(newIds[0]).not.toBe(a.id);
  });

  it('delete sobre una capa seleccionada elimina toda la selección', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const doc = makeDoc([a, b]);
    const input = makeInput(doc, {
      contextMenu: menu(a.id),
      selectedIds: [a.id, b.id],
    });
    createCanvasContextActionHandler(input)('delete');
    const layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(layers.find((l) => l.id === a.id)).toBeUndefined();
    expect(layers.find((l) => l.id === b.id)).toBeUndefined();
    const filterFn = vi.mocked(input.setSelectedIds).mock.calls[0][0] as (ids: string[]) => string[];
    expect(filterFn([a.id, b.id])).toEqual([]);
  });

  it('delete sobre una capa fuera de la selección solo la elimina a ella', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const doc = makeDoc([a, b]);
    const input = makeInput(doc, {
      contextMenu: menu(a.id),
      selectedIds: [b.id],
    });
    createCanvasContextActionHandler(input)('delete');
    const layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(layers.find((l) => l.id === a.id)).toBeUndefined();
    expect(layers.find((l) => l.id === b.id)).toBeDefined();
    const filterFn = vi.mocked(input.setSelectedIds).mock.calls[0][0] as (ids: string[]) => string[];
    expect(filterFn([b.id])).toEqual([b.id]);
  });

  it('pasteToReplace pasa el id cuando no está seleccionado', () => {
    const a = createLayer('rect');
    const input = makeInput(makeDoc([a]), { contextMenu: menu(a.id), selectedIds: [] });
    createCanvasContextActionHandler(input)('pasteToReplace');
    expect(input.pasteReplaceClipboard).toHaveBeenCalledWith([a.id]);
  });

  it('edit delega en startContainerOrInlineEdit', () => {
    const a = createLayer('text');
    const input = makeInput(makeDoc([a]), { contextMenu: menu(a.id) });
    createCanvasContextActionHandler(input)('edit');
    expect(input.startContainerOrInlineEdit).toHaveBeenCalledWith(a.id);
  });
});
