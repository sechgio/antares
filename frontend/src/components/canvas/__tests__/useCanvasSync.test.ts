import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import type { SyncConflict } from '../sync/canvasCloudSync';
import { useCanvasSync } from '../hooks/useCanvasSync';
import { createEmptyDocument } from '../types';

const syncCanvasDocuments = vi.fn();

vi.mock('../sync/canvasCloudSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync/canvasCloudSync')>();
  return {
    ...actual,
    syncCanvasDocuments: (...args: unknown[]) => syncCanvasDocuments(...args),
  };
});

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

    expect(onConflict).toHaveBeenCalledWith(conflict);
    await waitFor(() => {
      expect(result.current.syncing).toBe(false);
    });
    // Resolution is owned by the UI — sync must not apply remote itself.
    expect(replaceDocument).not.toHaveBeenCalled();
  });
});
