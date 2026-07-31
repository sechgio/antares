import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { useCanvasHistory } from '../hooks/useCanvasHistory';
import { useGestureBaselines } from '../hooks/useGestureBaselines';
import { createEmptyDocument } from '../types';

describe('useGestureBaselines setPageLayersLive', () => {
  it('captures baseline without changing document when layers are referentially unchanged', () => {
    const base = createEmptyDocument('Test');
    base.layers.push(createLayer('rect', { pageIndex: 0 }));

    const { result } = renderHook(() => {
      const history = useCanvasHistory(base);
      const gesture = useGestureBaselines({ history, pageIndex: 0 });
      return { history, gesture };
    });

    const docBefore = result.current.history.document;
    act(() => {
      result.current.gesture.setPageLayersLive(docBefore.layers);
    });

    expect(result.current.history.document).toBe(docBefore);
    expect(result.current.gesture.gestureBaselineRef.current).not.toBeNull();
  });

  it('pushes live layers via updateSilent after geometry changes', () => {
    const base = createEmptyDocument('Test');
    const layer = createLayer('rect', { pageIndex: 0 });
    base.layers.push(layer);

    const { result } = renderHook(() => {
      const history = useCanvasHistory(base);
      const gesture = useGestureBaselines({ history, pageIndex: 0 });
      return { history, gesture };
    });

    const moved = [
      {
        ...layer,
        cssVars: { ...layer.cssVars, '--translate-x': '40mm' },
      },
    ];
    act(() => {
      result.current.gesture.setPageLayersLive(moved);
    });

    expect(result.current.history.document.layers[0]?.cssVars['--translate-x']).toBe('40mm');
  });
});
