import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import { useCanvasHistory } from '../hooks/useCanvasHistory';
import { useInlineEdit } from '../hooks/useInlineEdit';
import { createEmptyDocument, type CanvasTool } from '../types';

describe('useInlineEdit lifecycle', () => {
  it('clears an edit baseline when the active document changes', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text', { id: 'text-1', pageIndex: 0 });
    base.layers.push(text);

    const { result } = renderHook(() => {
      const history = useCanvasHistory(base);
      const [, setSelectedIds] = useState<string[]>([]);
      const [, setTool] = useState<CanvasTool>('select');
      const inline = useInlineEdit({
        history,
        setSelectedIds,
        setTool,
        setContextMenu: vi.fn(),
      });
      return { history, inline };
    });

    act(() => {
      result.current.inline.startInlineEdit('text-1');
    });
    expect(result.current.inline.editingLayerId).toBe('text-1');

    act(() => {
      result.current.history.replaceDocument({
        ...result.current.history.document,
        id: 'next-document',
      });
    });

    expect(result.current.inline.editingLayerId).toBeNull();
  });

  it('applies an explicit selection range and commits style-only edits', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text', { id: 'text-1', pageIndex: 0, value: 'hola mundo' });
    base.layers.push(text);

    const { result } = renderHook(() => {
      const history = useCanvasHistory(base);
      const [, setSelectedIds] = useState<string[]>([]);
      const [, setTool] = useState<CanvasTool>('select');
      const inline = useInlineEdit({
        history,
        setSelectedIds,
        setTool,
        setContextMenu: vi.fn(),
      });
      return { history, inline };
    });

    const pastBefore = result.current.history.past.length;

    act(() => {
      result.current.inline.startInlineEdit('text-1', { selection: { start: 5, end: 10 } });
    });
    expect(result.current.inline.editingLayerId).toBe('text-1');
    expect(result.current.inline.editingRange).toEqual({ start: 5, end: 10 });
    expect(result.current.inline.editingSelectAll).toBe(false);

    act(() => {
      result.current.inline.onInlineEditStyle('text-1', 'bold');
    });
    expect(
      result.current.history.document.layers.find((l) => l.id === 'text-1')?.cssVars[
        '--font-weight'
      ],
    ).toBe('700');

    act(() => {
      result.current.inline.commitInlineEdit();
    });
    expect(result.current.inline.editingLayerId).toBeNull();
    expect(result.current.inline.editingRange).toBeNull();
    expect(result.current.history.past.length).toBe(pastBefore + 1);
  });

  it('does not push a history entry when nothing changed during the edit', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text', { id: 'text-1', pageIndex: 0, value: 'hola' });
    base.layers.push(text);

    const { result } = renderHook(() => {
      const history = useCanvasHistory(base);
      const [, setSelectedIds] = useState<string[]>([]);
      const [, setTool] = useState<CanvasTool>('select');
      const inline = useInlineEdit({
        history,
        setSelectedIds,
        setTool,
        setContextMenu: vi.fn(),
      });
      return { history, inline };
    });

    act(() => {
      result.current.inline.startInlineEdit('text-1');
    });
    const pastBefore = result.current.history.past.length;
    act(() => {
      result.current.inline.commitInlineEdit();
    });
    expect(result.current.history.past.length).toBe(pastBefore);
  });
});
