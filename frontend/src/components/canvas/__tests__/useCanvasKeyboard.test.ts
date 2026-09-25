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
    cutLayersToClipboard: vi.fn(() => [] as string[]),
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

  it('Tab / Shift+Tab seleccionan la capa hermana siguiente / anterior (Figma)', () => {
    const a = createLayer('rect');
    const b = createLayer('rect');
    const c = createLayer('rect');
    const doc = makeDoc([a, b, c]);
    const input = makeInput(doc, { selectedIds: [b.id] });
    renderHook(() => useCanvasKeyboard(input));
    const e = press(input, { key: 'Tab', target: document.body });
    expect(e.defaultPrevented).toBe(true);
    expect(input.setSelectedIds).toHaveBeenLastCalledWith([a.id]);
    press(input, { key: 'Tab', shiftKey: true, target: document.body });
    expect(input.setSelectedIds).toHaveBeenLastCalledWith([c.id]);
  });

  it('Tab fuera del lienzo conserva la navegación de foco', () => {
    const a = createLayer('rect');
    const b = createLayer('rect');
    const doc = makeDoc([a, b]);
    const input = makeInput(doc, { selectedIds: [b.id] });
    renderHook(() => useCanvasKeyboard(input));
    const e = press(input, { key: 'Tab', target: document.createElement('button') });
    expect(e.defaultPrevented).toBe(false);
    expect(input.setSelectedIds).not.toHaveBeenCalled();
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

  it('Ctrl+Shift+D no duplica: el shell lo reserva para abrir Ajustes', () => {
    const text = createLayer('text');
    const doc = makeDoc([text]);
    const input = makeInput(doc, { selectedIds: [text.id] });
    renderHook(() => useCanvasKeyboard(input));
    // Con Shift el navegador entrega key 'D' pero code sigue siendo 'KeyD', y el
    // chord pertenece al atajo global del shell.
    const e = press(input, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(input.setAllLayers).not.toHaveBeenCalled();
    expect(input.setSelectedIds).not.toHaveBeenCalled();
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

  it('Ctrl+Shift+I invierte la selección de la página', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const locked = createLayer('text', { locked: true });
    const otherPage = createLayer('boolean', { pageIndex: 1 });
    const doc = makeDoc([a, b, locked, otherPage]);
    const input = makeInput(doc, {
      selectedIds: [a.id],
      pageLayers: doc.layers.filter((l) => (l.pageIndex ?? 0) === 0),
    });
    renderHook(() => useCanvasKeyboard(input));
    const e = press(input, { key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(input.setSelectedIds).toHaveBeenCalledWith([b.id]);
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

  describe('atajos restantes', () => {
    it('cada tecla de herramienta activa su herramienta', () => {
      const doc = makeDoc([]);
      const input = makeInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      const cases: Array<[string, boolean, string]> = [
        ['v', false, 'select'],
        ['o', false, 'ellipse'],
        ['f', false, 'field'],
        ['l', false, 'line'],
        ['L', true, 'arrow'],
        ['u', false, 'lasso'],
        ['i', false, 'imageSlot'],
        ['g', false, 'grid'],
        ['b', false, 'table'],
        ['m', false, 'image'],
        ['P', true, 'polygon'],
        ['S', true, 'star'],
        ['D', true, 'diamond'],
        ['H', true, 'hexagon'],
        ['N', true, 'pentagon'],
      ];
      for (const [key, shift, expected] of cases) {
        vi.mocked(input.setTool).mockClear();
        press(input, { key, shiftKey: shift });
        expect(input.setTool, key).toHaveBeenCalledWith(expected);
      }
    });

    it('c / p activan edición de path solo cuando hay una línea seleccionada', () => {
      const line = createLayer('line');
      const doc = makeDoc([line]);
      const input = makeInput(doc, { selectedIds: [line.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'c' });
      expect(input.setPathEditingLayerId).toHaveBeenCalledWith(line.id);
      expect(input.setTool).toHaveBeenCalledWith('cut');
      vi.mocked(input.setTool).mockClear();
      press(input, { key: 'p' });
      expect(input.setTool).toHaveBeenCalledWith('bend');
      vi.mocked(input.setTool).mockClear();
      const empty = makeInput(makeDoc([]));
      renderHook(() => useCanvasKeyboard(empty));
      press(empty, { key: 'c' });
      press(empty, { key: 'p' });
      expect(empty.setTool).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+K activa la herramienta imagen', () => {
      const doc = makeDoc([]);
      const input = makeInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'K', ctrlKey: true, shiftKey: true });
      expect(input.setTool).toHaveBeenCalledWith('image');
    });

    it('Ctrl+\\ alterna ambos paneles', () => {
      const doc = makeDoc([]);
      const input = makeInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: '\\', ctrlKey: true });
      expect(input.toggleBothPanels).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+P y Ctrl+/ también alternan la paleta', () => {
      const doc = makeDoc([]);
      const input = makeInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'p', code: 'KeyP', ctrlKey: true });
      press(input, { key: '/', code: 'Slash', ctrlKey: true });
      expect(input.setPaletteOpen).toHaveBeenCalledTimes(2);
    });

    it('Ctrl+=, Ctrl+- y Ctrl+0 animan el zoom cuando hay viewport nav', () => {
      const doc = makeDoc([]);
      const animateTo = vi.fn();
      const input = makeInput(doc, {
        viewportNavRef: {
          current: { animateTo, getZoom: () => 1, getPan: () => ({ x: 0, y: 0 }) } as never,
        },
      });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: '=', ctrlKey: true });
      press(input, { key: '-', ctrlKey: true });
      press(input, { key: '0', ctrlKey: true });
      expect(animateTo).toHaveBeenCalledTimes(3);
      expect(animateTo.mock.calls[2][0].zoom).toBe(1);
    });

    it('Ctrl+=/- /0 sin viewport nav no lanzan error', () => {
      const doc = makeDoc([]);
      const input = makeInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      const e = press(input, { key: '=', ctrlKey: true });
      expect(e.defaultPrevented).toBe(true);
    });

    it('Ctrl+Shift+L bloquea y desbloquea las capas seleccionadas', () => {
      const a = createLayer('rect');
      const doc = makeDoc([a]);
      const input = makeInput(doc, { selectedIds: [a.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'L', ctrlKey: true, shiftKey: true });
      let layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
      expect(layers.find((l) => l.id === a.id)?.locked).toBe(true);
      const docLocked = makeDoc([{ ...a, locked: true }]);
      const inputLocked = makeInput(docLocked, { selectedIds: [a.id] });
      renderHook(() => useCanvasKeyboard(inputLocked));
      press(inputLocked, { key: 'L', ctrlKey: true, shiftKey: true });
      layers = vi.mocked(inputLocked.setAllLayers).mock.calls[0][0] as CanvasLayer[];
      expect(layers.find((l) => l.id === a.id)?.locked).toBe(false);
    });

    it('Ctrl+Shift+H alterna visibilidad de las capas seleccionadas', () => {
      const a = createLayer('rect');
      const doc = makeDoc([a]);
      const input = makeInput(doc, { selectedIds: [a.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'H', ctrlKey: true, shiftKey: true });
      const layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
      expect(layers.find((l) => l.id === a.id)?.visible).toBe(false);
    });

    it('Ctrl+Shift+L/H sin capas elegibles no toca las capas', () => {
      const frame = createLayer('frame');
      const doc = makeDoc([frame]);
      const input = makeInput(doc, { selectedIds: [frame.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'L', ctrlKey: true, shiftKey: true });
      press(input, { key: 'H', ctrlKey: true, shiftKey: true });
      expect(input.setAllLayers).not.toHaveBeenCalled();
    });

    it('Alt+c activa el cuentagotas cuando hay selección', () => {
      const a = createLayer('rect');
      const doc = makeDoc([a]);
      const input = makeInput(doc, { selectedIds: [a.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'c', altKey: true });
      expect(input.setEyedropperActive).toHaveBeenCalledWith(true);
    });

    it('Alt+a/d/w/s/h/v alinea y Alt+x/y distribuye con 3+ capas', () => {
      const layers = [createLayer('rect'), createLayer('ellipse'), createLayer('text')];
      const doc = makeDoc(layers);
      const ids = layers.map((l) => l.id);
      const input = makeInput(doc, { selectedIds: ids });
      renderHook(() => useCanvasKeyboard(input));
      for (const key of ['a', 'd', 'w', 's', 'h', 'v', 'x', 'y']) {
        vi.mocked(input.setAllLayers).mockClear();
        press(input, { key, altKey: true });
        expect(input.setAllLayers, `Alt+${key}`).toHaveBeenCalled();
      }
      const few = makeInput(doc, { selectedIds: ids.slice(0, 2) });
      renderHook(() => useCanvasKeyboard(few));
      press(few, { key: 'x', altKey: true });
      expect(few.setAllLayers).not.toHaveBeenCalled();
    });

    it('Ctrl+Alt+C copia estilos y Ctrl+Alt+V los aplica', () => {
      const a = createLayer('rect');
      const doc = makeDoc([a]);
      const propsRef = { current: null as Record<string, string> | null };
      const input = makeInput(doc, {
        selectedIds: [a.id],
        propsClipboardRef: propsRef as never,
      });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'c', ctrlKey: true, altKey: true });
      expect(propsRef.current).not.toBeNull();
      press(input, { key: 'v', ctrlKey: true, altKey: true });
      expect(input.setAllLayers).toHaveBeenCalled();
    });

    it('Ctrl+C copia con descendientes y Ctrl+V / Ctrl+Shift+V pegan', () => {
      const group = createLayer('group');
      const child = createLayer('rect', { parentId: group.id });
      const doc = makeDoc([group, child]);
      const input = makeInput(doc, { selectedIds: [group.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'c', ctrlKey: true });
      expect(input.copyLayersToClipboard).toHaveBeenCalledTimes(1);
      const copies = vi.mocked(input.copyLayersToClipboard).mock.calls[0][0] as CanvasLayer[];
      expect(copies.map((l) => l.id)).toContain(child.id);
      press(input, { key: 'v', ctrlKey: true });
      press(input, { key: 'v', ctrlKey: true, shiftKey: true });
      expect(input.pasteClipboard).toHaveBeenNthCalledWith(1, undefined);
      expect(input.pasteClipboard).toHaveBeenNthCalledWith(2, 0);
    });

    it('Ctrl+X corta la selección editable y limpia la selección', () => {
      const a = createLayer('rect');
      const doc = makeDoc([a]);
      const cutLayersToClipboard = vi.fn(() => [a.id]);
      const input = makeInput(doc, { selectedIds: [a.id], cutLayersToClipboard });
      renderHook(() => useCanvasKeyboard(input));
      const e = press(input, { key: 'x', code: 'KeyX', ctrlKey: true });
      expect(e.defaultPrevented).toBe(true);
      expect(cutLayersToClipboard).toHaveBeenCalledWith([a.id]);
      expect(input.setSelectedIds).toHaveBeenCalledWith([]);
    });

    it('Ctrl+X no deselecciona cuando el corte no elimina nada', () => {
      const locked = createLayer('rect', { locked: true });
      const doc = makeDoc([locked]);
      const cutLayersToClipboard = vi.fn(() => [] as string[]);
      const input = makeInput(doc, { selectedIds: [locked.id], cutLayersToClipboard });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'x', code: 'KeyX', ctrlKey: true });
      expect(cutLayersToClipboard).toHaveBeenCalledWith([]);
      expect(input.setSelectedIds).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+R pega reemplazando', () => {
      const doc = makeDoc([]);
      const input = makeInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'R', ctrlKey: true, shiftKey: true });
      expect(input.pasteReplaceClipboard).toHaveBeenCalledTimes(1);
    });

    it("Shift+R alterna reglas y Shift+' alterna snap", () => {
      const doc = makeDoc([]);
      const input = makeInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'R', shiftKey: true });
      const withRulers = vi.mocked(input.setDocument).mock.calls[0][0] as CanvasDocument;
      expect(withRulers.settings?.showRulers).toBe(false);
      press(input, { key: "'", code: 'Quote', shiftKey: true });
      const withSnap = vi.mocked(input.setDocument).mock.calls[1][0] as CanvasDocument;
      expect(withSnap.settings?.snapToGrid).toBe(true);
    });

    it('] y [ sin Ctrl llevan al frente/fondo', () => {
      const a = createLayer('rect');
      const b = createLayer('ellipse');
      const doc = makeDoc([a, b]);
      const input = makeInput(doc, { selectedIds: [a.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: ']' });
      let layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
      expect(layers[layers.length - 1].id).toBe(a.id);
      const backInput = makeInput(doc, { selectedIds: [b.id] });
      renderHook(() => useCanvasKeyboard(backInput));
      press(backInput, { key: '[' });
      layers = vi.mocked(backInput.setAllLayers).mock.calls[0][0] as CanvasLayer[];
      expect(layers.findIndex((l) => l.id === b.id)).toBeLessThan(
        doc.layers.findIndex((l) => l.id === b.id),
      );
    });

    it('? y Shift+/ alternan la ayuda de atajos', () => {
      const doc = makeDoc([]);
      const input = makeInput(doc);
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: '?' });
      press(input, { key: '/', shiftKey: true });
      expect(input.setShowShortcuts).toHaveBeenCalledTimes(2);
    });

    it('Enter inicia edición inline en capa editable y path en línea', () => {
      const text = createLayer('text');
      const line = createLayer('line');
      const doc = makeDoc([text, line]);
      const input = makeInput(doc, { selectedIds: [text.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'Enter' });
      expect(input.startContainerOrInlineEdit).toHaveBeenCalledWith(text.id);
      const lineInput = makeInput(doc, { selectedIds: [line.id] });
      renderHook(() => useCanvasKeyboard(lineInput));
      press(lineInput, { key: 'Enter' });
      expect(lineInput.setPathEditingLayerId).toHaveBeenCalledWith(line.id);
      expect(lineInput.setTool).toHaveBeenCalledWith('select');
    });

    it('Escape respeta la prioridad: gesto, panel, cuentagotas, preview', () => {
      const doc = makeDoc([]);
      const gesture = makeInput(doc, { gestureBaselineRef: { current: {} } as never });
      renderHook(() => useCanvasKeyboard(gesture));
      press(gesture, { key: 'Escape' });
      expect(gesture.cancelPageLayersGesture).toHaveBeenCalledTimes(1);
      expect(gesture.setGestureAbortToken).toHaveBeenCalledTimes(1);

      const panel = makeInput(doc, { panelBaselineRef: { current: {} } as never });
      renderHook(() => useCanvasKeyboard(panel));
      press(panel, { key: 'Escape' });
      expect(panel.onPanelCommitLive).toHaveBeenCalledTimes(1);

      const eyedrop = makeInput(doc, { eyedropperActive: true });
      renderHook(() => useCanvasKeyboard(eyedrop));
      press(eyedrop, { key: 'Escape' });
      expect(eyedrop.setEyedropperActive).toHaveBeenCalledWith(false);

      const preview = makeInput(doc, { previewOpen: true });
      renderHook(() => useCanvasKeyboard(preview));
      press(preview, { key: 'Escape' });
      expect(preview.setPreviewOpen).toHaveBeenCalledWith(false);
    });

    it('Escape sube al padre cuando todas las seleccionadas comparten padre', () => {
      const group = createLayer('group');
      const child = createLayer('rect', { parentId: group.id });
      const doc = makeDoc([group, child]);
      const input = makeInput(doc, { selectedIds: [child.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'Escape' });
      expect(input.setSelectedIds).toHaveBeenCalledWith([group.id]);
    });

    it('Space sobre un botón no roba la herramienta', () => {
      const doc = makeDoc([]);
      const input = makeInput(doc, { tool: 'rect' });
      renderHook(() => useCanvasKeyboard(input));
      const button = document.createElement('button');
      press(input, { key: ' ', code: 'Space', target: button });
      expect(input.setTool).not.toHaveBeenCalled();
    });

    it('tecla de texto con una línea seleccionada no inicia edición inline', () => {
      const line = createLayer('line');
      const doc = makeDoc([line]);
      const input = makeInput(doc, { selectedIds: [line.id] });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'x' });
      expect(input.startInlineEdit).not.toHaveBeenCalled();
    });

    it('Escape en edición de path vuelve a select', () => {
      const doc = makeDoc([]);
      const input = makeInput(doc, { pathEditingLayerId: 'line-1' });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'Escape' });
      expect(input.setPathEditingLayerId).toHaveBeenCalledWith(null);
      expect(input.setTool).toHaveBeenCalledWith('select');
    });

    it('escribir durante edición inline agrega el carácter al valor', () => {
      const text = createLayer('text', { id: 'edit-1', value: 'ab' });
      const doc = makeDoc([text]);
      const input = makeInput(doc, { editingLayerId: 'edit-1' });
      renderHook(() => useCanvasKeyboard(input));
      press(input, { key: 'c' });
      expect(input.onInlineEditValue).toHaveBeenCalledWith('edit-1', 'abc');
    });
  });
});
