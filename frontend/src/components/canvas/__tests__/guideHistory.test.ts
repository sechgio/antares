import { describe, expect, it } from 'vitest';
import { createGuide, removeGuide, upsertGuide } from '../ops/guides';
import { useCanvasHistory } from '../hooks/useCanvasHistory';
import { createEmptyDocument } from '../types';
import { renderHook, act } from '@testing-library/react';

describe('guide creation history', () => {
  it('cancel after live preview leaves no undo entry', () => {
    const initial = createEmptyDocument('Guides');
    const { result } = renderHook(() => useCanvasHistory(initial));

    const guide = createGuide('x', 42, 0);
    let baseline: typeof initial | null = null;

    act(() => {
      baseline = result.current.document;
      result.current.updateSilent(upsertGuide(result.current.document, guide));
    });
    expect(result.current.document.guides).toHaveLength(1);
    expect(result.current.past).toHaveLength(0);

    act(() => {
      result.current.updateSilent(removeGuide(result.current.document, guide.id));
    });
    expect(result.current.document.guides).toHaveLength(0);
    expect(result.current.past).toHaveLength(0);

    act(() => {
      result.current.updateSilent(upsertGuide(result.current.document, guide));
      result.current.commitFromBaseline(baseline!);
    });
    expect(result.current.past).toHaveLength(1);

    act(() => {
      result.current.undo();
    });
    expect(result.current.document.guides ?? []).toHaveLength(0);
  });
});
