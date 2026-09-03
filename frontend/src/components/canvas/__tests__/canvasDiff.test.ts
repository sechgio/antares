import { describe, expect, it } from 'vitest';
import { createEmptyDocument, newId } from '../types';
import type { CanvasDocument, CanvasLayer } from '../types';
import { applyDocumentDiff, computeDocumentDiff } from '../utils/canvasDiff';

describe('canvasDiff', () => {
  it('returns empty diff for identical documents', () => {
    const doc = createEmptyDocument('Test');
    const diff = computeDocumentDiff(doc, doc);
    expect(diff).toEqual({});
  });

  it('correctly tracks layer position changes without copying value property', () => {
    const doc1 = createEmptyDocument('Test');
    const largeImageValue = 'data:image/png;base64,' + 'A'.repeat(1000000);
    const imageLayer: CanvasLayer = {
      id: newId(),
      type: 'image',
      name: 'Big Image',
      value: largeImageValue,
      pageIndex: 0,
      cssVars: {
        '--width': '100mm',
        '--height': '100mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    };
    doc1.layers.push(imageLayer);

    const doc2: CanvasDocument = {
      ...doc1,
      layers: doc1.layers.map((l) =>
        l.id === imageLayer.id
          ? { ...l, cssVars: { ...l.cssVars, '--translate-x': '10mm' } }
          : l,
      ),
    };

    const redoDiff = computeDocumentDiff(doc1, doc2);
    const undoDiff = computeDocumentDiff(doc2, doc1);

    expect(redoDiff.modifiedLayers).toHaveLength(1);
    expect(redoDiff.modifiedLayers![0].changes.value).toBeUndefined();
    expect(redoDiff.modifiedLayers![0].changes.cssVars).toEqual({
      '--width': '100mm',
      '--height': '100mm',
      '--translate-x': '10mm',
      '--translate-y': '0mm',
    });

    const jsonSize = JSON.stringify(redoDiff).length;
    expect(jsonSize).toBeLessThan(500);

    const restoredDoc2 = applyDocumentDiff(doc1, redoDiff);
    expect(restoredDoc2).toEqual(doc2);

    const restoredDoc1 = applyDocumentDiff(doc2, undoDiff);
    expect(restoredDoc1).toEqual(doc1);
  });

  it('correctly tracks adding and removing layers', () => {
    const doc1 = createEmptyDocument('Test');
    const newLayer: CanvasLayer = {
      id: newId(),
      type: 'text',
      name: 'Added Text',
      value: 'Hello',
      pageIndex: 0,
      cssVars: { '--width': '50mm', '--height': '10mm', '--translate-x': '5mm', '--translate-y': '5mm' },
    };

    const doc2: CanvasDocument = {
      ...doc1,
      layers: [...doc1.layers, newLayer],
    };

    const redoDiff = computeDocumentDiff(doc1, doc2);
    expect(redoDiff.addedLayers).toHaveLength(1);
    expect(redoDiff.addedLayers![0].id).toBe(newLayer.id);

    const undoDiff = computeDocumentDiff(doc2, doc1);
    expect(undoDiff.removedLayerIds).toEqual([newLayer.id]);

    expect(applyDocumentDiff(doc1, redoDiff)).toEqual(doc2);
    expect(applyDocumentDiff(doc2, undoDiff)).toEqual(doc1);
  });

  it('correctly tracks document metadata and settings changes', () => {
    const doc1 = createEmptyDocument('Test 1');
    const doc2: CanvasDocument = {
      ...doc1,
      name: 'Renamed Document',
      settings: { snapToGrid: true, gridSizeMm: 10 },
    };

    const diff = computeDocumentDiff(doc1, doc2);
    expect(diff.docPatch).toEqual({
      name: 'Renamed Document',
      settings: { snapToGrid: true, gridSizeMm: 10 },
    });

    expect(applyDocumentDiff(doc1, diff)).toEqual(doc2);
  });
});
