import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import type { SyncConflict } from '../sync/canvasCloudSync';
import { useCanvasSync } from '../hooks/useCanvasSync';
import { createEmptyDocument } from '../types';
import { api } from '../../../api';

const syncCanvasDocuments = vi.hoisted(() => vi.fn());

vi.mock('../sync/canvasCloudSync', () => ({
  syncCanvasDocuments,
}));

vi.mock('../utils/imageBlobStore', () => ({
  hydrateDocumentImages: vi.fn(async (doc: unknown) => doc),
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
    vi.mocked(api.canvasGet).mockReset();
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
});
