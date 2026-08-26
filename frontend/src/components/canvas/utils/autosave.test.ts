/** Regression tests for the adaptive autosave budget estimator. */
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument } from '../types';
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_LARGE_MS,
  AUTOSAVE_MEDIUM_MS,
  autosaveDelayForDoc,
  estimateCanvasDocumentBytes,
} from './autosave';

describe('adaptive autosave budget', () => {
  it('estimates a large image document without serializing the whole document', () => {
    const doc = createEmptyDocument('Large');
    doc.layers[0]!.value = 'data:image/png;base64,' + 'X'.repeat(2 * 1024 * 1024);
    const stringify = vi.spyOn(JSON, 'stringify');

    try {
      expect(estimateCanvasDocumentBytes(doc)).toBeGreaterThan(2 * 1024 * 1024);
      expect(autosaveDelayForDoc(doc)).toBe(AUTOSAVE_LARGE_MS);
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
  });

  it('uses the medium delay for a document above the medium byte threshold', () => {
    const doc = createEmptyDocument('Medium');
    doc.layers[0]!.value = 'X'.repeat(300 * 1024);

    expect(autosaveDelayForDoc(doc)).toBe(AUTOSAVE_MEDIUM_MS);
  });

  it('uses the medium delay for many small layers without a full serialization', () => {
    const doc = createEmptyDocument('Many layers');
    doc.layers = Array.from({ length: 41 }, (_, index) => ({
      ...doc.layers[0]!,
      id: `layer-${index}`,
    }));

    expect(autosaveDelayForDoc(doc)).toBe(AUTOSAVE_MEDIUM_MS);
  });

  it('keeps an empty document on the short debounce', () => {
    expect(autosaveDelayForDoc(null)).toBe(AUTOSAVE_DEBOUNCE_MS);
  });
});
