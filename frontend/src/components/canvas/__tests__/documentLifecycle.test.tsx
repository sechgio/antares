/**
 * useDocumentLifecycle tests — the document-switch lifecycle owns the
 * save → persist history → cloud push → create/get → hydrate → replace chain.
 *
 * These pin the ordering and per-operation differences directly on the hook
 * (no 2,000-line component render): save-before-switch for open/new/duplicate,
 * no pre-save for delete, cloud queue calls, and viewport/selection resets.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, type CanvasDocument } from '../types';
import { MAX_HISTORY, useCanvasHistory } from '../hooks/useCanvasHistory';
import { useDocumentLifecycle } from '../hooks/useDocumentLifecycle';
import { useCanvasBootstrap } from '../hooks/useCanvasBootstrap';

vi.mock('../../../api', () => ({
  api: {
    canvasList: vi.fn(),
    canvasGet: vi.fn(),
    canvasSave: vi.fn(),
    canvasCreate: vi.fn(),
    canvasDelete: vi.fn(),
    canvasDuplicate: vi.fn(),
    canvasGetHistory: vi.fn(),
    canvasSaveHistory: vi.fn(),
  },
}));

vi.mock('../sync/cloudQueue', () => ({
  queueCanvasCloudPush: vi.fn(),
  queueCanvasCloudDelete: vi.fn(),
}));

vi.mock('../utils/imageBlobStore', () => ({
  serializeDocumentImages: vi.fn(async (doc: CanvasDocument) => doc),
  hydrateDocumentImages: vi.fn(async (doc: CanvasDocument) => doc),
  serializeHistorySteps: vi.fn(async (steps: unknown[]) => steps),
  hydrateHistorySteps: vi.fn(async (steps: unknown[]) => steps),
  applySavedDocumentKeepingImages: vi.fn((_editor: CanvasDocument, saved: CanvasDocument) => saved),
}));

import { api } from '../../../api';
import { queueCanvasCloudDelete, queueCanvasCloudPush } from '../sync/cloudQueue';
import { hydrateHistorySteps } from '../utils/imageBlobStore';

function makeDoc(id: string, name = id): CanvasDocument {
  const doc = createEmptyDocument(name);
  doc.id = id;
  doc.updatedAt = '2026-07-31T10:00:00.000Z';
  return doc;
}

interface HarnessMocks {
  refreshList: ReturnType<typeof vi.fn>;
  flashStatus: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  setSelectedIds: ReturnType<typeof vi.fn>;
  setPageIndex: ReturnType<typeof vi.fn>;
  setDocs: ReturnType<typeof vi.fn>;
  resetViewportPan: ReturnType<typeof vi.fn>;
}

function renderLifecycle(initial = makeDoc('doc-a', 'Alpha')) {
  const mocks: HarnessMocks = {
    refreshList: vi.fn(async () => {}),
    flashStatus: vi.fn(),
    setStatus: vi.fn(),
    setSelectedIds: vi.fn(),
    setPageIndex: vi.fn(),
    setDocs: vi.fn(),
    resetViewportPan: vi.fn(),
  };
  const utils = renderHook(() => {
    const history = useCanvasHistory(initial);
    const dismissedRemoteAtRef = useRef<string | null>(null);
    const historyReadyRef = useRef(true);
    const restoreGenerationRef = useRef(0);
    const lifecycle = useDocumentLifecycle({
      history,
      ...mocks,
      dismissedRemoteAtRef,
      historyReadyRef,
      restoreGenerationRef,
    });
    return { history, dismissedRemoteAtRef, historyReadyRef, restoreGenerationRef, ...lifecycle };
  });
  return { ...utils, mocks };
}

describe('useDocumentLifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.canvasSave).mockImplementation(async (doc: CanvasDocument) => ({ document: doc }));
    vi.mocked(api.canvasGetHistory).mockResolvedValue({ past: [], future: [] });
    vi.mocked(api.canvasSaveHistory).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('open: canvasSave(A) before canvasGet(B), restores history for B and resets UI', async () => {
    const callOrder: string[] = [];
    vi.mocked(api.canvasSave).mockImplementation(async (doc: CanvasDocument) => {
      callOrder.push(`save:${doc.id}`);
      return { document: doc };
    });
    vi.mocked(api.canvasGet).mockImplementation(async (id: string) => {
      callOrder.push(`get:${id}`);
      return { document: makeDoc(id, id) };
    });

    const { result, mocks } = renderLifecycle();
    await act(async () => {
      await result.current.onOpenDoc('doc-b');
    });

    expect(callOrder[0]).toBe('save:doc-a');
    expect(callOrder[1]).toBe('get:doc-b');
    expect(api.canvasGetHistory).toHaveBeenCalledWith('doc-b');
    expect(result.current.history.document.id).toBe('doc-b');
    expect(queueCanvasCloudPush).toHaveBeenCalledTimes(1);
    expect(mocks.setSelectedIds).toHaveBeenCalledWith([]);
    expect(mocks.setPageIndex).toHaveBeenCalledWith(0);
    expect(mocks.resetViewportPan).toHaveBeenCalled();
    expect(mocks.refreshList).toHaveBeenCalled();
  });

  it('open: no-op when id equals the open document', async () => {
    const { result } = renderLifecycle();
    await act(async () => {
      await result.current.onOpenDoc('doc-a');
    });
    expect(api.canvasSave).not.toHaveBeenCalled();
    expect(api.canvasGet).not.toHaveBeenCalled();
  });

  it('new: canvasSave(A) before canvasCreate, pushes saved doc and the new one', async () => {
    const callOrder: string[] = [];
    vi.mocked(api.canvasSave).mockImplementation(async (doc: CanvasDocument) => {
      callOrder.push(`save:${doc.id}`);
      return { document: doc };
    });
    vi.mocked(api.canvasCreate).mockImplementation(async () => {
      callOrder.push('create');
      return { document: makeDoc('doc-new', 'Sin título') };
    });

    const { result, mocks } = renderLifecycle();
    await act(async () => {
      await result.current.onNew();
    });

    expect(callOrder[0]).toBe('save:doc-a');
    expect(callOrder[1]).toBe('create');
    expect(result.current.history.document.id).toBe('doc-new');
    expect(queueCanvasCloudPush).toHaveBeenCalledTimes(2);
    expect(mocks.resetViewportPan).toHaveBeenCalled();
    expect(mocks.setPageIndex).toHaveBeenCalledWith(0);
  });

  it('duplicate: saves first, duplicates, keeps viewport pan (no reset)', async () => {
    const callOrder: string[] = [];
    vi.mocked(api.canvasSave).mockImplementation(async (doc: CanvasDocument) => {
      callOrder.push(`save:${doc.id}`);
      return { document: doc };
    });
    vi.mocked(api.canvasDuplicate).mockImplementation(async () => {
      callOrder.push('duplicate');
      return { document: makeDoc('doc-dup', 'Alpha copia') };
    });

    const { result, mocks } = renderLifecycle();
    await act(async () => {
      await result.current.onDuplicate();
    });

    expect(callOrder[0]).toBe('save:doc-a');
    expect(callOrder[1]).toBe('duplicate');
    expect(result.current.history.document.id).toBe('doc-dup');
    expect(queueCanvasCloudPush).toHaveBeenCalledTimes(2);
    expect(mocks.resetViewportPan).not.toHaveBeenCalled();
    expect(mocks.setPageIndex).toHaveBeenCalledWith(0);
    expect(mocks.setSelectedIds).toHaveBeenCalledWith([]);
    expect(mocks.flashStatus).toHaveBeenCalledWith('Duplicado');
  });

  it('delete: no pre-save, canvasDelete + cloud delete, opens first remaining doc', async () => {
    vi.mocked(api.canvasList).mockResolvedValue({
      documents: [
        { id: 'doc-b', name: 'Beta', updatedAt: '2026-07-31T11:00:00.000Z' },
        { id: 'doc-c', name: 'Gamma', updatedAt: '2026-07-31T12:00:00.000Z' },
      ],
    });
    vi.mocked(api.canvasGet).mockImplementation(async (id: string) => ({
      document: makeDoc(id, id),
    }));

    const { result, mocks } = renderLifecycle();
    await act(async () => {
      await result.current.onDeleteDoc();
    });

    expect(api.canvasSave).not.toHaveBeenCalled();
    expect(api.canvasDelete).toHaveBeenCalledWith('doc-a');
    expect(queueCanvasCloudDelete).toHaveBeenCalledWith('doc-a');
    expect(api.canvasGet).toHaveBeenCalledWith('doc-b');
    expect(api.canvasGetHistory).toHaveBeenCalledWith('doc-b');
    expect(result.current.history.document.id).toBe('doc-b');
    expect(mocks.setDocs).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'doc-b' })]),
    );
    expect(mocks.resetViewportPan).toHaveBeenCalled();
    expect(mocks.flashStatus).toHaveBeenCalledWith('Documento eliminado');
  });

  it('delete: creates a fresh doc when the list is empty and pushes it', async () => {
    vi.mocked(api.canvasList).mockResolvedValue({ documents: [] });
    vi.mocked(api.canvasCreate).mockResolvedValue({ document: makeDoc('doc-new', 'Sin título') });

    const { result } = renderLifecycle();
    await act(async () => {
      await result.current.onDeleteDoc();
    });

    expect(api.canvasCreate).toHaveBeenCalledWith('Sin título');
    expect(queueCanvasCloudPush).toHaveBeenCalledTimes(1);
    expect(result.current.history.document.id).toBe('doc-new');
  });

  it('save: keeps editor images, marks saved, pushes cloud and refreshes the list', async () => {
    const { result, mocks } = renderLifecycle();
    await act(async () => {
      await result.current.onSave();
    });

    expect(api.canvasSave).toHaveBeenCalled();
    expect(queueCanvasCloudPush).toHaveBeenCalledTimes(1);
    expect(mocks.refreshList).toHaveBeenCalled();
    expect(mocks.flashStatus).toHaveBeenCalledWith('Guardado');
    expect(result.current.history.hasUnsavedEditsRef.current).toBe(false);
  });

  it('save: leaves newer edits dirty when a stale save response resolves', async () => {
    let resolveSave: (value: { document: CanvasDocument }) => void = () => {};
    vi.mocked(api.canvasSave).mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    const { result } = renderLifecycle();
    await act(async () => {
      result.current.history.setDocument({ ...result.current.history.document, name: 'First edit' });
    });
    const savedSnapshot = result.current.history.document;
    const save = result.current.onSave();
    await act(async () => {
      await Promise.resolve();
      result.current.history.setDocument({ ...savedSnapshot, name: 'Newer edit' });
    });

    await act(async () => {
      resolveSave({ document: savedSnapshot });
      await save;
    });

    expect(result.current.history.document.name).toBe('Newer edit');
    expect(result.current.history.hasUnsavedEditsRef.current).toBe(true);
  });

  it('persists a replacement undo stack when it remains at MAX_HISTORY', async () => {
    vi.useFakeTimers();
    const { result } = renderLifecycle();
    let next = result.current.history.document;

    await act(async () => {
      for (let index = 0; index < MAX_HISTORY; index += 1) {
        next = { ...next, name: `Edit ${index}` };
        result.current.history.setDocument(next);
      }
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(result.current.history.past).toHaveLength(MAX_HISTORY);
    vi.mocked(api.canvasSaveHistory).mockClear();

    await act(async () => {
      result.current.history.setDocument({ ...next, name: 'Replacement edit' });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(api.canvasSaveHistory).toHaveBeenCalledWith(
      'doc-a',
      result.current.history.past,
      result.current.history.future,
    );
  });

  it('open: keeps the source document when it changes while loading the target', async () => {
    let resolveGet: (value: { document: CanvasDocument }) => void = () => {};
    vi.mocked(api.canvasGet).mockImplementation(
      () => new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    const { result, mocks } = renderLifecycle();
    const open = result.current.onOpenDoc('doc-b');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.canvasGet).toHaveBeenCalledWith('doc-b');
    await act(async () => {
      result.current.history.setDocument({ ...result.current.history.document, name: 'Edited while opening' });
      resolveGet({ document: makeDoc('doc-b', 'Beta') });
      await open;
    });

    expect(result.current.history.document).toMatchObject({ id: 'doc-a', name: 'Edited while opening' });
    expect(result.current.history.hasUnsavedEditsRef.current).toBe(true);
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.stringContaining('Repite la acción'));
  });

  it('new: keeps the source document when it changes while creating', async () => {
    let resolveCreate: (value: { document: CanvasDocument }) => void = () => {};
    vi.mocked(api.canvasCreate).mockImplementation(
      () => new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const { result, mocks } = renderLifecycle();
    const create = result.current.onNew();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.canvasCreate).toHaveBeenCalledWith('Sin título');
    await act(async () => {
      result.current.history.setDocument({ ...result.current.history.document, name: 'Edited while creating' });
      resolveCreate({ document: makeDoc('doc-new', 'Sin título') });
      await create;
    });

    expect(result.current.history.document).toMatchObject({ id: 'doc-a', name: 'Edited while creating' });
    expect(result.current.history.hasUnsavedEditsRef.current).toBe(true);
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.stringContaining('Repite la acción'));
  });

  it('duplicate: keeps the source document when it changes while duplicating', async () => {
    let resolveDuplicate: (value: { document: CanvasDocument }) => void = () => {};
    vi.mocked(api.canvasDuplicate).mockImplementation(
      () => new Promise((resolve) => {
        resolveDuplicate = resolve;
      }),
    );

    const { result, mocks } = renderLifecycle();
    const duplicate = result.current.onDuplicate();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.canvasDuplicate).toHaveBeenCalledWith('doc-a');
    await act(async () => {
      result.current.history.setDocument({ ...result.current.history.document, name: 'Edited while duplicating' });
      resolveDuplicate({ document: makeDoc('doc-dup', 'Alpha copia') });
      await duplicate;
    });

    expect(result.current.history.document).toMatchObject({ id: 'doc-a', name: 'Edited while duplicating' });
    expect(result.current.history.hasUnsavedEditsRef.current).toBe(true);
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.stringContaining('Repite la acción'));
  });

  it('open: ignores persisted history when the opened target changes during history hydration', async () => {
    const targetPast = [makeDoc('doc-b-history', 'Target history')];
    let resolveHistoryHydration: () => void = () => {};
    vi.mocked(api.canvasGet).mockResolvedValue({ document: makeDoc('doc-b', 'Beta') });
    vi.mocked(api.canvasGetHistory).mockResolvedValue({ past: targetPast, future: [] });
    vi.mocked(hydrateHistorySteps).mockImplementation(async (steps) => {
      if (steps === targetPast) {
        await new Promise<void>((resolve) => {
          resolveHistoryHydration = resolve;
        });
      }
      return steps;
    });

    const { result } = renderLifecycle();
    const open = result.current.onOpenDoc('doc-b');
    await waitFor(() => {
      expect(hydrateHistorySteps).toHaveBeenCalledWith(targetPast);
    });
    expect(result.current.history.document.id).toBe('doc-b');

    await act(async () => {
      result.current.history.setDocument({ ...result.current.history.document, name: 'Edited target' });
      resolveHistoryHydration();
      await open;
    });

    expect(result.current.history.document).toMatchObject({ id: 'doc-b', name: 'Edited target' });
    expect(result.current.history.past[0]).not.toBe(targetPast[0]);
    expect(result.current.history.hasUnsavedEditsRef.current).toBe(true);
  });

  it('keeps history unavailable while stale bootstrap A finishes during lifecycle B restoration', async () => {
    const bootstrapPast = [makeDoc('doc-a-history', 'Bootstrap history')];
    const targetPast = [makeDoc('doc-b-history', 'Target history')];
    let resolveBootstrapHydration: () => void = () => {};
    let resolveTargetHydration: () => void = () => {};
    vi.mocked(api.canvasList).mockResolvedValue({
      documents: [{ id: 'doc-a', name: 'Alpha', updatedAt: '2026-07-31T10:00:00.000Z' }],
    });
    vi.mocked(api.canvasGet).mockImplementation(async (id: string) => ({
      document: makeDoc(id, id === 'doc-a' ? 'Alpha' : 'Beta'),
    }));
    vi.mocked(api.canvasGetHistory).mockImplementation(async (id: string) => ({
      past: id === 'doc-a' ? bootstrapPast : targetPast,
      future: [],
    }));
    vi.mocked(hydrateHistorySteps).mockImplementation(async (steps) => {
      if (steps === bootstrapPast) {
        await new Promise<void>((resolve) => {
          resolveBootstrapHydration = resolve;
        });
      }
      if (steps === targetPast) {
        await new Promise<void>((resolve) => {
          resolveTargetHydration = resolve;
        });
      }
      return steps;
    });

    const { result } = renderHook(() => {
      const history = useCanvasHistory(makeDoc('doc-a', 'Alpha'));
      const historyReadyRef = useRef(false);
      const restoreGenerationRef = useRef(0);
      useCanvasBootstrap({
        replaceDocument: history.replaceDocument,
        restoreHistory: history.restoreHistory,
        historyReadyRef,
        restoreGenerationRef,
        currentDocumentRef: history.documentRef,
        currentRevisionRef: history.revisionRef,
        setDocs: vi.fn(),
        setLoading: vi.fn(),
        runCloudSync: vi.fn(async () => {}),
      });
      const lifecycle = useDocumentLifecycle({
        history,
        refreshList: vi.fn(async () => {}),
        flashStatus: vi.fn(),
        setStatus: vi.fn(),
        setSelectedIds: vi.fn(),
        setPageIndex: vi.fn(),
        setDocs: vi.fn(),
        resetViewportPan: vi.fn(),
        dismissedRemoteAtRef: useRef<string | null>(null),
        historyReadyRef,
        restoreGenerationRef,
      });
      return { historyReadyRef, ...lifecycle };
    });

    await waitFor(() => {
      expect(hydrateHistorySteps).toHaveBeenCalledWith(bootstrapPast);
    });
    const open = result.current.onOpenDoc('doc-b');
    await waitFor(() => {
      expect(hydrateHistorySteps).toHaveBeenCalledWith(targetPast);
    });

    await act(async () => {
      resolveBootstrapHydration();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.historyReadyRef.current).toBe(false);

    await act(async () => {
      resolveTargetHydration();
      await open;
    });
    expect(result.current.historyReadyRef.current).toBe(true);
  });

  it('lock: a switch started while another is in flight is dropped (no interleave)', async () => {
    let resolveSave: (value: { document: CanvasDocument }) => void = () => {};
    vi.mocked(api.canvasSave).mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    const { result } = renderLifecycle();
    const first = result.current.onOpenDoc('doc-b');
    // Flush microtasks so the first op reaches the in-flight canvasSave.
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.canvasSave).toHaveBeenCalledTimes(1);

    const second = result.current.onNew();
    await act(async () => {
      resolveSave({ document: makeDoc('doc-a', 'Alpha') });
      await first;
      await second;
    });

    expect(api.canvasCreate).not.toHaveBeenCalled();
    expect(api.canvasGet).toHaveBeenCalledWith('doc-b');
  });
});
