import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import type { SyncConflict } from '../sync/canvasCloudSync';
import { useCanvasSync } from '../hooks/useCanvasSync';
import { createEmptyDocument } from '../types';
import { api } from '../../../api';

const { syncCanvasDocuments, pullCanvasDocument } = vi.hoisted(() => ({
  syncCanvasDocuments: vi.fn(),
  pullCanvasDocument: vi.fn(),
}));

const realtimeMock = vi.hoisted(() => {
  const state: {
    savedHandler?: (event: unknown) => void;
    presenceHandler?: (collaborators: unknown[]) => void;
  } = {};
  const subscription = {
    publishSaved: vi.fn(async () => true),
    updatePresence: vi.fn(async () => true),
    close: vi.fn(async () => {}),
  };
  const subscribeCanvasDocument = vi.fn((_documentId: string, _presence: unknown, handlers: {
    onSaved: (event: unknown) => void;
    onPresence: (collaborators: unknown[]) => void;
    onStatus: (status: string) => void;
  }) => {
    state.savedHandler = handlers.onSaved;
    state.presenceHandler = handlers.onPresence;
    handlers.onStatus('live');
    return subscription;
  });
  return {
    state,
    subscription,
    getCanvasPresenceIdentity: vi.fn(async () => ({
      userId: 'user-1',
      displayName: 'Ana',
      mode: 'viewing' as const,
    })),
    subscribeCanvasDocument,
  };
});

vi.mock('../sync/canvasCloudSync', () => ({
  syncCanvasDocuments,
  pullCanvasDocument,
}));

vi.mock('../sync/canvasRealtime', () => ({
  getCanvasPresenceIdentity: realtimeMock.getCanvasPresenceIdentity,
  subscribeCanvasDocument: realtimeMock.subscribeCanvasDocument,
}));

vi.mock('../utils/imageBlobStore', () => ({
  hydrateDocumentImages: vi.fn(async (doc: unknown) => doc),
  serializeDocumentImages: vi.fn(async (doc: unknown) => doc),
  clearBlobStore: vi.fn(),
  releaseImageBlob: vi.fn(),
  getBlobUrl: vi.fn((v: string) => v),
  getThumbnailUrl: vi.fn((v: string) => v),
}));

vi.mock('../../../api', () => ({
  api: {
    canvasGet: vi.fn(),
    canvasSave: vi.fn(),
    canvasList: vi.fn(),
  },
}));

describe('useCanvasSync conflict handling', () => {
  beforeEach(() => {
    syncCanvasDocuments.mockReset();
    pullCanvasDocument.mockReset();
    vi.mocked(api.canvasGet).mockReset();
    realtimeMock.getCanvasPresenceIdentity.mockClear();
    realtimeMock.subscribeCanvasDocument.mockClear();
    realtimeMock.subscription.publishSaved.mockClear();
    realtimeMock.subscription.updatePresence.mockClear();
    realtimeMock.subscription.close.mockClear();
    realtimeMock.state.savedHandler = undefined;
    realtimeMock.state.presenceHandler = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finishes syncing without waiting for conflict resolution', async () => {
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';
    localDoc.updatedAt = '2026-07-31T10:00:00.000Z';
    const remoteDoc = { ...localDoc, name: 'Remote', updatedAt: '2026-07-31T11:00:00.000Z' };
    const conflict: SyncConflict = {
      localDoc,
      remoteDoc,
      localUpdatedAt: localDoc.updatedAt!,
      remoteUpdatedAt: remoteDoc.updatedAt!,
    };

    syncCanvasDocuments.mockResolvedValue({
      pulled: 0,
      pushed: 0,
      deletedLocal: 0,
      skipped: false,
      pushErrors: 0,
      conflict,
    });

    const onConflict = vi.fn();
    const refreshList = vi.fn().mockResolvedValue(undefined);
    const replaceDocument = vi.fn();

    const { result } = renderHook(() => {
      const historyDocRef = useRef(localDoc);
      const openDirtyRef = useRef(true);
      return useCanvasSync({
        historyDocRef,
        openDirtyRef,
        refreshList,
        replaceDocument,
        onConflict,
      });
    });

    await act(async () => {
      await result.current.runCloudSync();
    });

    await waitFor(() => {
      expect(onConflict).toHaveBeenCalledWith(conflict);
    });
    await waitFor(() => {
      expect(result.current.syncing).toBe(false);
    });
    // Resolution is owned by the UI — sync must not apply remote itself.
    expect(replaceDocument).not.toHaveBeenCalled();
    expect(syncCanvasDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        openDocumentId: 'doc-1',
        openDocument: localDoc,
        openDirty: true,
      }),
    );
  });

  it('surfaces conflict when reloadOpenId is set but doc dirtied mid-sync', async () => {
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';
    localDoc.updatedAt = '2026-07-31T10:00:00.000Z';
    const remoteDoc = { ...localDoc, name: 'Remote', updatedAt: '2026-07-31T11:00:00.000Z' };

    const openDirtyRef = { current: false };
    syncCanvasDocuments.mockImplementation(async () => {
      // Dirtied after disk pull, before applySyncResult.
      openDirtyRef.current = true;
      return {
        pulled: 1,
        pushed: 0,
        deletedLocal: 0,
        skipped: false,
        pushErrors: 0,
        reloadOpenId: 'doc-1',
      };
    });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: remoteDoc });

    const onConflict = vi.fn();
    const replaceDocument = vi.fn();

    const { result } = renderHook(() => {
      const historyDocRef = useRef(localDoc);
      return useCanvasSync({
        historyDocRef,
        openDirtyRef,
        refreshList: vi.fn().mockResolvedValue(undefined),
        replaceDocument,
        onConflict,
      });
    });

    await act(async () => {
      await result.current.runCloudSync();
    });

    await waitFor(() => {
      expect(onConflict).toHaveBeenCalledWith(
        expect.objectContaining({
          localDoc,
          remoteDoc: expect.objectContaining({ name: 'Remote' }),
          remoteUpdatedAt: remoteDoc.updatedAt,
        }),
      );
    });
    expect(replaceDocument).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.syncing).toBe(false);
    });
  });

  it('clears syncing when followUp result is skipped', async () => {
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';

    let followUp: ((r: unknown) => void) | undefined;
    syncCanvasDocuments.mockImplementation(async (opts: { followUp?: (r: unknown) => void }) => {
      followUp = opts.followUp;
      return {
        pulled: 0,
        pushed: 0,
        deletedLocal: 0,
        skipped: true,
        reason: 'sync-in-flight',
        pushErrors: 0,
      };
    });

    const { result } = renderHook(() => {
      const historyDocRef = useRef(localDoc);
      const openDirtyRef = useRef(false);
      return useCanvasSync({
        historyDocRef,
        openDirtyRef,
        refreshList: vi.fn().mockResolvedValue(undefined),
        replaceDocument: vi.fn(),
      });
    });

    await act(async () => {
      void result.current.runCloudSync();
    });

    await waitFor(() => {
      expect(result.current.syncing).toBe(true);
    });

    await act(async () => {
      followUp?.({
        pulled: 0,
        pushed: 0,
        deletedLocal: 0,
        skipped: true,
        reason: 'no-session',
        pushErrors: 0,
      });
    });

    await waitFor(() => {
      expect(result.current.syncing).toBe(false);
      expect(result.current.syncStatus).toBe('idle');
    });
  });

  it('keeps syncing status until coalesced followUp finishes', async () => {
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';

    let followUp: ((r: unknown) => void) | undefined;
    syncCanvasDocuments.mockImplementation(async (opts: { followUp?: (r: unknown) => void }) => {
      followUp = opts.followUp;
      return {
        pulled: 0,
        pushed: 0,
        deletedLocal: 0,
        skipped: true,
        reason: 'sync-in-flight',
        pushErrors: 0,
      };
    });

    const refreshList = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const historyDocRef = useRef(localDoc);
      const openDirtyRef = useRef(false);
      return useCanvasSync({
        historyDocRef,
        openDirtyRef,
        refreshList,
        replaceDocument: vi.fn(),
      });
    });

    await act(async () => {
      void result.current.runCloudSync();
    });

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('syncing');
      expect(result.current.syncing).toBe(true);
    });

    await act(async () => {
      followUp?.({
        pulled: 0,
        pushed: 0,
        deletedLocal: 0,
        skipped: false,
        pushErrors: 0,
      });
    });

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('synced');
      expect(result.current.syncing).toBe(false);
    });
  });

  it('registers focus listener only when active', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';

    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => {
        const historyDocRef = useRef(localDoc);
        const openDirtyRef = useRef(false);
        return useCanvasSync({
          historyDocRef,
          openDirtyRef,
          refreshList: vi.fn(),
          replaceDocument: vi.fn(),
          active,
        });
      },
      { initialProps: { active: true } },
    );

    expect(addSpy).toHaveBeenCalledWith('focus', expect.any(Function));
    const focusHandler = addSpy.mock.calls.find((c) => c[0] === 'focus')?.[1];

    addSpy.mockClear();
    rerender({ active: false });
    expect(removeSpy).toHaveBeenCalledWith('focus', focusHandler);
    expect(addSpy.mock.calls.some((c) => c[0] === 'focus')).toBe(false);

    unmount();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('does not open a Realtime channel before the document is ready', async () => {
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';

    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) => {
        const historyDocRef = useRef(localDoc);
        const openDirtyRef = useRef(false);
        return useCanvasSync({
          historyDocRef,
          openDirtyRef,
          refreshList: vi.fn().mockResolvedValue(undefined),
          replaceDocument: vi.fn(),
          documentId: 'doc-1',
          documentReady: ready,
        });
      },
      { initialProps: { ready: false } },
    );

    await Promise.resolve();
    expect(realtimeMock.subscribeCanvasDocument).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(realtimeMock.subscribeCanvasDocument).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ userId: 'user-1', mode: 'viewing' }),
      expect.any(Object),
    ));
  });

  it('coalesces saved events and applies one clean remote snapshot', async () => {
    vi.useFakeTimers();
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';
    const remoteDoc = { ...localDoc, name: 'Remote', updatedAt: '2026-08-31T12:00:00.000Z' };
    const replaceDocument = vi.fn();
    const onRemoteDocumentApplied = vi.fn();
    pullCanvasDocument.mockResolvedValue({
      kind: 'applied',
      document: remoteDoc,
      remoteUpdatedAt: remoteDoc.updatedAt,
    });

    renderHook(() => {
      const historyDocRef = useRef(localDoc);
      const openDirtyRef = useRef(false);
      return useCanvasSync({
        historyDocRef,
        openDirtyRef,
        refreshList: vi.fn().mockResolvedValue(undefined),
        replaceDocument,
        documentId: 'doc-1',
        documentReady: true,
        onRemoteDocumentApplied,
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(realtimeMock.state.savedHandler).toBeDefined();
    act(() => {
      realtimeMock.state.savedHandler?.({
        type: 'document_saved',
        documentId: 'doc-1',
        updatedAt: '2026-08-31T11:00:00.000Z',
        updatedBy: 'user-2',
      });
      realtimeMock.state.savedHandler?.({
        type: 'document_saved',
        documentId: 'doc-1',
        updatedAt: '2026-08-31T12:00:00.000Z',
        updatedBy: 'user-3',
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(pullCanvasDocument).toHaveBeenCalledTimes(1);
    expect(pullCanvasDocument).toHaveBeenCalledWith('doc-1', {
      localDocument: localDoc,
      openDirty: false,
    });
    expect(replaceDocument).toHaveBeenCalledWith(remoteDoc);
    expect(onRemoteDocumentApplied).toHaveBeenCalledWith(remoteDoc);
  });

  it('keeps a dirty editor in conflict when a remote snapshot arrives', async () => {
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';
    const remoteDoc = { ...localDoc, name: 'Remote', updatedAt: '2026-08-31T12:00:00.000Z' };
    const onConflict = vi.fn();
    pullCanvasDocument.mockResolvedValue({
      kind: 'conflict',
      conflict: {
        localDoc,
        remoteDoc,
        localUpdatedAt: localDoc.updatedAt || '',
        remoteUpdatedAt: remoteDoc.updatedAt || '',
      },
    });

    renderHook(() => {
      const historyDocRef = useRef(localDoc);
      const openDirtyRef = useRef(true);
      return useCanvasSync({
        historyDocRef,
        openDirtyRef,
        refreshList: vi.fn().mockResolvedValue(undefined),
        replaceDocument: vi.fn(),
        onConflict,
        documentId: 'doc-1',
        documentReady: true,
        openDirty: true,
      });
    });

    await waitFor(() => expect(realtimeMock.state.savedHandler).toBeDefined());
    realtimeMock.state.savedHandler?.({
      type: 'document_saved',
      documentId: 'doc-1',
      updatedAt: '2026-08-31T12:00:00.000Z',
      updatedBy: 'user-2',
    });
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ remoteDoc })));
  });

  it('ignores Realtime invalidations during the guarded bootstrap', async () => {
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';
    pullCanvasDocument.mockResolvedValue({ kind: 'unchanged' });

    renderHook(() => {
      const historyDocRef = useRef(localDoc);
      const openDirtyRef = useRef(false);
      return useCanvasSync({
        historyDocRef,
        openDirtyRef,
        refreshList: vi.fn().mockResolvedValue(undefined),
        replaceDocument: vi.fn(),
        documentId: 'doc-1',
        documentReady: true,
        initialGuarded: true,
      });
    });

    await waitFor(() => expect(realtimeMock.state.savedHandler).toBeDefined());
    realtimeMock.state.savedHandler?.({
      type: 'document_saved',
      documentId: 'doc-1',
      updatedAt: '2026-08-31T12:00:00.000Z',
      updatedBy: 'user-2',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(pullCanvasDocument).not.toHaveBeenCalled();
  });

  it('updates Presence from editing to viewing without recreating the channel', async () => {
    const localDoc = createEmptyDocument('Local');
    localDoc.id = 'doc-1';
    const { rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => {
        const historyDocRef = useRef(localDoc);
        const openDirtyRef = useRef(dirty);
        openDirtyRef.current = dirty;
        return useCanvasSync({
          historyDocRef,
          openDirtyRef,
          refreshList: vi.fn().mockResolvedValue(undefined),
          replaceDocument: vi.fn(),
          documentId: 'doc-1',
          documentReady: true,
          openDirty: dirty,
        });
      },
      { initialProps: { dirty: true } },
    );

    await waitFor(() => expect(realtimeMock.subscribeCanvasDocument).toHaveBeenCalled());
    rerender({ dirty: false });
    await waitFor(() => expect(realtimeMock.subscription.updatePresence).toHaveBeenCalledWith({
      userId: 'user-1',
      displayName: 'Ana',
      mode: 'viewing',
    }));
    expect(realtimeMock.subscribeCanvasDocument).toHaveBeenCalledTimes(1);
  });
});
