import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useCanvasCommandPalette,
  type CanvasPaletteInput,
} from '../hooks/useCanvasCommandPalette';
import { createLayer } from '../constants';
import { createGuide } from '../ops/guides';
import { createEmptyDocument, type CanvasDocument, type CanvasLayer } from '../types';

const { exportPagePng } = vi.hoisted(() => ({ exportPagePng: vi.fn() }));
vi.mock('../ops/exportPng', () => ({ exportPagePng, PAGE_PNG_SCALE: 2 }));

function makeDoc(layers: CanvasLayer[]): CanvasDocument {
  const doc = createEmptyDocument('test');
  return { ...doc, layers: [...doc.layers, ...layers] };
}

function makeInput(doc: CanvasDocument, overrides: Partial<CanvasPaletteInput> = {}) {
  const input: CanvasPaletteInput = {
    paletteOpen: true,
    document: doc,
    canUndo: false,
    canRedo: false,
    setDocument: vi.fn(),
    selectedIds: [],
    pageIndex: 0,
    setPageIndex: vi.fn(),
    pageLayers: doc.layers.filter((l) => (l.pageIndex ?? 0) === 0),
    uiLocked: false,
    runUndo: vi.fn(),
    runRedo: vi.fn(),
    pasteClipboard: vi.fn(),
    pasteReplaceClipboard: vi.fn(),
    copyLayersToClipboard: vi.fn(),
    cutLayersToClipboard: vi.fn(() => [] as string[]),
    setAllLayers: vi.fn(),
    sealPanelAndAbortGesture: vi.fn(),
    onAddPage: vi.fn(),
    onDuplicatePage: vi.fn(),
    onRemovePage: vi.fn(),
    onRenamePage: vi.fn(),
    zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(),
    toggleBothPanels: vi.fn(),
    togglePreview: vi.fn(),
    handleSave: vi.fn(),
    onNew: vi.fn(),
    onDuplicate: vi.fn(),
    onOpenTemplates: vi.fn(),
    pdfImport: { pdfImporting: false, onImportPdf: vi.fn() },
    setTool: vi.fn(),
    setSelectedIds: vi.fn(),
    setRenameRequest: vi.fn(),
    setUiLocked: vi.fn(),
    setShowShortcuts: vi.fn(),
    setEyedropperActive: vi.fn(),
    setMode: vi.fn(),
    propsClipboardRef: { current: null },
    viewportNavRef: { current: null },
    ...overrides,
  };
  return input;
}

function palette(input: CanvasPaletteInput) {
  const { result } = renderHook(() => useCanvasCommandPalette(input));
  return result.current!;
}

describe('useCanvasCommandPalette', () => {
  it('devuelve null cuando la paleta está cerrada', () => {
    const { result } = renderHook(() =>
      useCanvasCommandPalette(makeInput(makeDoc([]), { paletteOpen: false })),
    );
    expect(result.current).toBeNull();
  });

  it('expone un runner por cada comando y comandos sin función run', () => {
    const p = palette(makeInput(makeDoc([])));
    expect(p.commands.length).toBeGreaterThan(40);
    const ids = new Set(p.commands.map((c) => c.id));
    expect(ids.size).toBe(p.commands.length);
    for (const c of p.commands) {
      expect(p.runners.has(c.id)).toBe(true);
      expect('run' in c).toBe(false);
      expect(c.group).toBeTruthy();
    }
  });

  it('cada herramienta registrada invoca setTool', () => {
    const input = makeInput(makeDoc([]));
    const p = palette(input);
    p.runners.get('tool:text')!();
    p.runners.get('tool:polygon')!();
    expect(vi.mocked(input.setTool).mock.calls.map((c) => c[0])).toEqual(['text', 'polygon']);
  });

  it('deshabilita edición sin selección editable y undo/redo sin historial', () => {
    const p = palette(makeInput(makeDoc([])));
    const byId = new Map(p.commands.map((c) => [c.id, c]));
    for (const id of ['undo', 'redo', 'copy', 'duplicate', 'delete', 'group', 'rename']) {
      expect(byId.get(id)!.disabled).toBe(true);
    }
    expect(byId.get('paste')!.disabled).toBeFalsy();
    expect(byId.get('doc:save')!.disabled).toBeFalsy();
  });

  it('habilita comandos de selección cuando hay capas editables', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const doc = makeDoc([a, b]);
    const p = palette(makeInput(doc, { selectedIds: [a.id, b.id] }));
    const byId = new Map(p.commands.map((c) => [c.id, c]));
    expect(byId.get('copy')!.disabled).toBeFalsy();
    expect(byId.get('group')!.disabled).toBeFalsy();
    expect(byId.get('ungroup')!.disabled).toBe(true);
    expect(byId.get('align:left')!.disabled).toBeFalsy();
    expect(byId.get('distribute:h')!.disabled).toBe(true);
  });

  it('runner duplicate crea copias y selecciona los nuevos ids', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    palette(input).runners.get('duplicate')!();
    const newLayers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(newLayers).toHaveLength(doc.layers.length + 1);
    const newIds = vi.mocked(input.setSelectedIds).mock.calls[0][0] as string[];
    expect(newIds[0]).not.toBe(a.id);
  });

  it('runner delete sella el panel, elimina y limpia la selección', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    palette(input).runners.get('delete')!();
    expect(input.sealPanelAndAbortGesture).toHaveBeenCalledTimes(1);
    const newLayers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(newLayers.find((l) => l.id === a.id)).toBeUndefined();
    expect(input.setSelectedIds).toHaveBeenCalledWith([]);
  });

  it('runner cut corta la selección y limpia cuando algo se elimina', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const cutLayersToClipboard = vi.fn(() => [a.id]);
    const input = makeInput(doc, { selectedIds: [a.id], cutLayersToClipboard });
    palette(input).runners.get('cut')!();
    expect(cutLayersToClipboard).toHaveBeenCalledWith([a.id]);
    expect(input.setSelectedIds).toHaveBeenCalledWith([]);

    const noOp = makeInput(doc, { selectedIds: [], cutLayersToClipboard: vi.fn(() => []) });
    palette(noOp).runners.get('cut')!();
    expect(noOp.setSelectedIds).not.toHaveBeenCalled();
  });

  it('runner group agrupa y runner ungroup se habilita con un grupo', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const doc = makeDoc([a, b]);
    const input = makeInput(doc, { selectedIds: [a.id, b.id] });
    palette(input).runners.get('group')!();
    const grouped = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    const group = grouped.find((l) => l.type === 'group');
    expect(group).toBeDefined();
    expect(input.setSelectedIds).toHaveBeenCalledWith([group!.id]);

    const groupedDoc = { ...doc, layers: grouped };
    const p2 = palette(makeInput(groupedDoc, { selectedIds: [group!.id] }));
    const byId = new Map(p2.commands.map((c) => [c.id, c]));
    expect(byId.get('ungroup')!.disabled).toBeFalsy();
  });

  it('runner lock bloquea todo y al repetir desbloquea', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    palette(input).runners.get('lock')!();
    const locked = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(locked.find((l) => l.id === a.id)?.locked).toBe(true);
  });

  it('runner hide oculta la selección', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    palette(input).runners.get('hide')!();
    const hidden = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(hidden.find((l) => l.id === a.id)?.visible).toBe(false);
  });

  it('runner selectAll excluye frames y capas bloqueadas', () => {
    const a = createLayer('rect');
    const locked = createLayer('ellipse', { locked: true });
    const doc = makeDoc([a, locked]);
    const input = makeInput(doc, {
      pageLayers: doc.layers.filter((l) => (l.pageIndex ?? 0) === 0),
    });
    palette(input).runners.get('selectAll')!();
    expect(input.setSelectedIds).toHaveBeenCalledWith([a.id]);
  });

  it('runner selection:invert invierte las capas seleccionables de la página', () => {
    const a = createLayer('rect');
    const b = createLayer('ellipse');
    const locked = createLayer('text', { locked: true });
    const doc = makeDoc([a, b, locked]);
    const input = makeInput(doc, {
      selectedIds: [a.id],
      pageLayers: doc.layers.filter((l) => (l.pageIndex ?? 0) === 0),
    });
    palette(input).runners.get('selection:invert')!();
    expect(input.setSelectedIds).toHaveBeenCalledWith([b.id]);
  });

  it('runner page:remove se deshabilita con una sola página', () => {
    const doc = makeDoc([]);
    const p1 = palette(makeInput(doc));
    expect(new Map(p1.commands.map((c) => [c.id, c])).get('page:remove')!.disabled).toBe(true);
    const twoPages = {
      ...doc,
      pages: [...doc.pages, { id: 'p2', name: 'Página 2' }],
    };
    const p2 = palette(makeInput(twoPages));
    expect(new Map(p2.commands.map((c) => [c.id, c])).get('page:remove')!.disabled).toBeFalsy();
  });

  it('runners de página invocan los callbacks con el índice actual', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc, { pageIndex: 1 });
    const p = palette(input);
    p.runners.get('page:add')!();
    p.runners.get('page:duplicate')!();
    p.runners.get('page:rename')!();
    expect(input.onAddPage).toHaveBeenCalledTimes(1);
    expect(input.onDuplicatePage).toHaveBeenCalledWith(1);
    expect(input.onRenamePage).toHaveBeenCalledWith(1, 'Página 2');
  });

  it('zoom:in usa el viewportNavRef cuando existe', () => {
    const doc = makeDoc([]);
    const animateTo = vi.fn();
    const nav = { getZoom: () => 1, getPan: () => ({ x: 0, y: 0 }), animateTo };
    const input = makeInput(doc, {
      viewportNavRef: { current: nav as never },
    });
    palette(input).runners.get('zoom:in')!();
    expect(animateTo).toHaveBeenCalledTimes(1);
    expect(animateTo.mock.calls[0][0].zoom).toBeGreaterThan(1);

    const noNav = makeInput(doc);
    expect(() => palette(noNav).runners.get('zoom:in')!()).not.toThrow();
  });

  it('view:grid y view:rulers alternan settings del documento', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc);
    const p = palette(input);
    p.runners.get('view:grid')!();
    const toggled = vi.mocked(input.setDocument).mock.calls[0][0] as CanvasDocument;
    expect(toggled.settings?.snapToGrid).toBe(true);
    p.runners.get('view:rulers')!();
    const rulers = vi.mocked(input.setDocument).mock.calls[1][0] as CanvasDocument;
    expect(rulers.settings?.showRulers).toBe(false);
  });

  it('guides:clear se deshabilita sin guías y las elimina todas', () => {
    const doc = makeDoc([]);
    const withoutGuides = palette(makeInput(doc));
    const byId = new Map(withoutGuides.commands.map((c) => [c.id, c]));
    expect(byId.get('guides:clear')!.disabled).toBe(true);

    const input = makeInput({ ...doc, guides: [createGuide('x', 10, 0), createGuide('y', 20, 1)] });
    palette(input).runners.get('guides:clear')!();
    const next = vi.mocked(input.setDocument).mock.calls[0][0] as CanvasDocument;
    expect(next.guides).toEqual([]);
  });

  it('doc:generate cambia a modo generate y doc:importPdf respeta pdfImporting', () => {
    const doc = makeDoc([]);
    const input = makeInput(doc, {
      pdfImport: { pdfImporting: true, onImportPdf: vi.fn() },
    });
    const p = palette(input);
    p.runners.get('doc:generate')!();
    expect(input.setMode).toHaveBeenCalledWith('generate');
    const byId = new Map(p.commands.map((c) => [c.id, c]));
    expect(byId.get('doc:importPdf')!.disabled).toBe(true);
  });

  it('export:pagePng exporta la página actual con el nombre del documento', () => {
    exportPagePng.mockClear();
    const doc = { ...makeDoc([]), name: 'informe' };
    palette(makeInput(doc, { pageIndex: 1 })).runners.get('export:pagePng')!();
    expect(exportPagePng).toHaveBeenCalledWith('informe-pagina-2', 2);
  });

  it('export:documentPng recorre las páginas y restaura la página inicial', async () => {
    exportPagePng.mockClear();
    const doc = {
      ...makeDoc([]),
      name: 'informe',
      pages: [
        { id: 'p1', name: 'Uno' },
        { id: 'p2', name: 'Dos' },
        { id: 'p3', name: 'Tres' },
      ],
    };
    const setPageIndex = vi.fn();
    palette(makeInput(doc, { pageIndex: 1, setPageIndex })).runners.get('export:documentPng')!();

    await vi.waitFor(() => expect(exportPagePng).toHaveBeenCalledTimes(3));
    expect(exportPagePng.mock.calls.map(([name]) => name)).toEqual([
      'informe-pagina-1',
      'informe-pagina-2',
      'informe-pagina-3',
    ]);
    expect(setPageIndex.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 1]);
  });

  it('export:documentPng se deshabilita cuando el documento tiene una página', () => {
    const byId = new Map(palette(makeInput(makeDoc([]))).commands.map((c) => [c.id, c]));
    expect(byId.get('export:documentPng')!.disabled).toBe(true);
  });

  it('runner copy expande la selección con descendientes', () => {
    const group = createLayer('group');
    const child = { ...createLayer('rect'), parentId: group.id };
    const doc = makeDoc([group, child]);
    const input = makeInput(doc, { selectedIds: [group.id] });
    palette(input).runners.get('copy')!();
    const copied = vi.mocked(input.copyLayersToClipboard).mock.calls[0][0] as CanvasLayer[];
    expect(copied.map((l) => l.id).sort()).toEqual([child.id, group.id].sort());
  });

  it('runner rename emite solicitud solo con una capa editable', () => {
    const a = createLayer('rect');
    const doc = makeDoc([a]);
    const input = makeInput(doc, { selectedIds: [a.id] });
    palette(input).runners.get('rename')!();
    const updater = vi.mocked(input.setRenameRequest).mock.calls[0][0] as (
      prev: { layerId: string; nonce: number } | null,
    ) => { layerId: string; nonce: number };
    expect(updater(null)).toEqual({ layerId: a.id, nonce: 1 });
  });
});
