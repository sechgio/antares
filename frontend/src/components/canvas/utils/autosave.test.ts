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
  it('skips the size walk when the layer count already requires the large delay', () => {
    const doc = createEmptyDocument('Large by count');
    doc.layers = Array.from({ length: 81 }, (_, index) => ({ ...doc.layers[0]!, id: `layer-${index}` }));
    Object.defineProperty(doc.layers[0], 'value', { get: () => { throw new Error('unnecessary size walk'); } });
    expect(autosaveDelayForDoc(doc)).toBe(AUTOSAVE_LARGE_MS);
    expect(autosaveDelayForDoc(doc)).toBe(AUTOSAVE_LARGE_MS);
  });

  it.each([
    [40, AUTOSAVE_DEBOUNCE_MS], [41, AUTOSAVE_MEDIUM_MS],
    [80, AUTOSAVE_MEDIUM_MS], [81, AUTOSAVE_LARGE_MS],
  ])('preserves the layer boundary at %i layers', (count, delay) => {
    const doc = createEmptyDocument('Boundary');
    doc.layers = Array.from({ length: count }, (_, index) => ({ ...doc.layers[0]!, id: `layer-${index}` }));
    expect(autosaveDelayForDoc(doc)).toBe(delay);
  });

  it.each([
    [512 * 1024, AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MEDIUM_MS],
    [2 * 1024 * 1024, AUTOSAVE_MEDIUM_MS, AUTOSAVE_LARGE_MS],
  ])('preserves the byte boundary at %i bytes', (bytes, atBoundary, aboveBoundary) => {
    const doc = createEmptyDocument('Byte boundary');
    doc.layers[0]!.value = '';
    doc.layers[0]!.value = 'X'.repeat((bytes - estimateCanvasDocumentBytes(doc)) / 2);
    expect(estimateCanvasDocumentBytes(doc)).toBe(bytes);
    expect(autosaveDelayForDoc(doc)).toBe(atBoundary);
    const next = { ...doc, layers: [{ ...doc.layers[0]!, value: doc.layers[0]!.value + 'X' }] };
    expect(autosaveDelayForDoc(next)).toBe(aboveBoundary);
  });

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

  it('caches the delay per document object instead of re-walking per keystroke', () => {
    const doc = createEmptyDocument('Cached');
    expect(autosaveDelayForDoc(doc)).toBe(AUTOSAVE_DEBOUNCE_MS);

    doc.layers[0]!.value = 'X'.repeat(3 * 1024 * 1024);
    expect(autosaveDelayForDoc(doc)).toBe(AUTOSAVE_DEBOUNCE_MS);

    const nextRevision = { ...doc };
    expect(autosaveDelayForDoc(nextRevision)).toBe(AUTOSAVE_LARGE_MS);
  });
});
