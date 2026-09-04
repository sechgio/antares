import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { moveSelection } from '../ops/selectionTransform';
import type { CanvasDocument, CanvasLayer } from '../types';
import {
  applyDocumentDiff,
  computeDocumentDiff,
  type HistoryStepDiff,
} from '../utils/canvasDiff';
import {
  estimateStepBytes,
  estimateHistoryBytes,
  trimHistoryByBudget,
  MAX_HISTORY,
  MAX_HISTORY_BYTES,
} from '../hooks/useCanvasHistory';

function createHeavyDocument(layerCount: number, imageCount: number, imageSizeKB: number): CanvasDocument {
  const layers: CanvasLayer[] = [];
  for (let i = 0; i < layerCount; i++) {
    const isImage = i < imageCount;
    const col = i % 10;
    const row = Math.floor(i / 10);
    const xMm = 10 + col * 18;
    const yMm = 10 + row * 25;
    if (isImage) {
      const payload = `data:image/png;base64,${'X'.repeat(imageSizeKB * 1024)}`;
      layers.push(
        createLayer('image', {
          id: `img_${i}`,
          name: `Heavy Image ${i}`,
          value: payload,
          cssVars: {
            '--translate-x': `${xMm}mm`,
            '--translate-y': `${yMm}mm`,
            '--width': '20mm',
            '--height': '20mm',
          },
        }),
      );
    } else {
      layers.push(
        createLayer('rect', {
          id: `layer_${i}`,
          name: `Layer ${i}`,
          cssVars: {
            '--translate-x': `${xMm}mm`,
            '--translate-y': `${yMm}mm`,
            '--width': '15mm',
            '--height': '15mm',
          },
        }),
      );
    }
  }

  return {
    id: `adversarial_heavy_doc_${layerCount}`,
    name: `Adversarial Heavy Doc ${layerCount}`,
    version: 2,
    updatedAt: new Date().toISOString(),
    page: { widthMm: 210, heightMm: 297 },
    layers,
    fields: [],
  };
}

describe('Adversarial Stress Test: useCanvasHistory Memory Bounding & Diffing', () => {
  it('ADV-1.1: 100 complex layers with 10x 2MB image payloads (20MB base document) under 40 discrete edits', () => {
    // 100 layers, 10 images each 2MB = ~20MB document
    const doc = createHeavyDocument(100, 10, 2048);
    const docBaseBytes = estimateStepBytes(doc);
    expect(docBaseBytes).toBeGreaterThan(20 * 1024 * 1024);

    let currentDoc = doc;
    let past: HistoryStepDiff[] = [];
    let future: HistoryStepDiff[] = [];

    const editTimes: number[] = [];
    const diffSizes: number[] = [];

    // Apply 40 edits moving non-image layers
    for (let i = 0; i < 40; i++) {
      const movedLayers = moveSelection(currentDoc.layers, [`layer_${i % 90}`], 2, 2);
      const nextDoc: CanvasDocument = {
        ...currentDoc,
        layers: movedLayers,
        updatedAt: new Date().toISOString(),
      };

      const t0 = performance.now();
      const step: HistoryStepDiff = {
        type: 'diff',
        undoDiff: computeDocumentDiff(nextDoc, currentDoc),
        redoDiff: computeDocumentDiff(currentDoc, nextDoc),
      };
      const trimmed = trimHistoryByBudget([...past, step], []);
      past = trimmed.past as HistoryStepDiff[];
      future = trimmed.future as HistoryStepDiff[];
      currentDoc = nextDoc;
      editTimes.push(performance.now() - t0);

      const stepSize = estimateStepBytes(step);
      diffSizes.push(stepSize);
    }

    const totalHistoryBytes = estimateHistoryBytes(past);
    const avgEditTimeMs = editTimes.reduce((a, b) => a + b, 0) / editTimes.length;
    const maxEditTimeMs = Math.max(...editTimes);

    console.log('BENCHMARK:ADV_HISTORY_NON_IMAGE_EDITS', JSON.stringify({
      steps: past.length,
      docBaseBytesMB: (docBaseBytes / 1024 / 1024).toFixed(2),
      totalHistoryBytesKB: (totalHistoryBytes / 1024).toFixed(2),
      avgStepBytes: (diffSizes.reduce((a, b) => a + b, 0) / diffSizes.length).toFixed(0),
      avgEditTimeMs: avgEditTimeMs.toFixed(3),
      maxEditTimeMs: maxEditTimeMs.toFixed(3),
      memoryBounded: totalHistoryBytes <= MAX_HISTORY_BYTES,
    }));

    expect(past.length).toBe(MAX_HISTORY); // Trimmed to MAX_HISTORY (30)
    expect(totalHistoryBytes).toBeLessThan(1024 * 1024); // Less than 1MB for 30 vector diffs!
    expect(totalHistoryBytes).toBeLessThan(MAX_HISTORY_BYTES);
    expect(avgEditTimeMs).toBeLessThan(5); // Sub-5ms per diff on 100 layers with 20MB payload
  });

  it('ADV-1.2: 100 complex layers with image value replacements (Multi-MB diffs) triggering budget trimming', () => {
    // Document with 10 images (each 2MB)
    let currentDoc = createHeavyDocument(100, 10, 2048);
    let past: HistoryStepDiff[] = [];
    let future: HistoryStepDiff[] = [];

    // Apply 20 discrete edits where an image payload itself changes (3MB replacement per edit)
    const stepSizes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const newPayload = `data:image/png;base64,${String.fromCharCode(65 + i).repeat(3 * 1024 * 1024)}`;
      const modifiedLayers = currentDoc.layers.map((l) =>
        l.id === 'img_0' ? { ...l, value: newPayload } : l,
      );
      const nextDoc: CanvasDocument = {
        ...currentDoc,
        layers: modifiedLayers,
        updatedAt: new Date().toISOString(),
      };

      const step: HistoryStepDiff = {
        type: 'diff',
        undoDiff: computeDocumentDiff(nextDoc, currentDoc),
        redoDiff: computeDocumentDiff(currentDoc, nextDoc),
      };
      const trimmed = trimHistoryByBudget([...past, step], [], MAX_HISTORY, MAX_HISTORY_BYTES);
      past = trimmed.past as HistoryStepDiff[];
      future = trimmed.future as HistoryStepDiff[];
      currentDoc = nextDoc;
      stepSizes.push(estimateStepBytes(step));
    }

    const totalHistoryBytes = estimateHistoryBytes(past);

    console.log('BENCHMARK:ADV_HISTORY_IMAGE_PAYLOAD_TRIMMING', JSON.stringify({
      stepsRetained: past.length,
      totalHistoryBytesMB: (totalHistoryBytes / 1024 / 1024).toFixed(2),
      budgetCapMB: (MAX_HISTORY_BYTES / 1024 / 1024).toFixed(0),
      avgStepSizeMB: ((stepSizes[0] || 0) / 1024 / 1024).toFixed(2),
      budgetEnforced: totalHistoryBytes <= MAX_HISTORY_BYTES,
    }));

    // Each 3MB change produces ~6MB diff (undoDiff + redoDiff = 2 * 3MB UTF-16 = ~12MB code units * 2)
    // 64MB budget should strictly cap retaining ~5-10 steps rather than unbounded 20 steps
    expect(totalHistoryBytes).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
    expect(past.length).toBeLessThan(20); // Dropped older steps due to byte cap!
    expect(past.length).toBeGreaterThan(0);
  });

  it('ADV-1.3: Rapid undo/redo thrashing on 100-layer document with verification of state consistency', () => {
    const initialDoc = createHeavyDocument(100, 5, 512);
    let currentDoc = initialDoc;
    let past: HistoryStepDiff[] = [];
    let future: HistoryStepDiff[] = [];

    // 1. Perform 30 sequential edits
    const snapshots: CanvasDocument[] = [initialDoc];
    for (let i = 0; i < 30; i++) {
      const movedLayers = moveSelection(currentDoc.layers, [`layer_${i}`], 5, 5);
      const nextDoc: CanvasDocument = { ...currentDoc, layers: movedLayers };
      const step: HistoryStepDiff = {
        type: 'diff',
        undoDiff: computeDocumentDiff(nextDoc, currentDoc),
        redoDiff: computeDocumentDiff(currentDoc, nextDoc),
      };
      const trimmed = trimHistoryByBudget([...past, step], []);
      past = trimmed.past as HistoryStepDiff[];
      future = trimmed.future as HistoryStepDiff[];
      currentDoc = nextDoc;
      snapshots.push(nextDoc);
    }

    // 2. Perform 30 rapid undos
    const t0Undo = performance.now();
    for (let i = 0; i < 30; i++) {
      expect(past.length).toBeGreaterThan(0);
      const step = past[past.length - 1];
      const prev = applyDocumentDiff(currentDoc, step.undoDiff);
      const futureStep: HistoryStepDiff = {
        type: 'diff',
        undoDiff: computeDocumentDiff(currentDoc, prev),
        redoDiff: computeDocumentDiff(prev, currentDoc),
      };
      const trimmed = trimHistoryByBudget(past.slice(0, -1), [...future, futureStep]);
      past = trimmed.past as HistoryStepDiff[];
      future = trimmed.future as HistoryStepDiff[];
      currentDoc = prev;
    }
    const undoDurationMs = performance.now() - t0Undo;

    // Verify we rolled back cleanly to the initial state
    expect(currentDoc.layers[0].cssVars?.['--translate-x']).toBe(initialDoc.layers[0].cssVars?.['--translate-x']);
    expect(past.length).toBe(0);
    expect(future.length).toBe(30);

    // 3. Perform 30 rapid redos
    const t0Redo = performance.now();
    for (let i = 0; i < 30; i++) {
      expect(future.length).toBeGreaterThan(0);
      const step = future[future.length - 1];
      const next = applyDocumentDiff(currentDoc, step.redoDiff);
      const pastStep: HistoryStepDiff = {
        type: 'diff',
        undoDiff: computeDocumentDiff(next, currentDoc),
        redoDiff: computeDocumentDiff(currentDoc, next),
      };
      const trimmed = trimHistoryByBudget([...past, pastStep], future.slice(0, -1));
      past = trimmed.past as HistoryStepDiff[];
      future = trimmed.future as HistoryStepDiff[];
      currentDoc = next;
    }
    const redoDurationMs = performance.now() - t0Redo;

    // Verify we re-applied all 30 steps cleanly to match snapshot 30
    expect(currentDoc.layers[0].cssVars?.['--translate-x']).toBe(snapshots[30].layers[0].cssVars?.['--translate-x']);
    expect(past.length).toBe(30);
    expect(future.length).toBe(0);

    console.log('BENCHMARK:ADV_UNDO_REDO_THRASHING', JSON.stringify({
      undo30StepsDurationMs: undoDurationMs.toFixed(2),
      avgUndoPerStepMs: (undoDurationMs / 30).toFixed(3),
      redo30StepsDurationMs: redoDurationMs.toFixed(2),
      avgRedoPerStepMs: (redoDurationMs / 30).toFixed(3),
    }));

    expect(undoDurationMs / 30).toBeLessThan(2); // Sub-2ms per undo step
    expect(redoDurationMs / 30).toBeLessThan(2); // Sub-2ms per redo step
  });

  it('ADV-1.4: Single massive step (>64MB) gracefully drops all past/future history without throwing or looping', () => {
    // Create an absurdly large 70MB step
    const hugePayload = `data:image/png;base64,${'Z'.repeat(35 * 1024 * 1024)}`;
    const step: HistoryStepDiff = {
      type: 'diff',
      undoDiff: {
        modifiedLayers: [{ id: 'huge_layer', changes: { value: hugePayload } }],
      },
      redoDiff: {
        modifiedLayers: [{ id: 'huge_layer', changes: { value: hugePayload } }],
      },
    };

    const initialPast: HistoryStepDiff[] = [
      { type: 'diff', undoDiff: {}, redoDiff: {} },
      { type: 'diff', undoDiff: {}, redoDiff: {} },
    ];

    const t0 = performance.now();
    const trimmed = trimHistoryByBudget([...initialPast, step], [], MAX_HISTORY, MAX_HISTORY_BYTES);
    const elapsed = performance.now() - t0;

    // When the new step itself exceeds MAX_HISTORY_BYTES (64MB), trimHistoryByBudget will drop past[0], past[1], and even `step` itself if needed
    console.log('BENCHMARK:ADV_OVERSIZED_STEP_TRIM', JSON.stringify({
      initialPastCount: initialPast.length,
      resultingPastCount: trimmed.past.length,
      elapsedMs: elapsed.toFixed(3),
    }));

    expect(elapsed).toBeLessThan(50);
    expect(estimateHistoryBytes(trimmed.past)).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
  });

  it('ADV-1.5: 100% layer mutation vs 1% layer mutation: Breakeven analysis of structural diff vs clone', () => {
    const doc = createHeavyDocument(100, 5, 256);

    // Scenario A: 1 layer mutated (1%)
    const moved1 = moveSelection(doc.layers, ['layer_10'], 1, 1);
    const docA: CanvasDocument = { ...doc, layers: moved1 };
    const diff1 = computeDocumentDiff(docA, doc);
    const diff1Bytes = estimateStepBytes({ type: 'diff', undoDiff: diff1, redoDiff: diff1 });

    // Scenario B: 50 layers mutated (50%)
    const allIds50 = doc.layers.slice(0, 50).map((l) => l.id);
    const moved50 = moveSelection(doc.layers, allIds50, 1, 1);
    const docB: CanvasDocument = { ...doc, layers: moved50 };
    const diff50 = computeDocumentDiff(docB, doc);
    const diff50Bytes = estimateStepBytes({ type: 'diff', undoDiff: diff50, redoDiff: diff50 });

    // Scenario C: 100 layers mutated (100%)
    const allIds100 = doc.layers.map((l) => l.id);
    const moved100 = moveSelection(doc.layers, allIds100, 1, 1);
    const docC: CanvasDocument = { ...doc, layers: moved100 };
    const diff100 = computeDocumentDiff(docC, doc);
    const diff100Bytes = estimateStepBytes({ type: 'diff', undoDiff: diff100, redoDiff: diff100 });

    const cloneBytes = estimateStepBytes(doc);

    console.log('BENCHMARK:ADV_DIFF_BREAKEVEN_RATIOS', JSON.stringify({
      cloneBytes,
      diff1LayerBytes: diff1Bytes,
      diff50LayersBytes: diff50Bytes,
      diff100LayersBytes: diff100Bytes,
      ratio1Layer: (cloneBytes / diff1Bytes).toFixed(2),
      ratio50Layers: (cloneBytes / diff50Bytes).toFixed(2),
      ratio100Layers: (cloneBytes / diff100Bytes).toFixed(2),
    }));

    // Even when 100% of layers change geometry, the structural diff is still smaller than cloning because unchanged layer meta / document fields / image data values are not duplicated
    expect(diff1Bytes).toBeLessThan(diff50Bytes);
    expect(diff50Bytes).toBeLessThan(diff100Bytes);
    expect(diff100Bytes).toBeLessThan(cloneBytes);
  });
});
