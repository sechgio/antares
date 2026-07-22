import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { useCanvasHistory, MAX_HISTORY } from '../hooks/useCanvasHistory';
import { createEmptyDocument, parseMm, type CanvasDocument } from '../types';

function cloneDoc(doc: CanvasDocument): CanvasDocument {
  return {
    ...doc,
    page: { ...doc.page },
    layers: doc.layers.map((l) => ({
      ...l,
      cssVars: { ...l.cssVars },
      meta: l.meta ? { ...l.meta } : undefined,
    })),
    fields: doc.fields.map((f) => ({ ...f })),
    pages: doc.pages?.map((p) => ({ ...p })),
  };
}

function withMovedText(doc: CanvasDocument, xMm: number): CanvasDocument {
  return {
    ...doc,
    layers: doc.layers.map((l) =>
      l.type === 'text'
        ? { ...l, cssVars: { ...l.cssVars, '--translate-x': `${xMm}mm` } }
        : l,
    ),
  };
}

describe('useCanvasHistory gesture coalesce', () => {
  it('silent move updates + commitFromBaseline undo in one step', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text');
    text.cssVars['--translate-x'] = '10mm';
    base.layers.push(text);

    const { result } = renderHook(() => useCanvasHistory(base));
    const baseline = cloneDoc(result.current.document);

    act(() => {
      result.current.updateSilent(withMovedText(result.current.document, 20));
    });
    act(() => {
      result.current.updateSilent(withMovedText(result.current.document, 35));
    });
    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.commitFromBaseline(baseline);
    });
    expect(result.current.canUndo).toBe(true);
    expect(parseMm(result.current.document.layers.find((l) => l.type === 'text')!.cssVars['--translate-x'])).toBe(
      35,
    );

    act(() => {
      result.current.undo();
    });
    expect(parseMm(result.current.document.layers.find((l) => l.type === 'text')!.cssVars['--translate-x'])).toBe(
      10,
    );
  });

  it('keeps a stable API object when the document is unchanged', () => {
    const base = createEmptyDocument('Test');
    const { result, rerender } = renderHook(() => useCanvasHistory(base));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it(`caps undo stack at MAX_HISTORY (${MAX_HISTORY})`, () => {
    const base = createEmptyDocument('Test');
    const { result } = renderHook(() => useCanvasHistory(base));

    for (let i = 0; i < MAX_HISTORY + 10; i += 1) {
      act(() => {
        result.current.setDocument(withMovedText(result.current.document, i + 1));
      });
    }

    let undos = 0;
    while (result.current.canUndo) {
      act(() => {
        result.current.undo();
      });
      undos += 1;
      if (undos > MAX_HISTORY + 5) break;
    }
    expect(undos).toBe(MAX_HISTORY);
  });
});
