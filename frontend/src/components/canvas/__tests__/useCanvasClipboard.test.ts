import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCanvasClipboard } from '../hooks/useCanvasClipboard';
import { createLayer } from '../constants';
import type { CanvasLayer } from '../types';

type Params = Parameters<typeof useCanvasClipboard>[0];

function setup(layers: CanvasLayer[], overrides: Partial<Params> = {}) {
  const input: Params = {
    documentLayers: layers,
    pageIndex: 0,
    selectedIds: [],
    clipboard: [],
    setClipboard: vi.fn(),
    sealPanelAndAbortGesture: vi.fn(),
    setAllLayers: vi.fn(),
    setSelectedIds: vi.fn(),
    ...overrides,
  };
  const { result } = renderHook(() => useCanvasClipboard(input));
  return { input, cut: result.current.cutLayersToClipboard, paste: result.current.pasteClipboard };
}

describe('useCanvasClipboard cutLayersToClipboard', () => {
  it('copia con descendientes, sella el gesto, elimina y devuelve las raíces cortadas', () => {
    const group = createLayer('group');
    const child: CanvasLayer = { ...createLayer('rect'), parentId: group.id };
    const other = createLayer('ellipse');
    const { input, cut } = setup([group, child, other]);

    expect(cut([group.id])).toEqual([group.id]);

    const copied = vi.mocked(input.setClipboard).mock.calls[0][0] as CanvasLayer[];
    expect(copied.map((l) => l.id).sort()).toEqual([child.id, group.id].sort());
    expect(input.sealPanelAndAbortGesture).toHaveBeenCalledTimes(1);
    const remaining = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    expect(remaining.map((l) => l.id)).toEqual([other.id]);
  });

  it('omite bloqueadas y frames y no muta nada si no queda nada editable', () => {
    const locked = createLayer('rect', { locked: true });
    const frame: CanvasLayer = { ...createLayer('rect'), type: 'frame' };
    const { input, cut } = setup([locked, frame]);

    expect(cut([locked.id, frame.id])).toEqual([]);

    expect(input.setClipboard).not.toHaveBeenCalled();
    expect(input.sealPanelAndAbortGesture).not.toHaveBeenCalled();
    expect(input.setAllLayers).not.toHaveBeenCalled();
  });
});

describe('useCanvasClipboard pasteClipboard', () => {
  it('copiar y pegar en el propio documento conserva la capa copiada con una sola copia', async () => {
    const original = createLayer('rect');
    const other = createLayer('ellipse');
    const { input, paste } = setup([original, other], {
      selectedIds: [original.id],
      clipboard: [original],
    });

    await act(async () => {
      await paste();
    });

    const layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];
    const selectedIds = vi.mocked(input.setSelectedIds).mock.calls[0][0] as string[];

    expect(layers.filter((l) => l.id === original.id)).toHaveLength(1);
    expect(layers).toHaveLength(3);
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
    expect(selectedIds).toHaveLength(1);
    expect(selectedIds[0]).not.toBe(original.id);
  });

  it('cortar y pegar sigue dando una única copia de la capa cortada', async () => {
    const source = createLayer('rect');
    const other = createLayer('ellipse');
    const { input, paste } = setup([other], { clipboard: [source] });

    await act(async () => {
      await paste();
    });

    const layers = vi.mocked(input.setAllLayers).mock.calls[0][0] as CanvasLayer[];

    expect(layers.some((l) => l.id === source.id)).toBe(false);
    expect(layers).toHaveLength(2);
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
  });
});
