/**
 * CanvasView lifecycle tests (plan 010).
 *
 * Mocks heavy editor chrome (DesignStage, RightPanel, …) so we can assert
 * save-on-switch, history debounce, and sync conflict without mounting Artboard.
 * LeftSidebar + TopBar + SyncConflictBar stay real for the UI paths under test.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, type CanvasDocument } from '../types';

const pdfImportMocks = vi.hoisted(() => ({
  inspectPdfFile: vi.fn(),
  importPdfFile: vi.fn(),
}));

vi.mock('../import/importPdf', () => pdfImportMocks);

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
}

const syncCanvasDocuments = vi.fn();

vi.mock('../../../api', () => ({
  onNotify: vi.fn(() => () => {}),
  api: {
    canvasList: vi.fn(),
    canvasGet: vi.fn(),
    canvasSave: vi.fn(async (doc: CanvasDocument) => ({ document: doc })),
    canvasCreate: vi.fn(),
    canvasDelete: vi.fn(async () => ({ success: true })),
    canvasDuplicate: vi.fn(),
    canvasGetHistory: vi.fn(async () => ({ past: [], future: [] })),
    canvasSaveHistory: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: null,
}));

vi.mock('../sync/canvasCloudSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync/canvasCloudSync')>();
  return {
    ...actual,
    syncCanvasDocuments: (...args: unknown[]) => syncCanvasDocuments(...args),
  };
});

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
  clearBlobStore: vi.fn(),
  releaseImageBlob: vi.fn(),
  sweepOrphanBlobs: vi.fn(() => 0),
  collectImageRefsFromLayers: vi.fn(() => new Set<string>()),
  collectImageRefsFromHistory: vi.fn(() => new Set<string>()),
  trackImageRef: vi.fn(),
  registerImageBlob: vi.fn(async (blob: Blob) => ({
    blobId: 'img_blob_mock',
    blob,
    url: 'blob:mock',
    thumbnailUrl: 'blob:mock',
    width: 0,
    height: 0,
  })),
  getBlobUrl: vi.fn((v: string) => v),
  getThumbnailUrl: vi.fn((v: string) => v),
}));

vi.mock('../presets/loadPresets', () => ({
  loadCanvasPresets: vi.fn(async () => []),
}));

vi.mock('../editor/DesignStage', () => ({
  default: () => <div data-testid="mock-design-stage" />,
}));

vi.mock('../editor/RightPanel', () => ({
  default: () => null,
}));

vi.mock('../editor/BottomToolbar', () => ({
  default: () => null,
}));

vi.mock('../editor/PreviewViewport', () => ({
  default: () => null,
}));

vi.mock('../editor/PageLayerPreview', () => ({
  default: () => null,
}));

vi.mock('../editor/ContextMenu', () => ({
  default: () => null,
}));

vi.mock('../editor/PathEditToolbar', () => ({
  default: () => null,
}));

vi.mock('../editor/GeneratePanel', () => ({
  default: () => null,
}));

import { api } from '../../../api';
import CanvasView from '../CanvasView';
import { useCanvasBootstrap } from '../hooks/useCanvasBootstrap';
import { queueCanvasCloudPush } from '../sync/cloudQueue';

function makeDoc(id: string, name = id): CanvasDocument {
  const doc = createEmptyDocument(name);
  doc.id = id;
  doc.updatedAt = '2026-07-31T10:00:00.000Z';
  return doc;
}

describe('CanvasView lifecycle', () => {
  const docA = makeDoc('doc-a', 'Alpha');
  const docB = makeDoc('doc-b', 'Beta');

  beforeEach(() => {
    vi.useRealTimers();
    syncCanvasDocuments.mockReset();
    syncCanvasDocuments.mockResolvedValue({
      pulled: 0,
      pushed: 0,
      deletedLocal: 0,
      skipped: true,
      reason: 'no-supabase',
      pushErrors: 0,
    });

    vi.mocked(api.canvasList).mockResolvedValue({
      documents: [
        { id: docA.id, name: docA.name, updatedAt: docA.updatedAt! },
        { id: docB.id, name: docB.name, updatedAt: docB.updatedAt! },
      ],
    });
    vi.mocked(api.canvasGet).mockImplementation(async (id: string) => ({
      document: id === docB.id ? docB : docA,
    }));
    vi.mocked(api.canvasSave).mockImplementation(async (doc: CanvasDocument) => ({ document: doc }));
    vi.mocked(api.canvasCreate).mockResolvedValue({ document: makeDoc('doc-new', 'Sin título') });
    vi.mocked(api.canvasDuplicate).mockResolvedValue({ document: makeDoc('doc-dup', 'Alpha copia') });
    vi.mocked(api.canvasGetHistory).mockResolvedValue({ past: [], future: [] });
    vi.mocked(api.canvasSaveHistory).mockResolvedValue({ success: true });
    pdfImportMocks.inspectPdfFile.mockReset();
    pdfImportMocks.importPdfFile.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function renderReady() {
    render(<CanvasView active />);
    await waitFor(() => {
      expect(screen.queryByTestId('mock-design-stage')).toBeTruthy();
    });
    // Bootstrap finished (loading veil gone / stage visible).
    await waitFor(() => {
      expect(api.canvasList).toHaveBeenCalled();
    });
  }

  it('skips bootstrap history when the active document changes before it resolves', async () => {
    let resolveHistory: (value: { past: CanvasDocument[]; future: CanvasDocument[] }) => void = () => {};
    const currentDocumentRef = { current: docA };
    const currentRevisionRef = { current: 0 };
    const restoreHistory = vi.fn();
    vi.mocked(api.canvasGetHistory).mockImplementation(
      () => new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );

    renderHook(() =>
      useCanvasBootstrap({
        replaceDocument: (document) => {
          currentDocumentRef.current = document;
          currentRevisionRef.current = 1;
        },
        restoreHistory,
        historyReadyRef: { current: false },
        restoreGenerationRef: { current: 0 },
        currentDocumentRef,
        currentRevisionRef,
        setDocs: vi.fn(),
        setLoading: vi.fn(),
        runCloudSync: vi.fn(async () => {}),
      }),
    );
    await waitFor(() => {
      expect(api.canvasGetHistory).toHaveBeenCalledWith(docA.id);
    });

    currentDocumentRef.current = docB;
    currentRevisionRef.current = 2;
    await act(async () => {
      resolveHistory({ past: [{ ...docA, name: 'A undo state' }], future: [] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(restoreHistory).not.toHaveBeenCalled();
  });

  it('skips bootstrap history when the active document revision changes before it resolves', async () => {
    let resolveHistory: (value: { past: CanvasDocument[]; future: CanvasDocument[] }) => void = () => {};
    const currentDocumentRef = { current: docA };
    const currentRevisionRef = { current: 0 };
    const restoreHistory = vi.fn();
    vi.mocked(api.canvasGetHistory).mockImplementation(
      () => new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );

    renderHook(() =>
      useCanvasBootstrap({
        replaceDocument: (document) => {
          currentDocumentRef.current = document;
          currentRevisionRef.current = 1;
        },
        restoreHistory,
        historyReadyRef: { current: false },
        restoreGenerationRef: { current: 0 },
        currentDocumentRef,
        currentRevisionRef,
        setDocs: vi.fn(),
        setLoading: vi.fn(),
        runCloudSync: vi.fn(async () => {}),
      }),
    );
    await waitFor(() => {
      expect(api.canvasGetHistory).toHaveBeenCalledWith(docA.id);
    });

    currentRevisionRef.current = 2;
    await act(async () => {
      resolveHistory({ past: [{ ...docA, name: 'A undo state' }], future: [] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(restoreHistory).not.toHaveBeenCalled();
  });

  it('smoke: renders without throwing', async () => {
    await renderReady();
    expect(screen.getByTestId('mock-design-stage')).toBeInTheDocument();
  });

  it('save-on-switch: canvasSave(A) before canvasGet(B) when opening another doc', async () => {
    const callOrder: string[] = [];
    vi.mocked(api.canvasSave).mockImplementation(async (doc: CanvasDocument) => {
      callOrder.push(`save:${doc.id}`);
      return { document: doc };
    });
    vi.mocked(api.canvasGet).mockImplementation(async (id: string) => {
      callOrder.push(`get:${id}`);
      return { document: id === docB.id ? docB : docA };
    });

    await renderReady();
    // Bootstrap may have called get for A — clear order after ready.
    callOrder.length = 0;
    vi.mocked(api.canvasSave).mockClear();
    vi.mocked(api.canvasGet).mockClear();
    vi.mocked(api.canvasGet).mockImplementation(async (id: string) => {
      callOrder.push(`get:${id}`);
      return { document: id === docB.id ? docB : docA };
    });
    vi.mocked(api.canvasSave).mockImplementation(async (doc: CanvasDocument) => {
      callOrder.push(`save:${doc.id}`);
      return { document: doc };
    });

    const fileSelect = screen.getByLabelText('Archivo abierto');
    fireEvent.change(fileSelect, { target: { value: docB.id } });

    await waitFor(() => {
      expect(callOrder).toContain(`save:${docA.id}`);
      expect(callOrder).toContain(`get:${docB.id}`);
    });
    expect(callOrder.indexOf(`save:${docA.id}`)).toBeLessThan(callOrder.indexOf(`get:${docB.id}`));
    expect(vi.mocked(api.canvasGetHistory)).toHaveBeenCalledWith(docB.id);
  });

  it('save-on-switch: canvasSave before canvasCreate on Nuevo', async () => {
    await renderReady();
    vi.mocked(api.canvasSave).mockClear();
    vi.mocked(api.canvasCreate).mockClear();

    const callOrder: string[] = [];
    vi.mocked(api.canvasSave).mockImplementation(async (doc: CanvasDocument) => {
      callOrder.push(`save:${doc.id}`);
      return { document: doc };
    });
    vi.mocked(api.canvasCreate).mockImplementation(async () => {
      callOrder.push('create');
      return { document: makeDoc('doc-new', 'Sin título') };
    });

    fireEvent.click(screen.getByLabelText('Nuevo'));

    await waitFor(() => {
      expect(callOrder).toContain('create');
    });
    expect(callOrder[0]?.startsWith('save:')).toBe(true);
    expect(callOrder.indexOf('create')).toBeGreaterThan(callOrder.findIndex((c) => c.startsWith('save:')));
  });

  it('waits for bootstrap history restoration before persisting it', async () => {
    let resolveGet: (value: { document: CanvasDocument }) => void = () => {};
    let resolveHistory: (value: { past: CanvasDocument[]; future: CanvasDocument[] }) => void = () => {};
    const restoredPast = [{ ...docA, name: 'Restored undo state' }];
    vi.mocked(api.canvasGet).mockImplementation(
      () => new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );
    vi.mocked(api.canvasGetHistory).mockImplementation(
      () => new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );

    render(<CanvasView active />);
    await waitFor(() => {
      expect(api.canvasGet).toHaveBeenCalledWith(docA.id);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await act(async () => {
      resolveGet({ document: docA });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.canvasGetHistory).toHaveBeenCalledWith(docA.id);
    vi.mocked(api.canvasSaveHistory).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(api.canvasSaveHistory).not.toHaveBeenCalled();

    await act(async () => {
      resolveHistory({ past: restoredPast, future: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(api.canvasSaveHistory).toHaveBeenCalledWith(docA.id, restoredPast, []);
  });

  it('debounces canvasSaveHistory 500ms and skips when signature unchanged', async () => {
    await renderReady();
    vi.mocked(api.canvasSaveHistory).mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // Add a page → past grows (discrete history entry).
    fireEvent.click(screen.getByLabelText('Añadir página'));

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(api.canvasSaveHistory).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(api.canvasSaveHistory).toHaveBeenCalled();
    const firstCall = vi.mocked(api.canvasSaveHistory).mock.calls.at(-1)!;
    expect(firstCall[1].length).toBeGreaterThanOrEqual(1);

    const callsAfterFirst = vi.mocked(api.canvasSaveHistory).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(vi.mocked(api.canvasSaveHistory).mock.calls.length).toBe(callsAfterFirst);
  });

  it('conflict keep-local consolidates with save+push force; same remote ts does not reappear; use-remote saves', async () => {
    const localDoc = makeDoc('doc-a', 'Local');
    const remoteDoc = makeDoc('doc-a', 'Remote');
    remoteDoc.updatedAt = '2026-07-31T12:00:00.000Z';
    localDoc.updatedAt = '2026-07-31T10:00:00.000Z';

    const conflict = {
      localDoc,
      remoteDoc,
      localUpdatedAt: localDoc.updatedAt!,
      remoteUpdatedAt: remoteDoc.updatedAt!,
    };

    // Bootstrap sync skips; later focus sync returns conflict once.
    let syncCalls = 0;
    syncCanvasDocuments.mockImplementation(async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        return {
          pulled: 0,
          pushed: 0,
          deletedLocal: 0,
          skipped: true,
          reason: 'no-supabase',
          pushErrors: 0,
        };
      }
      return {
        pulled: 0,
        pushed: 0,
        deletedLocal: 0,
        skipped: false,
        pushErrors: 0,
        conflict,
      };
    });

    vi.mocked(api.canvasList).mockResolvedValue({
      documents: [{ id: localDoc.id, name: localDoc.name, updatedAt: localDoc.updatedAt! }],
    });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: localDoc });

    await renderReady();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-conflict-bar')).toBeInTheDocument();
    });

    vi.mocked(api.canvasSave).mockClear();
    vi.mocked(queueCanvasCloudPush).mockClear();
    fireEvent.click(screen.getByTestId('sync-conflict-keep-local'));

    await waitFor(() => {
      expect(screen.queryByTestId('sync-conflict-bar')).toBeNull();
    });
    await waitFor(() => {
      expect(api.canvasSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: localDoc.id }),
        { touch: true },
      );
    });
    expect(queueCanvasCloudPush).toHaveBeenCalledWith(
      expect.objectContaining({ id: localDoc.id }),
      { forceResurrect: true },
    );

    // Same remote ts → dismissed; bar must not reappear.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('sync-conflict-bar')).toBeNull();

    // Newer remote → bar again; use-remote persists.
    const newer = {
      ...conflict,
      remoteUpdatedAt: '2026-07-31T13:00:00.000Z',
      remoteDoc: { ...remoteDoc, updatedAt: '2026-07-31T13:00:00.000Z', name: 'Remote2' },
    };
    syncCanvasDocuments.mockResolvedValue({
      pulled: 0,
      pushed: 0,
      deletedLocal: 0,
      skipped: false,
      pushErrors: 0,
      conflict: newer,
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('sync-conflict-bar')).toBeInTheDocument();
    });

    vi.mocked(api.canvasSave).mockClear();
    fireEvent.click(screen.getByTestId('sync-conflict-use-remote'));

    await waitFor(() => {
      expect(api.canvasSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Remote2' }),
        { touch: false },
      );
    });
    expect(screen.queryByTestId('sync-conflict-bar')).toBeNull();
  });

  it('keeps sidebar docs when refreshList fails transiently', async () => {
    await renderReady();
    expect(screen.getByLabelText('Archivo abierto')).toBeInTheDocument();

    vi.mocked(api.canvasList).mockRejectedValueOnce(new Error('IPC down'));
    fireEvent.click(screen.getByLabelText('Guardar'));

    await waitFor(() => {
      expect(api.canvasSave).toHaveBeenCalled();
    });
    const select = screen.getByLabelText('Archivo abierto') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(
      expect.arrayContaining([docA.id, docB.id]),
    );

    vi.mocked(api.canvasList).mockResolvedValue({
      documents: [
        { id: docA.id, name: docA.name, updatedAt: docA.updatedAt! },
        { id: docB.id, name: docB.name, updatedAt: docB.updatedAt! },
        { id: 'doc-c', name: 'Gamma', updatedAt: '2026-07-31T12:00:00.000Z' },
      ],
    });
    fireEvent.click(screen.getByLabelText('Guardar'));
    await waitFor(() => {
      const sel = screen.getByLabelText('Archivo abierto') as HTMLSelectElement;
      expect([...sel.options].some((o) => o.value === 'doc-c')).toBe(true);
    });
  });

  it('autosaves the open doc after a debounce when it becomes dirty', async () => {
    await renderReady();
    vi.mocked(api.canvasSave).mockClear();

    vi.useFakeTimers();
    try {
      // Add a page → discrete history edit marks the doc dirty.
      fireEvent.click(screen.getByLabelText('Añadir página'));

      await act(async () => {
        vi.advanceTimersByTime(1199);
      });
      expect(api.canvasSave).not.toHaveBeenCalled();

      // Cross the debounce window; then flush onSave's async chain.
      await act(async () => {
        vi.advanceTimersByTime(10);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps autosave enabled after StrictMode replays effects', async () => {
    render(
      <StrictMode>
        <CanvasView active />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId('mock-design-stage')).toBeInTheDocument());
    await waitFor(() => expect(api.canvasList).toHaveBeenCalled());
    vi.mocked(api.canvasSave).mockClear();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByLabelText('Añadir página'));
      await act(async () => {
        vi.advanceTimersByTime(1200);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries autosave after an edit occurs during an in-flight save', async () => {
    let resolveSave: (value: { document: CanvasDocument }) => void = () => {};
    await renderReady();
    vi.mocked(api.canvasSave).mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    vi.mocked(api.canvasSave).mockClear();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByLabelText('Añadir página'));
      await act(async () => {
        vi.advanceTimersByTime(1200);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByLabelText('Añadir página'));
      await act(async () => {
        resolveSave({ document: docA });
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(1199);
      });
      expect(api.canvasSave).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry autosave when a save fails without new edits', async () => {
    await renderReady();
    vi.mocked(api.canvasSave).mockRejectedValue(new Error('backend down'));
    vi.mocked(api.canvasSave).mockClear();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByLabelText('Añadir página'));
      await act(async () => {
        vi.advanceTimersByTime(1200);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalledTimes(1);

      // Sin ediciones nuevas, un save fallido no debe armar reintentos.
      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries autosave after memory pressure without requiring another edit', async () => {
    await renderReady();
    vi.mocked(api.canvasSave)
      .mockRejectedValueOnce({
        category: 'MEMORY_PRESSURE',
        details: { retry_after_ms: 2000 },
      })
      .mockImplementation(async (doc: CanvasDocument) => ({ document: doc }));
    vi.mocked(api.canvasSave).mockClear();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByLabelText('Añadir página'));
      await act(async () => {
        vi.advanceTimersByTime(1200);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(1999);
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-persist history right after a save that already persisted it', async () => {
    await renderReady();
    vi.mocked(api.canvasSaveHistory).mockClear();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByLabelText('Añadir página'));

      // Debounce del historial (500ms) → primera persistencia.
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(vi.mocked(api.canvasSaveHistory).mock.calls.length).toBeGreaterThanOrEqual(1);

      // Autosave (1200ms) → onSave persiste las stacks y marca el sig.
      await act(async () => {
        vi.advanceTimersByTime(700);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalled();
      const callsAfterSave = vi.mocked(api.canvasSaveHistory).mock.calls.length;

      // Sin ediciones nuevas, el render post-save no debe disparar otra
      // persistencia de historial (sig ya marcado por onSave).
      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(vi.mocked(api.canvasSaveHistory).mock.calls.length).toBe(callsAfterSave);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes autosave when active becomes false before the debounce fires', async () => {
    const { rerender } = render(<CanvasView active />);
    await waitFor(() => {
      expect(screen.queryByTestId('mock-design-stage')).toBeTruthy();
    });
    await waitFor(() => {
      expect(api.canvasList).toHaveBeenCalled();
    });

    vi.mocked(api.canvasSave).mockClear();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByLabelText('Añadir página'));

      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(api.canvasSave).not.toHaveBeenCalled();

      await act(async () => {
        rerender(<CanvasView active={false} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.canvasSave).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('registers beforeunload and blocks close while the doc is dirty', async () => {
    await renderReady();

    const addSpy = vi.spyOn(window, 'addEventListener');
    fireEvent.click(screen.getByLabelText('Añadir página'));

    // Re-render flushes the effect that registers the beforeunload listener.
    await act(async () => {
      await Promise.resolve();
    });

    const registered = addSpy.mock.calls.find((c) => c[0] === 'beforeunload');
    expect(registered).toBeTruthy();
    const handler = registered![1] as (e: BeforeUnloadEvent) => void;

    const ev = { returnValue: '', preventDefault: vi.fn() } as unknown as BeforeUnloadEvent;
    handler(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.returnValue).toBe('');

    addSpy.mockRestore();
  });

  it('imports a PDF only after the job completes and exposes cancellation', async () => {
    const importedLayer = {
      id: 'pdf-layer-1',
      type: 'rect' as const,
      name: 'PDF rect',
      value: '',
      pageIndex: 0,
      cssVars: {
        '--width': '10mm',
        '--height': '10mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    };
    const report = {
      importedCount: 1,
      skippedCount: 0,
      pagesProcessed: 1,
      issues: [],
      warnings: [],
    };
    pdfImportMocks.inspectPdfFile.mockResolvedValue({
      pageCount: 1,
      pageSizes: [{ widthPt: 612, heightPt: 792 }],
      hasMixedPageSizes: false,
    });
    pdfImportMocks.importPdfFile.mockResolvedValue({
      sourceName: 'import.pdf',
      fragment: {
        pages: [{ id: 'pdf-page-1', name: 'PDF Página 1' }],
        layers: [importedLayer],
        fields: [],
        firstPageIndex: 0,
        importedLayerIds: [importedLayer.id],
        report,
      },
      report,
    });

    await renderReady();
    const file = new File(['%PDF-1.7'], 'import.pdf', { type: 'application/pdf' });
    fireEvent.click(screen.getByRole('button', { name: 'Importar PDF' }));
    fireEvent.change(screen.getByLabelText('Archivo PDF'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(pdfImportMocks.importPdfFile).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ pageStart: 1, pageEnd: 1, mixedPagePolicy: 'reject' }),
    ));
    await waitFor(() => expect(screen.getByText(/1 importados · 0 aproximados/)).toBeInTheDocument());
    expect(screen.getByText('PDF rect')).toBeInTheDocument();

    let signal: AbortSignal | undefined;
    let resolveImport: ((value: unknown) => void) | undefined;
    pdfImportMocks.importPdfFile.mockImplementationOnce((_source: File, options: { signal?: AbortSignal }) => {
      signal = options.signal;
      return new Promise((resolve) => {
        resolveImport = resolve;
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Importar PDF' }));
    fireEvent.change(screen.getByLabelText('Archivo PDF'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(signal?.aborted).toBe(true);
    resolveImport?.({
      sourceName: 'import.pdf',
      fragment: { pages: [], layers: [], fields: [], firstPageIndex: 0, importedLayerIds: [], report },
      report,
    });
  });
});
