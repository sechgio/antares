import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCanvasKeyboard, type CanvasKeyboardInput } from '../hooks/useCanvasKeyboard';
import { createLayer } from '../constants';
import { createEmptyDocument, type CanvasDocument, type CanvasLayer } from '../types';

interface FakeKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

function keyEvent(overrides: Partial<FakeKeyEvent> = {}): FakeKeyEvent {
  const e: FakeKeyEvent = {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    target: null,
    defaultPrevented: false,
    preventDefault: () => {
      e.defaultPrevented = true;
    },
    ...overrides,
  };
  return e;
}

function makeDoc(layers: CanvasLayer[]): CanvasDocument {
  const doc = createEmptyDocument('test');
  return { ...doc, layers: [...doc.layers, ...layers] };
}

function makeInput(doc: CanvasDocument, overrides: Partial<CanvasKeyboardInput> = {}) {
  const input: CanvasKeyboardInput = {
    onKeyDownRef: { current: () => {} },
    mode: 'design',
    isTemplatePickerOpen: false,
    paletteOpen: false,
    pathEditingLayerId: null,
    editingLayerId: null,
    eyedropperActive: false,
    previewOpen: false,
    enteredGroupId: null,
    tool: 'select',
    pageIndex: 0,
    selectedIds: [],
    pageLayers: doc.layers.filter((l) => (l.pageIndex ?? 0) === 0),
    document: doc,
    setDocument: vi.fn(),
    setAllLayers: vi.fn(),
    nudgeLayersLive: vi.fn(),
    setSelectedIds: vi.fn(),
    setTool: vi.fn(),
    setRenameRequest: vi.fn(),
    setPaletteOpen: vi.fn(),
    setShowShortcuts: vi.fn(),
    setEyedropperActive: vi.fn(),
    setContextMenu: vi.fn(),
    setPathEditingLayerId: vi.fn(),
    setPreviewOpen: vi.fn(),
    setEnteredGroupId: vi.fn(),
    setGestureAbortToken: vi.fn(),
    commitInlineEdit: vi.fn(),
    startInlineEdit: vi.fn(),
    onInlineEditValue: vi.fn(),
    onInlineEditStyle: vi.fn(),
    startContainerOrInlineEdit: vi.fn(),
    runUndo: vi.fn(),
    runRedo: vi.fn(),
    copyLayersToClipboard: vi.fn(),
    pasteClipboard: vi.fn(),
    pasteReplaceClipboard: vi.fn(),
    sealPanelAndAbortGesture: vi.fn(),
    cancelPageLayersGesture: vi.fn(),
    onPanelCommitLive: vi.fn(),
    toggleBothPanels: vi.fn(),
    zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(),
    onSave: vi.fn(),
    propsClipboardRef: { current: null },
    toolBeforeSpaceRef: { current: null },
    viewportNavRef: { current: null },
    gestureBaselineRef: { current: null },
    panelBaselineRef: { current: null },
    ...overrides,
  };
  return input;
}

function press(input: CanvasKeyboardInput, overrides: Partial<FakeKeyEvent>) {
  const e = keyEvent(overrides);
  input.onKeyDownRef.current(e as unknown as KeyboardEvent);
  return e;
}

describe('useCanvasKeyboard', () => {
  it('ignora atajos fuera de modo design o con overlays abiertos', () => {
    const text = createLayer('text');
    const doc = makeDoc([text]);
    for (const guard of [
      { mode: 'generate' as const },
      { paletteOpen: true },
      { isTemplatePickerOpen: true },
    ]) {
      const input = makeInput(doc, { selectedIds: [text.id], ...guard });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'd', code: 'KeyD', ctrlKey: true });
      expect(input.setAllLayers).not.toHaveBeenCalled();
    }
  });

  it('Ctrl+D duplica capas editables y selecciona las copias', () => {
    const text = createLayer('text');
    const doc = makeDoc([text]);
    const input = makeInput(doc, { selectedIds: [text.id] });
    renderHook(() => useCanvasKeyboard(input));
    const e = press(input, { key: 'd', code: 'KeyD', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    const newLayers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(newLayers).toHaveLength(doc.layers.length + 1);
    const newIds = vi.mocked(input.setSelectedIds).mock.calls[0][0] as string[];
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe(text.id);
  });

  it('Ctrl+D no hace nada cuando la selección solo tiene capas no editables', () => {
    const locked = createLayer('rect', { locked: true });
    const doc = makeDoc([locked]);
    const input = makeInput(doc, { selectedIds: [locked.id, doc.layers[0].id] });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'd', code: 'KeyD', ctrlKey: true });
    expect(input.setAllLayers).not.toHaveBeenCalled();
    expect(input.setSelectedIds).not.toHaveBeenCalled();
  });

  it('Ctrl+G agrupa dos capas y selecciona el grupo', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const doc = makeDoc([a, b]);
    const input = makeInput(doc, { selectedIds: [a.id, b.id] });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'g', code: 'KeyG', ctrlKey: true });
    const newLayers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    const group = newLayers.find((l) => l.type === 'group');
    expect(group).toBeDefined();
    expect(newLayers.find((l) => l.id === a.id)?.parentId).toBe(group!.id);
    expect(vi.mocked(input.setSelectedIds).mock.calls[0][0]).toEqual([group!.id]);
  });

  it('Ctrl+G con una sola capa no agrupa', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'g', code: 'KeyG', ctrlKey: true });
    expect(input.setAllLayers).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+G desagrupa un grupo seleccionado', () => {
    const a = createLayer('rect');
    const group = createLayer('group');
    const child = { ...a, parentId: group.id };
    const doc = makeDoc([group, child]);
    const input = makeInput(doc, { selectedIds: [group.id] });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'G', code: 'KeyG', ctrlKey: true, shiftKey: true });
    const newLayers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(newLayers.find((l) => l.id === group.id)).toBeUndefined();
    expect(newLayers.find((l) => l.id === child.id)?.parentId).toBeUndefined();
  });

  it('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y disparan undo/redo', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc);
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'z', code: 'KeyZ', ctrlKey: true });
    press(input, { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    press(input, { key: 'y', code: 'KeyY', ctrlKey: true });
    expect(input.runUndo).toHaveBeenCalledTimes(1);
    expect(input.runRedo).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+K alterna la paleta de comandos', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc);
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'k', code: 'KeyK', ctrlKey: true });
    const updater = vi.mocked(input.setPaletteOpen).mock.calls[0][0] as (v: boolean) => boolean;
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);
  });

  it('Delete elimina capas editables y limpia la selección', () => {
    const a = createLayer('rect');
    const locked = createLayer('ellipse', { locked: true });
    const doc = makeDoc([a, locked]);
    const input = makeInput(doc, { selectedIds: [a.id, locked.id] });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'Delete' });
    const newLayers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(newLayers.find((l) => l.id === a.id)).toBeUndefined();
    expect(newLayers.find((l) => l.id === locked.id)).toBeDefined();
    expect(vi.mocked(input.setSelectedIds).mock.calls[0][0]).toEqual([]);
  });

  it('flechas mueven la selección con pasos de 1 / 10 / 0.1', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'ArrowRight' });
    press(input, { key: 'ArrowDown', shiftKey: true });
    press(input, { key: 'ArrowLeft', altKey: true });
    expect(vi.mocked(input.nudgeLayersLive).mock.calls).toEqual([
      [[a.id], 1, 0],
      [[a.id], 0, 10],
      [[a.id], -0.1, 0],
    ]);
  });

  it('teclas de herramienta cambian la herramienta activa', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc);
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 't' });
    press(input, { key: 'r' });
    press(input, { key: 'h' });
    expect(vi.mocked(input.setTool).mock.calls.map((c) => c[0])).toEqual(['text', 'rect', 'hand']);
  });

  it('ignora teclas de herramienta cuando el target es editable', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc);
    renderHook(() => useCanvasKeyboard(input));
    const field = document.createElement('input');
    press(input, { key: 't', target: field });
    expect(input.setTool).not.toHaveBeenCalled();
  });

  it('Space cambia a hand y recuerda la herramienta previa', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc, { tool: 'rect' });
    renderHook(() => useCanvasKeyboard(input));
    const e = press(input, { key: ' ', code: 'Space' });
    expect(e.defaultPrevented).toBe(true);
    expect(input.toolBeforeSpaceRef.current).toBe('rect');
    expect(input.setTool).toHaveBeenCalledWith('hand');
  });

  it('Ctrl+S guarda', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc);
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 's', ctrlKey: true });
    expect(input.onSave).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+A selecciona capas desbloqueadas no-frame de la página', () => {
    const a = createLayer('rect');
    const locked = createLayer('ellipse', { locked: true });
    const otherPage = createLayer('text', { pageIndex: 1 });
    const doc = makeDoc([a, locked, otherPage]);
    const input = makeInput(doc, {
      pageLayers: doc.layers.filter((l) => (l.pageIndex ?? 0) === 0),
    });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'a', ctrlKey: true });
    expect(vi.mocked(input.setSelectedIds).mock.calls[0][0]).toEqual([a.id]);
  });

  it('Escape sale del grupo entrado y lo selecciona', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc, { enteredGroupId: 'g1' });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'Escape' });
    expect(input.setEnteredGroupId).toHaveBeenCalledWith(null);
    expect(input.setSelectedIds).toHaveBeenCalledWith(['g1']);
  });

  it('Escape limpia la selección cuando no hay contexto superior', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'Escape' });
    expect(input.setSelectedIds).toHaveBeenCalledWith([]);
    expect(input.setContextMenu).toHaveBeenCalledWith(null);
  });

  it('F2 solicita renombrar la única capa editable seleccionada', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: 'F2' });
    const updater = vi.mocked(input.setRenameRequest).mock.calls[0][0] as (
      prev: { layerId: string; nonce: number } | null,
    ) => { layerId: string; nonce: number };
    expect(updater(null)).toEqual({ layerId: a.id, nonce: 1 });
  });

  it('Shift+1 y Shift+2 activan zoomToFit / zoomToSelection', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc);
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: '!', code: 'Digit1', shiftKey: true });
    press(input, { key: '"', code: 'Digit2', shiftKey: true });
    expect(input.zoomToFit).toHaveBeenCalledTimes(1);
    expect(input.zoomToSelection).toHaveBeenCalledTimes(1);
  });

  it('escribir con una sola capa de texto seleccionada inicia edición inline', () => {
    const text = createLayer('text');
    const doc = makeDoc([text]);
    const input = makeInput(doc, { selectedIds: [text.id] });
    renderHook(() => useCanvasKeyboard(input));
    const e = press(input, { key: 'x' });
    expect(e.defaultPrevented).toBe(true);
    expect(input.startInlineEdit).toHaveBeenCalledWith(text.id, { seed: 'x' });
  });

  it('Ctrl+] y Ctrl+[ reordenan la capa seleccionada', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const doc = makeDoc([a, b]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    renderHook(() => useCanvasKeyboard(input));
    press(input, { key: ']', ctrlKey: true });
    const raised = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(raised.findIndex((l) => l.id === a.id)).toBeGreaterThan(
      doc.layers.findIndex((l) => l.id === a.id),
    );
    press(input, { key: '[', ctrlKey: true });
    expect(input.sealPanelAndAbortGesture).toHaveBeenCalledTimes(2);
  });

  describe('edición inline activa', () => {
    function editingInput(doc: CanvasDocument) {
      return makeInput(doc, { editingLayerId: 'edit-1' });
    }

    it('Escape confirma la edición', () => {
      const doc = makeDoc([]);
      const input = editingInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'Escape' });
      expect(input.commitInlineEdit).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+B / Ctrl+I / Ctrl+U aplican estilo inline', () => {
      const doc = makeDoc([]);
      const input = editingInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'b', ctrlKey: true });
      press(input, { key: 'i', ctrlKey: true });
      press(input, { key: 'u', ctrlKey: true });
      expect(vi.mocked(input.onInlineEditStyle).mock.calls.map((c) => c[1])).toEqual([
        'bold',
        'italic',
        'underline',
      ]);
    });

    it('Ctrl+D confirma y duplica durante edición inline', () => {
      const text = createLayer('text', { id: 'edit-1' });
      const doc = makeDoc([text]);
      const input = makeInput(doc, { editingLayerId: 'edit-1', selectedIds: ['edit-1'] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'd', code: 'KeyD', ctrlKey: true });
      expect(input.commitInlineEdit).toHaveBeenCalledTimes(1);
      expect(input.setAllLayers).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Z confirma antes de deshacer', () => {
      const doc = makeDoc([]);
      const input = editingInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'z', code: 'KeyZ', ctrlKey: true });
      expect(input.commitInlineEdit).toHaveBeenCalledTimes(1);
      expect(input.runUndo).toHaveBeenCalledTimes(1);
    });
  });
});
