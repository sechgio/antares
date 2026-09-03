import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../types';
import { useCanvasHistory } from '../hooks/useCanvasHistory';

describe('useCanvasHistory dirty flag', () => {
  it('tracks discrete edits, markSaved, undo and replaceDocument', () => {
    const doc = createEmptyDocument('Doc');
    const { result } = renderHook(() => useCanvasHistory(doc));

    expect(result.current.hasUnsavedEdits).toBe(false);

    act(() => {
      result.current.setDocument({ ...result.current.document, name: 'Editado' });
    });
    expect(result.current.hasUnsavedEdits).toBe(true);
    expect(result.current.hasUnsavedEditsRef.current).toBe(true);

    act(() => {
      result.current.markSaved();
    });
    expect(result.current.hasUnsavedEdits).toBe(false);

    act(() => {
      result.current.setDocument({ ...result.current.document, name: 'Otra vez' });
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.hasUnsavedEdits).toBe(true);

    act(() => {
      result.current.replaceDocument(createEmptyDocument('Cargado'));
    });
    expect(result.current.hasUnsavedEdits).toBe(false);
  });

  it('commitFromBaseline (gesture end) marks dirty without changing the document', () => {
    const doc = createEmptyDocument('Doc');
    const { result } = renderHook(() => useCanvasHistory(doc));
    const baseline = result.current.document;
    act(() => {
      result.current.updateSilent({ ...baseline, name: 'Preview' });
    });
    act(() => {
      result.current.commitFromBaseline(baseline);
    });
    expect(result.current.hasUnsavedEdits).toBe(true);
    expect(result.current.document.name).toBe('Preview');
  });
});
