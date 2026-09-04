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
});
