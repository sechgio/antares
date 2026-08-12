import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  useCanvasHistory,
  MAX_HISTORY,
  MAX_HISTORY_BYTES,
  estimateHistoryBytes,
  estimateStepBytes,
  trimHistoryByBudget,
} from '../hooks/useCanvasHistory';
import { createEmptyDocument, parseMm, type CanvasDocument } from '../types';
import type { HistoryStepDiff } from '../utils/canvasDiff';
import { computeDocumentDiff } from '../utils/canvasDiff';

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

  it('undo then redo restores the edited document', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text');
    text.cssVars['--translate-x'] = '10mm';
    base.layers.push(text);

    const { result } = renderHook(() => useCanvasHistory(base));

    act(() => {
      result.current.setDocument(withMovedText(result.current.document, 40));
    });
    expect(parseMm(result.current.document.layers.find((l) => l.type === 'text')!.cssVars['--translate-x'])).toBe(
      40,
    );

    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);
    expect(parseMm(result.current.document.layers.find((l) => l.type === 'text')!.cssVars['--translate-x'])).toBe(
      10,
    );

    act(() => {
      result.current.redo();
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(parseMm(result.current.document.layers.find((l) => l.type === 'text')!.cssVars['--translate-x'])).toBe(
      40,
    );
  });

  it('supports rapid successive undos in one act', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text');
    text.cssVars['--translate-x'] = '0mm';
    base.layers.push(text);

    const { result } = renderHook(() => useCanvasHistory(base));

    act(() => {
      result.current.setDocument(withMovedText(result.current.document, 10));
      result.current.setDocument(withMovedText(result.current.document, 20));
      result.current.setDocument(withMovedText(result.current.document, 30));
    });

    act(() => {
      result.current.undo();
      result.current.undo();
      result.current.undo();
    });

    expect(result.current.canUndo).toBe(false);
    expect(parseMm(result.current.document.layers.find((l) => l.type === 'text')!.cssVars['--translate-x'])).toBe(
      0,
    );

    act(() => {
      result.current.redo();
      result.current.redo();
    });
    expect(parseMm(result.current.document.layers.find((l) => l.type === 'text')!.cssVars['--translate-x'])).toBe(
      20,
    );
  });

  it('restoreHistory updates past and future stacks and respects MAX_HISTORY', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text');
    text.cssVars['--translate-x'] = '0mm';
    base.layers.push(text);

    const { result } = renderHook(() => useCanvasHistory(base));

    const pastDocs = Array.from({ length: 35 }, (_, i) => withMovedText(cloneDoc(base), i + 1));
    const futureDocs = [withMovedText(cloneDoc(base), 100)];

    act(() => {
      result.current.restoreHistory(pastDocs, futureDocs);
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.past.length).toBe(MAX_HISTORY);
    expect(result.current.future.length).toBe(1);
    // Restored undo history alone must not mark the document unsaved.
    expect(result.current.hasUnsavedEditsRef.current).toBe(false);

    act(() => {
      result.current.undo();
    });

    // Performing undo after restore diverges from the saved open doc.
    expect(result.current.hasUnsavedEditsRef.current).toBe(true);
    expect(parseMm(result.current.document.layers.find((l) => l.type === 'text')!.cssVars['--translate-x'])).toBe(
      35,
    );
  });

  it('dramatically reduces memory footprint for history with large Base64 image layers', () => {
    const base = createEmptyDocument('RAM Test');
    const largeValue = 'data:image/png;base64,' + 'X'.repeat(5 * 1024 * 1024); // 5 MB image
    const imageLayer = createLayer('image');
    imageLayer.value = largeValue;
    imageLayer.cssVars['--translate-x'] = '0mm';
    base.layers.push(imageLayer);

    const { result } = renderHook(() => useCanvasHistory(base));

    // Perform 20 moves on the image layer
    for (let i = 1; i <= 20; i++) {
      act(() => {
        result.current.setDocument({
          ...result.current.document,
          layers: result.current.document.layers.map((l) =>
            l.type === 'image'
              ? { ...l, cssVars: { ...l.cssVars, '--translate-x': `${i}mm` } }
              : l,
          ),
        });
      });
    }

    expect(result.current.past.length).toBe(20);

    // Calculate total JSON string size of past stack
    const pastJsonSize = JSON.stringify(result.current.past).length;

    // 20 full document copies with a 5MB image would be > 100 MB.
    // With structural diffs, unchanged value is NOT duplicated across history steps.
    // Total size of 20 diffs should be well under 100 KB (102,400 bytes)!
    expect(pastJsonSize).toBeLessThan(100 * 1024);

    // Verify undo still works all 20 steps back to 0mm
    act(() => {
      for (let i = 0; i < 20; i++) {
        result.current.undo();
      }
    });
    expect(parseMm(result.current.document.layers.find((l) => l.type === 'image')!.cssVars['--translate-x'])).toBe(0);
    expect(result.current.document.layers.find((l) => l.type === 'image')!.value).toBe(largeValue);
  });

  it('updateSilent is a no-op when the document reference is unchanged', () => {
    const base = createEmptyDocument('Test');
    const { result } = renderHook(() => useCanvasHistory(base));
    const before = result.current.document;
    act(() => {
      result.current.updateSilent(before);
    });
    expect(result.current.document).toBe(before);
  });

  it('tracks unsaved edits on setDocument and clears on replaceDocument', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text');
    text.cssVars['--translate-x'] = '0mm';
    base.layers.push(text);

    const { result } = renderHook(() => useCanvasHistory(base));
    expect(result.current.hasUnsavedEditsRef.current).toBe(false);

    act(() => {
      result.current.setDocument(withMovedText(result.current.document, 10));
    });
    expect(result.current.hasUnsavedEditsRef.current).toBe(true);
    expect(result.current.canUndo).toBe(true);

    const savedPast = result.current.past;
    const saved = cloneDoc(result.current.document);
    saved.updatedAt = '2026-07-31T12:00:00.000Z';
    act(() => {
      result.current.replaceDocument(saved);
      result.current.restoreHistory(savedPast, []);
    });
    // Post-save with restored undo stack: canUndo may be true, unsaved must be false.
    expect(result.current.canUndo).toBe(true);
    expect(result.current.hasUnsavedEditsRef.current).toBe(false);

    act(() => {
      result.current.undo();
    });
    // Undo after save must mark dirty so cloud sync does not clobber memory.
    expect(result.current.hasUnsavedEditsRef.current).toBe(true);

    act(() => {
      result.current.markSaved();
    });
    expect(result.current.hasUnsavedEditsRef.current).toBe(false);
  });

  it('marks unsaved on redo after undo', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text');
    text.cssVars['--translate-x'] = '0mm';
    base.layers.push(text);

    const { result } = renderHook(() => useCanvasHistory(base));
    act(() => {
      result.current.setDocument(withMovedText(result.current.document, 10));
    });
    act(() => {
      result.current.markSaved();
    });
    expect(result.current.hasUnsavedEditsRef.current).toBe(false);

    act(() => {
      result.current.undo();
    });
    expect(result.current.hasUnsavedEditsRef.current).toBe(true);

    act(() => {
      result.current.markSaved();
    });
    act(() => {
      result.current.redo();
    });
    expect(result.current.hasUnsavedEditsRef.current).toBe(true);
  });

  it('marks unsaved on commitFromBaseline', () => {
    const base = createEmptyDocument('Test');
    const text = createLayer('text');
    text.cssVars['--translate-x'] = '0mm';
    base.layers.push(text);

    const { result } = renderHook(() => useCanvasHistory(base));
    const baseline = cloneDoc(result.current.document);

    act(() => {
      result.current.updateSilent(withMovedText(result.current.document, 12));
      result.current.commitFromBaseline(baseline);
    });
    expect(result.current.hasUnsavedEditsRef.current).toBe(true);
  });

  it('exports a 64 MiB aggregate history budget', () => {
    expect(MAX_HISTORY_BYTES).toBe(64 * 1024 * 1024);
  });

  it('trimHistoryByBudget drops oldest past steps when bytes exceed budget', () => {
    const heavy = 'Y'.repeat(50_000);
    const steps: HistoryStepDiff[] = Array.from({ length: 10 }, (_, i) => {
      const a = createEmptyDocument(`a-${i}`);
      const b = createEmptyDocument(`b-${i}`);
      // Stuff large payload into a field so JSON size grows.
      a.layers.push({
        ...createLayer('text'),
        value: heavy,
      });
      b.layers.push({
        ...createLayer('text'),
        value: `${heavy}-${i}`,
      });
      return {
        type: 'diff' as const,
        undoDiff: computeDocumentDiff(b, a),
        redoDiff: computeDocumentDiff(a, b),
      };
    });

    const tinyBudget = estimateHistoryBytes(steps.slice(0, 2));
    const trimmed = trimHistoryByBudget(steps, [], MAX_HISTORY, tinyBudget);
    expect(trimmed.past.length).toBeLessThan(steps.length);
    expect(trimmed.past.length).toBeGreaterThan(0);
    expect(estimateHistoryBytes(trimmed.past)).toBeLessThanOrEqual(tinyBudget);
    // Newest steps retained (oldest dropped first).
    expect(trimmed.past[trimmed.past.length - 1]).toBe(steps[steps.length - 1]);
  });

  it('estimateStepBytes caches per-step size (steps are immutable)', () => {
    // JSON.stringify invokes toJSON; count it as a proxy for real serializations.
    const serializations = { count: 0 };
    const inner = {
      type: 'diff' as const,
      undoDiff: { modifiedLayers: [{ id: 'a', changes: { name: 'x' } }] },
      redoDiff: {},
    };
    const step = {
      ...inner,
      toJSON: () => {
        serializations.count += 1;
        return inner;
      },
    } as unknown as HistoryStepDiff;

    const first = estimateStepBytes(step);
    expect(first).toBeGreaterThan(0);
    expect(serializations.count).toBe(1);

    const second = estimateStepBytes(step);
    expect(second).toBe(first);
    expect(serializations.count).toBe(1);
  });

  it('trimHistoryByBudget reuses cached estimates across calls', () => {
    const serializations = { count: 0 };
    const makeStep = (i: number): HistoryStepDiff => {
      const inner = {
        type: 'diff' as const,
        undoDiff: { docPatch: { name: `undo-${i}` } },
        redoDiff: { docPatch: { name: `redo-${i}` } },
      };
      return {
        ...inner,
        toJSON: () => {
          serializations.count += 1;
          return inner;
        },
      } as unknown as HistoryStepDiff;
    };
    const steps = [makeStep(0), makeStep(1), makeStep(2)];

    const budget = estimateHistoryBytes(steps);
    expect(serializations.count).toBe(3);

    trimHistoryByBudget(steps, [], MAX_HISTORY, budget);
    trimHistoryByBudget(steps, [], MAX_HISTORY, budget - 1);
    expect(serializations.count).toBe(3);
  });

  it('enforces byte budget while keeping undo/redo and structural diffs', () => {
    const base = createEmptyDocument('Budget');
    const fat = 'data:image/png;base64,' + 'Z'.repeat(80_000);
    const image = createLayer('image');
    image.value = fat;
    image.cssVars['--translate-x'] = '0mm';
    base.layers.push(image);

    const { result } = renderHook(() => useCanvasHistory(base));

    for (let i = 1; i <= 8; i += 1) {
      act(() => {
        result.current.setDocument({
          ...result.current.document,
          layers: result.current.document.layers.map((l) =>
            l.type === 'image'
              ? {
                  ...l,
                  // Change value each step so diffs carry large payloads.
                  value: fat + String(i),
                  cssVars: { ...l.cssVars, '--translate-x': `${i}mm` },
                }
              : l,
          ),
        });
      });
    }

    const bytes = estimateHistoryBytes(result.current.past)
      + estimateHistoryBytes(result.current.future);
    expect(bytes).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
    expect(result.current.past.length).toBeLessThanOrEqual(MAX_HISTORY);
    expect(result.current.past.length).toBeGreaterThan(0);

    const beforeUndoX = parseMm(
      result.current.document.layers.find((l) => l.type === 'image')!.cssVars['--translate-x'],
    );
    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);
    expect(
      parseMm(result.current.document.layers.find((l) => l.type === 'image')!.cssVars['--translate-x']),
    ).toBe(beforeUndoX - 1);

    act(() => {
      result.current.redo();
    });
    expect(
      parseMm(result.current.document.layers.find((l) => l.type === 'image')!.cssVars['--translate-x']),
    ).toBe(beforeUndoX);

    // New edit after undo clears redo and still respects budgets.
    act(() => {
      result.current.undo();
      result.current.setDocument({
        ...result.current.document,
        layers: result.current.document.layers.map((l) =>
          l.type === 'image'
            ? { ...l, cssVars: { ...l.cssVars, '--translate-x': '99mm' } }
            : l,
        ),
      });
    });
    expect(result.current.canRedo).toBe(false);
    expect(result.current.past.length).toBeLessThanOrEqual(MAX_HISTORY);
  });
});
