import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CanvasDocument } from '../types';
import {
  isNewer,
  pullCanvasDocument,
  pushCanvasDocument,
  queueCanvasCloudDelete,
  queueCanvasCloudPush,
  shouldPushCanvasRow,
  syncCanvasDocuments,
  withTimeout,
} from './canvasCloudSync';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

/**
 * Supabase mock: `from()` returns a chainable object whose every method
 * (`.select`, `.eq`, `.in`, `.is`, `.maybeSingle`, `.update`, `.insert`,
 * `.upsert`) returns `this` for chaining.  The object is also *thenable*:
 * when `await`-ed it resolves to the next response from the FIFO queue.
 *
 * This satisfies all chains used in canvasCloudSync.ts:
 *   listRemoteCanvasMeta:    from().select(...)              -> terminal
 *   fetchRemoteDocuments:    from().select().in().is()       -> terminal
 *   pushCanvasDocument:      from().upsert()                 -> terminal
 *   markRemoteCanvasDeleted: from().update().eq()            -> terminal
 */
const supabaseMock = vi.hoisted(() => {
  const responses: Array<
    { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>
  > = [];

  const chainable: Record<string, unknown> = {};

  for (const m of ['select', 'eq', 'in', 'is', 'maybeSingle', 'update', 'insert', 'upsert']) {
    chainable[m] = vi.fn(() => chainable);
  }

  // Thenable: when awaited, resolves to the next queued response.
  chainable.then = (
    onFulfilled: ((v: unknown) => unknown) | undefined,
    onRejected?: ((e: unknown) => unknown) | undefined,
  ) => {
    const next = responses.shift() ?? { data: null, error: null };
    return Promise.resolve(next).then(onFulfilled, onRejected);
  };

  const from = vi.fn(() => chainable);
  const getSession = vi.fn();
  const rpc = vi.fn();

  return { responses, chainable, from, getSession, rpc };
});

const realtimeMock = vi.hoisted(() => ({
  broadcastCanvasDocumentSaved: vi.fn(async () => true),
}));

vi.mock('../../../api', () => ({
  api: {
    canvasList: vi.fn(),
    canvasGet: vi.fn(),
    canvasSave: vi.fn(),
    canvasDelete: vi.fn(),
  },
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: supabaseMock.getSession },
    from: supabaseMock.from,
    rpc: supabaseMock.rpc,
  },
}));

vi.mock('./canvasRealtime', () => realtimeMock);

import { api } from '../../../api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    version: 2,
    id: 'doc-1',
    name: 'Test',
    updatedAt: '2026-07-22T12:00:00Z',
    page: { widthMm: 210, heightMm: 297 },
    layers: [],
    fields: [],
    ...overrides,
  };
}

/** Enqueue a supabase chain response (consumed in FIFO order by `await`). */
function enqueue(data: unknown, error: unknown = null): void {
  supabaseMock.responses.push({ data, error });
}

/** Enqueue a response that stays pending until the returned release() is called. */
function enqueueDeferred(): (data?: unknown, error?: unknown) => void {
  let release!: (v: { data: unknown; error: unknown }) => void;
  const pending = new Promise<{ data: unknown; error: unknown }>((resolve) => {
    release = resolve;
  });
  supabaseMock.responses.push(pending);
  return (data: unknown = null, error: unknown = null) => {
    release({ data, error });
  };
}

function resetMocks(): void {
  vi.mocked(api.canvasList).mockReset();
  vi.mocked(api.canvasGet).mockReset();
  vi.mocked(api.canvasSave).mockReset();
  vi.mocked(api.canvasDelete).mockReset();
  realtimeMock.broadcastCanvasDocumentSaved.mockReset();
  realtimeMock.broadcastCanvasDocumentSaved.mockResolvedValue(true);

  supabaseMock.responses.length = 0;
  supabaseMock.from.mockClear();
  supabaseMock.rpc.mockReset();
  supabaseMock.rpc.mockRejectedValue(new Error('RPC function not found'));
  supabaseMock.getSession.mockReset();
  supabaseMock.getSession.mockResolvedValue({
    data: { session: { user: { id: 'user-1' } } },
  });

  for (const m of ['select', 'eq', 'in', 'is', 'maybeSingle', 'update', 'insert', 'upsert']) {
    (supabaseMock.chainable[m] as ReturnType<typeof vi.fn>).mockClear();
  }
}

// ---------------------------------------------------------------------------
// withTimeout / isNewer / shouldPushCanvasRow (canonical unit cases)
// ---------------------------------------------------------------------------

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the promise wins', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'test')).resolves.toBe(42);
  });

  it('rejects when the timer wins', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<number>(() => {}), 50, 'test-hang');
    const assertion = expect(pending).rejects.toThrow(/test-hang timed out after 50ms/);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});

describe('canvasCloudSync isNewer', () => {
  it('treats missing local as older', () => {
    expect(isNewer('2026-07-22T12:00:00.000Z', undefined)).toBe(true);
  });

  it('returns false when remote/local a is undefined', () => {
    expect(isNewer(undefined, '2026-07-22T12:00:00.000Z')).toBe(false);
  });

  it('compares ISO timestamps', () => {
    expect(isNewer('2026-07-22T13:00:00.000Z', '2026-07-22T12:00:00.000Z')).toBe(true);
    expect(isNewer('2026-07-22T12:00:00.000Z', '2026-07-22T13:00:00.000Z')).toBe(false);
    expect(isNewer('2026-07-22T12:00:00.000Z', '2026-07-22T12:00:00.000Z')).toBe(false);
  });

  it('rejects invalid remote timestamps', () => {
    expect(isNewer('not-a-date', '2026-07-22T12:00:00.000Z')).toBe(false);
  });
});

describe('shouldPushCanvasRow', () => {
  it('pushes when remote row is missing', () => {
    expect(shouldPushCanvasRow('2026-07-22T13:00:00Z', null, null)).toBe(true);
  });

  it('skips when remote is newer', () => {
    expect(
      shouldPushCanvasRow('2026-07-22T12:00:00Z', '2026-07-22T13:00:00Z', null),
    ).toBe(false);
  });

  it('skips when remote is soft-deleted', () => {
    expect(
      shouldPushCanvasRow('2026-07-22T13:00:00Z', '2026-07-22T12:00:00Z', '2026-07-22T12:30:00Z'),
    ).toBe(false);
  });

  it('pushes when local is newer and remote is not deleted', () => {
    expect(
      shouldPushCanvasRow('2026-07-22T13:00:00Z', '2026-07-22T12:00:00Z', null),
    ).toBe(true);
  });

  it('blocks push when local timestamp is undefined', () => {
    expect(shouldPushCanvasRow(undefined, '2026-07-22T12:00:00Z', null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncCanvasDocuments characterization tests
// ---------------------------------------------------------------------------

describe('syncCanvasDocuments', () => {
  beforeEach(resetMocks);

  // --- Step 2: remote-newer triggers pull and reloadOpenId ---

  it('pulls remote doc when remote is newer and sets reloadOpenId', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'New',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };
    const pulledDoc = makeDoc({ id: 'doc-1', name: 'New', updatedAt: '2026-07-22T12:00:00Z' });

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasSave).mockResolvedValue({ document: pulledDoc });

    // Response 1: listRemoteCanvasMeta
    enqueue([remoteMeta]);
    // Response 2: fetchRemoteDocuments
    enqueue([{ document: pulledDoc, updated_at: '2026-07-22T12:00:00Z' }]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: false,
    });

    expect(result.pulled).toBe(1);
    expect(result.reloadOpenId).toBe('doc-1');
    expect(vi.mocked(api.canvasSave)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc-1',
        name: 'New',
        updatedAt: '2026-07-22T12:00:00Z',
      }),
      { touch: false },
    );
  });

  // --- Step 3a: openDirty prevents pull ---

  it('does not pull when openDirty is true (open doc is dirty)', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'New',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };
    const remoteDoc = makeDoc({ id: 'doc-1', name: 'New', updatedAt: '2026-07-22T12:00:00Z' });
    const localFull = makeDoc({ id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' });

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: localFull });

    // listRemote + fetchRemoteDocuments for conflict payload
    enqueue([remoteMeta]);
    enqueue([{ document: remoteDoc, updated_at: '2026-07-22T12:00:00Z' }]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: true,
    });

    expect(result.pulled).toBe(0);
    expect(result.reloadOpenId).toBeUndefined();
    expect(result.conflict).toBeDefined();
    expect(result.conflict!.remoteDoc.name).toBe('New');
    expect(result.conflict!.localDoc.name).toBe('Old');
    expect(vi.mocked(api.canvasSave)).not.toHaveBeenCalled();
  });

  it('prefers SyncOptions.openDocument for conflict.localDoc over disk', async () => {
    const localDoc = { id: 'doc-1', name: 'Disk', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'New',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };
    const remoteDoc = makeDoc({ id: 'doc-1', name: 'New', updatedAt: '2026-07-22T12:00:00Z' });
    const diskFull = makeDoc({ id: 'doc-1', name: 'Disk', updatedAt: '2026-07-01T00:00:00Z' });
    const memoryDoc = makeDoc({
      id: 'doc-1',
      name: 'Unsaved memory',
      updatedAt: '2026-07-01T00:00:00Z',
    });

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: diskFull });

    enqueue([remoteMeta]);
    enqueue([{ document: remoteDoc, updated_at: '2026-07-22T12:00:00Z' }]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDocument: memoryDoc,
      openDirty: true,
    });

    expect(result.conflict).toBeDefined();
    expect(result.conflict!.localDoc.name).toBe('Unsaved memory');
    expect(vi.mocked(api.canvasGet)).not.toHaveBeenCalled();
  });

  // --- Step 3b: open dirty + remote deleted → conflict (not silent skip) ---

  it('reports remoteDeleted conflict when open doc is dirty and remote is deleted', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const localFull = makeDoc({ id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' });
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: localFull });

    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: true,
    });

    expect(result.deletedLocal).toBe(0);
    expect(result.reloadOpenId).toBeUndefined();
    expect(vi.mocked(api.canvasDelete)).not.toHaveBeenCalled();
    expect(result.conflict).toMatchObject({
      remoteDeleted: true,
      remoteDoc: null,
      remoteUpdatedAt: '2026-07-22T12:00:00Z',
    });
    expect(result.conflict!.localDoc.name).toBe('Old');
  });

  it('surfaces conflict for open doc soft-delete even when openDirty is false', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const localFull = makeDoc({ id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' });
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: localFull });

    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: false,
    });

    expect(result.deletedLocal).toBe(0);
    expect(result.reloadOpenId).toBeUndefined();
    expect(vi.mocked(api.canvasDelete)).not.toHaveBeenCalled();
    expect(result.conflict).toMatchObject({
      remoteDeleted: true,
      remoteDoc: null,
      remoteUpdatedAt: '2026-07-22T12:00:00Z',
    });
    expect(result.conflict!.localDoc.name).toBe('Old');
  });

  // --- Step 4: remote-deleted removes local doc ---

  it('deletes local doc when remote is deleted and it is not the open doc', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasDelete).mockResolvedValue({ success: true, deleted_id: 'doc-1' });

    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({});

    expect(result.deletedLocal).toBe(1);
    expect(vi.mocked(api.canvasDelete)).toHaveBeenCalledWith('doc-1');
  });

  // --- Step 5: local-newer triggers push ---

  it('pushes local doc when local is newer than remote', async () => {
    const localDoc = { id: 'doc-1', name: 'New', updatedAt: '2026-07-22T13:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({
      document: makeDoc({ id: 'doc-1', name: 'New', updatedAt: '2026-07-22T13:00:00Z' }),
    });

    // Response 1: listRemoteCanvasMeta
    enqueue([remoteMeta]);
    // Response 2: pushCanvasDocument LWW select
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null });
    // Response 3: pushCanvasDocument upsert
    enqueue(null);

    const result = await syncCanvasDocuments({});

    expect(result.pushed).toBe(1);
    expect(vi.mocked(api.canvasGet)).toHaveBeenCalledWith('doc-1');
    expect(supabaseMock.from).toHaveBeenCalledWith('canvas_documents');
    expect(realtimeMock.broadcastCanvasDocumentSaved).toHaveBeenCalledWith({
      type: 'document_saved',
      documentId: 'doc-1',
      updatedAt: '2026-07-22T13:00:00Z',
      updatedBy: 'user-1',
    });
  });

  // --- Step 6: equal timestamps do not push ---

  it('does not push when local and remote have equal timestamps', async () => {
    const localDoc = { id: 'doc-1', name: 'Same', updatedAt: '2026-07-22T12:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'Same',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });

    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({});

    expect(result.pushed).toBe(0);
    expect(vi.mocked(api.canvasGet)).not.toHaveBeenCalled();
  });

  it('pushes legacy local doc without updatedAt when remote row exists', async () => {
    const localDoc = { id: 'doc-legacy', name: 'Legacy', updatedAt: '' };
    const remoteMeta = {
      id: 'doc-legacy',
      name: 'Remote',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({
      document: makeDoc({ id: 'doc-legacy', name: 'Legacy', updatedAt: '' }),
    });

    enqueue([remoteMeta]);
    enqueue([
      {
        document: makeDoc({ id: 'doc-legacy', name: 'Legacy', updatedAt: '' }),
        updated_at: '2026-07-22T12:00:00Z',
      },
    ]);
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null });
    enqueue(null);

    const result = await syncCanvasDocuments({});

    expect(result.pushed).toBe(1);
    expect(vi.mocked(api.canvasGet)).toHaveBeenCalledWith('doc-legacy');
  });

  it('does not push when local updatedAt is older than remote', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'New',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({});

    expect(result.pushed).toBe(0);
    expect(vi.mocked(api.canvasGet)).not.toHaveBeenCalled();
  });

  // --- Regression: do not resurrect remotely-deleted docs on push ---
  // Uses openDirty:true so the pull phase reports a conflict instead of deleting
  // the local doc — the doc stays in localById and the push loop skips it via
  // `if (r?.deleted_at) continue;` unless forceResurrect is used explicitly.

  it('does not push when remote is deleted and open doc is dirty (conflict instead)', async () => {
    const localDoc = { id: 'doc-1', name: 'Edited', updatedAt: '2026-07-22T13:00:00Z' };
    const localFull = makeDoc({ id: 'doc-1', name: 'Edited', updatedAt: '2026-07-22T13:00:00Z' });
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: localFull });

    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: true,
    });

    expect(result.pushed).toBe(0);
    expect(result.deletedLocal).toBe(0);
    expect(vi.mocked(api.canvasGet)).toHaveBeenCalledWith('doc-1');
    expect(result.conflict?.remoteDeleted).toBe(true);
  });

  // --- Push error surfacing (plan 004) ---

  it('surfaces push errors in SyncResult when pushCanvasDocument throws', async () => {
    const localDoc = { id: 'doc-1', name: 'New', updatedAt: '2026-07-22T13:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({
      document: makeDoc({ id: 'doc-1', name: 'New', updatedAt: '2026-07-22T13:00:00Z' }),
    });

    // Response 1: listRemoteCanvasMeta
    enqueue([remoteMeta]);
    // Response 2: pushCanvasDocument LWW select
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null });
    // Response 3: pushCanvasDocument upsert — RLS denial
    enqueue(null, { message: 'RLS denied' });

    const result = await syncCanvasDocuments({});

    expect(result.pushErrors).toBe(1);
    expect(result.lastError).toContain('RLS denied');
    expect(result.pushed).toBe(0);
  });

  it('coalesces a retry after sync-in-flight skip', async () => {
    let releaseSession!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      releaseSession = resolve;
    });
    supabaseMock.getSession
      .mockImplementationOnce(() => gate)
      .mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [] });
    enqueue([]); // first sync listRemote
    enqueue([]); // retry listRemote

    const first = syncCanvasDocuments({ openDocumentId: 'doc-a', openDirty: false });
    // Let the first call take the mutex (await sessionUserId).
    await Promise.resolve();
    await Promise.resolve();

    const skipped = await syncCanvasDocuments({ openDocumentId: 'doc-b', openDirty: true });
    expect(skipped).toMatchObject({ skipped: true, reason: 'sync-in-flight' });

    releaseSession({ data: { session: { user: { id: 'user-1' } } } });
    await first;

    await vi.waitFor(() => {
      expect(supabaseMock.getSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('invokes followUp with the coalesced retry result (not skipped)', async () => {
    let releaseSession!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      releaseSession = resolve;
    });
    supabaseMock.getSession
      .mockImplementationOnce(() => gate)
      .mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [] });
    enqueue([]);
    enqueue([]);

    const followUp = vi.fn();
    const first = syncCanvasDocuments({ openDocumentId: 'doc-a', openDirty: false });
    await Promise.resolve();
    await Promise.resolve();

    const skipped = await syncCanvasDocuments({
      openDocumentId: 'doc-b',
      openDirty: false,
      followUp,
    });
    expect(skipped.skipped).toBe(true);

    releaseSession({ data: { session: { user: { id: 'user-1' } } } });
    await first;

    await vi.waitFor(() => {
      expect(followUp).toHaveBeenCalled();
    });
    const followArg = followUp.mock.calls[0][0];
    expect(followArg.skipped).toBe(false);
    expect(supabaseMock.getSession.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('followUp receives conflict from the coalesced retry', async () => {
    let releaseSession!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      releaseSession = resolve;
    });
    supabaseMock.getSession
      .mockImplementationOnce(() => gate)
      .mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });

    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'New',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };
    const remoteDoc = makeDoc({ id: 'doc-1', name: 'New', updatedAt: '2026-07-22T12:00:00Z' });
    const localFull = makeDoc({ id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' });

    // First sync: empty local so it does not push (would steal supabase responses).
    vi.mocked(api.canvasList)
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: localFull });

    enqueue([]); // first listRemote
    enqueue([remoteMeta]); // retry listRemote
    enqueue([{ document: remoteDoc, updated_at: '2026-07-22T12:00:00Z' }]); // conflict fetch

    const followUp = vi.fn();
    const first = syncCanvasDocuments({ openDocumentId: 'other', openDirty: false });
    await Promise.resolve();
    await Promise.resolve();

    await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: true,
      followUp,
    });

    releaseSession({ data: { session: { user: { id: 'user-1' } } } });
    await first;

    await vi.waitFor(() => {
      expect(followUp).toHaveBeenCalled();
    });
    expect(followUp.mock.calls[0][0].conflict).toBeDefined();
  });

  it('without overlap returns a non-skipped result (caller applies side-effects)', async () => {
    vi.mocked(api.canvasList).mockResolvedValue({ documents: [] });
    enqueue([]);
    const followUp = vi.fn();
    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-a',
      openDirty: false,
      followUp,
    });
    expect(result.skipped).toBe(false);
    // followUp is only for coalesced retries; primary caller applies when !skipped.
    expect(followUp).not.toHaveBeenCalled();
  });

  // --- Guarded (first-boot) sync: never clobber an existing local doc ---

  it('guarded: does NOT delete a local doc when remote is soft-deleted', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({ guarded: true, openDocumentId: 'doc-1', openDirty: false });

    expect(result.deletedLocal).toBe(0);
    expect(vi.mocked(api.canvasDelete)).not.toHaveBeenCalled();
  });

  it('guarded: surfaces remote-deleted conflict for the open doc instead of deleting', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const localFull = makeDoc({ id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' });
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: localFull });
    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({ guarded: true, openDocumentId: 'doc-1', openDirty: false });

    expect(result.deletedLocal).toBe(0);
    expect(vi.mocked(api.canvasDelete)).not.toHaveBeenCalled();
    expect(result.conflict).toMatchObject({ remoteDeleted: true });
  });

  it('guarded: does NOT overwrite an existing local doc with a newer remote', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'New',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({ guarded: true, openDocumentId: 'doc-other', openDirty: false });

    expect(result.pulled).toBe(0);
    expect(vi.mocked(api.canvasSave)).not.toHaveBeenCalled();
  });

  it('guarded: DOES pull a remote doc that has no local counterpart', async () => {
    // Local list has only doc-a; remote has doc-remote (not present locally).
    const localDoc = { id: 'doc-a', name: 'A', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-remote',
      name: 'RemoteOnly',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    };
    const pulledDoc = makeDoc({ id: 'doc-remote', name: 'RemoteOnly', updatedAt: '2026-07-22T12:00:00Z' });

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasSave).mockResolvedValue({ document: pulledDoc });
    enqueue([remoteMeta]);
    enqueue([{ document: pulledDoc, updated_at: '2026-07-22T12:00:00Z' }]);

    const result = await syncCanvasDocuments({ guarded: true, openDocumentId: 'doc-a', openDirty: false });

    expect(result.pulled).toBe(1);
    expect(vi.mocked(api.canvasSave)).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-remote' }),
      { touch: false },
    );
  });
});

// ---------------------------------------------------------------------------
// opChain serialization (plan 018)
// ---------------------------------------------------------------------------

describe('opChain push serialization', () => {
  beforeEach(resetMocks);

  it('runs queued push only after coalesced sync retry finishes', async () => {
    const events: string[] = [];
    let releaseSession!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      releaseSession = resolve;
    });
    supabaseMock.getSession
      .mockImplementationOnce(() => gate)
      .mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });

    vi.mocked(api.canvasList).mockImplementation(async () => {
      events.push('list');
      return { documents: [] };
    });
    enqueue([]); // sync A remote list
    enqueue([]); // retry remote list

    const upsert = supabaseMock.chainable.upsert as ReturnType<typeof vi.fn>;
    upsert.mockImplementation(() => {
      events.push('push-upsert');
      return supabaseMock.chainable;
    });

    const first = syncCanvasDocuments({ openDocumentId: 'doc-a', openDirty: false });
    await Promise.resolve();
    await Promise.resolve();

    enqueue(null); // push LWW select
    enqueue(null); // push upsert
    queueCanvasCloudPush(makeDoc({ id: 'doc-push' }));

    const skipped = await syncCanvasDocuments({ openDocumentId: 'doc-b', openDirty: true });
    expect(skipped.skipped).toBe(true);

    releaseSession({ data: { session: { user: { id: 'user-1' } } } });
    await first;

    await vi.waitFor(() => {
      expect(events.filter((e) => e === 'list')).toHaveLength(2);
      expect(events).toContain('push-upsert');
    });
    const firstList = events.indexOf('list');
    const secondList = events.indexOf('list', firstList + 1);
    const pushAt = events.indexOf('push-upsert');
    expect(secondList).toBeGreaterThan(firstList);
    expect(pushAt).toBeGreaterThan(secondList);
  });

  it('serializes two queued pushes (second waits for first)', async () => {
    const events: string[] = [];
    const releaseSelect1 = enqueueDeferred();
    enqueue(null); // upsert 1
    enqueue(null); // select 2
    enqueue(null); // upsert 2

    const upsert = supabaseMock.chainable.upsert as ReturnType<typeof vi.fn>;
    upsert.mockImplementation(() => {
      events.push(`upsert:${(upsert.mock.calls.at(-1)?.[0] as { id: string }).id}`);
      return supabaseMock.chainable;
    });

    queueCanvasCloudPush(makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T12:00:00Z' }));
    queueCanvasCloudPush(makeDoc({ id: 'doc-2', updatedAt: '2026-07-22T12:00:00Z' }));

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([]);

    releaseSelect1(null);
    await vi.waitFor(() => {
      expect(events).toEqual(['upsert:doc-1', 'upsert:doc-2']);
    });
  });

  it('coalesces five pushes of the same id into one upsert (last-write-wins)', async () => {
    enqueue(null); // LWW select
    enqueue(null); // upsert

    const upsert = supabaseMock.chainable.upsert as ReturnType<typeof vi.fn>;
    const names: string[] = [];
    upsert.mockImplementation((row: { id: string; name: string }) => {
      names.push(row.name);
      return supabaseMock.chainable;
    });

    for (let i = 0; i < 5; i++) {
      queueCanvasCloudPush(makeDoc({ id: 'doc-same', name: `v${i}`, updatedAt: '2026-07-22T12:00:00Z' }));
    }

    await vi.waitFor(() => {
      expect(names).toEqual(['v4']);
    });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('runs push immediately when opChain is idle', async () => {
    enqueue(null);
    enqueue(null);
    const ok = await new Promise<boolean>((resolve) => {
      const upsert = supabaseMock.chainable.upsert as ReturnType<typeof vi.fn>;
      upsert.mockImplementationOnce(() => {
        resolve(true);
        return supabaseMock.chainable;
      });
      queueCanvasCloudPush(makeDoc({ id: 'doc-idle' }));
    });
    expect(ok).toBe(true);
  });

  it('serializes delete behind a pending push', async () => {
    const events: string[] = [];
    const releaseSelect = enqueueDeferred();
    enqueue(null); // push upsert
    enqueue(null); // delete update

    const upsert = supabaseMock.chainable.upsert as ReturnType<typeof vi.fn>;
    upsert.mockImplementation(() => {
      events.push('upsert');
      return supabaseMock.chainable;
    });
    const update = supabaseMock.chainable.update as ReturnType<typeof vi.fn>;
    update.mockImplementation(() => {
      events.push('delete');
      return supabaseMock.chainable;
    });

    queueCanvasCloudPush(makeDoc({ id: 'doc-1' }));
    queueCanvasCloudDelete('doc-1');
    await Promise.resolve();
    expect(events).toEqual([]);

    releaseSelect(null);
    await vi.waitFor(() => {
      expect(events).toEqual(['upsert', 'delete']);
    });
  });

  it('publishes only an accepted queued push', async () => {
    enqueue(null); // LWW select
    enqueue(null); // upsert

    await queueCanvasCloudPush(makeDoc({
      id: 'doc-queued',
      updatedAt: '2026-07-22T12:00:00Z',
    }));

    expect(realtimeMock.broadcastCanvasDocumentSaved).toHaveBeenCalledWith({
      type: 'document_saved',
      documentId: 'doc-queued',
      updatedAt: '2026-07-22T12:00:00Z',
      updatedBy: 'user-1',
    });
  });

  it('does not publish a queued push rejected by LWW', async () => {
    enqueue({ updated_at: '2026-07-22T13:00:00Z', deleted_at: null });
    enqueue(null); // preserved version

    await queueCanvasCloudPush(makeDoc({
      id: 'doc-rejected',
      updatedAt: '2026-07-22T12:00:00Z',
    }));

    expect(realtimeMock.broadcastCanvasDocumentSaved).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// pushCanvasDocument upsert verification (plan 005)
// ---------------------------------------------------------------------------

describe('pushCanvasDocument', () => {
  beforeEach(resetMocks);

  it('calls upsert with onConflict id', async () => {
    const doc = makeDoc({
      id: 'doc-1',
      name: 'Test',
      updatedAt: '2026-07-22T12:00:00Z',
    });

    // Response 1: LWW select (no remote row)
    enqueue(null);
    // Response 2: upsert
    enqueue(null);

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(true);
    expect(supabaseMock.from).toHaveBeenCalledWith('canvas_documents');
    const upsert = supabaseMock.chainable.upsert as ReturnType<typeof vi.fn>;
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, options] = upsert.mock.calls[0];
    expect(row).toMatchObject({
      id: 'doc-1',
      name: 'Test',
      document: doc,
      updated_at: '2026-07-22T12:00:00Z',
      updated_by: 'user-1',
      created_by: 'user-1',
      deleted_at: null,
    });
    expect(options).toEqual({ onConflict: 'id' });
  });

  it('skips upsert when remote is newer', async () => {
    const doc = makeDoc({
      id: 'doc-1',
      updatedAt: '2026-07-22T12:00:00Z',
    });
    enqueue({ updated_at: '2026-07-22T13:00:00Z', deleted_at: null });
    const ok = await pushCanvasDocument(doc);
    expect(ok).toBe(false);
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('preserves existing created_by on update instead of overwriting with the current user', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T13:00:00Z' });
    // Response 1: LWW select — existing row created by another user.
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null, created_by: 'user-original' });
    // Response 2: upsert
    enqueue(null);

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(true);
    const upsert = supabaseMock.chainable.upsert as ReturnType<typeof vi.fn>;
    const [row] = upsert.mock.calls[0];
    // created_by must stay the original creator, not the current session user.
    expect(row.created_by).toBe('user-original');
    expect(row.updated_by).toBe('user-1');
  });

  it('sets created_by to the current user when the row is new', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T13:00:00Z' });
    // Response 1: LWW select — no existing row.
    enqueue(null);
    // Response 2: upsert
    enqueue(null);

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(true);
    const upsert = supabaseMock.chainable.upsert as ReturnType<typeof vi.fn>;
    const [row] = upsert.mock.calls[0];
    expect(row.created_by).toBe('user-1');
  });

  it('aborts before upsert when canvas-asset refs cannot be resolved', async () => {
    const prevApi = window.electronAPI;
    window.electronAPI = {
      ...(prevApi || {}),
      invoke: prevApi?.invoke ?? (async () => ({})),
      canvasAssetGet: vi.fn(async () => {
        throw new Error('not found');
      }),
    } as Window['electronAPI'];

    const doc = makeDoc({
      id: 'doc-1',
      updatedAt: '2026-07-22T13:00:00Z',
      layers: [
        {
          id: 'img1',
          type: 'image',
          name: 'Foto',
          value: 'canvas-asset:missing',
          cssVars: {
            '--width': '10mm',
            '--height': '10mm',
            '--translate-x': '0mm',
            '--translate-y': '0mm',
          },
        },
      ],
    });

    await expect(pushCanvasDocument(doc)).rejects.toThrow(/No se pudo resolver|canvas-asset/i);
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();

    window.electronAPI = prevApi;
  });

  it('preserves local version on skip when remote is newer', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T10:00:00Z' });
    // Response 1: select existing — remote is newer
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null, created_by: 'user-other' });
    // Response 2: insert into canvas_document_versions
    enqueue(null);

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(false);
    const insert = supabaseMock.chainable.insert as ReturnType<typeof vi.fn>;
    expect(insert).toHaveBeenCalledWith({
      document_id: 'doc-1',
      document: doc,
      created_by: 'user-1',
      created_at: '2026-07-22T10:00:00Z',
    });
  });

  it('uses atomic RPC canvas_push_document_lww when available and returns true on success', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T12:00:00Z' });
    supabaseMock.rpc.mockResolvedValueOnce({ data: true, error: null });

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(true);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('canvas_push_document_lww', {
      p_document: doc,
      p_updated_at: '2026-07-22T12:00:00Z',
    });
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('uses atomic RPC canvas_push_document_lww and returns false when remote was newer', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T10:00:00Z' });
    supabaseMock.rpc.mockResolvedValueOnce({ data: false, error: null });

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(false);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('canvas_push_document_lww', {
      p_document: doc,
      p_updated_at: '2026-07-22T10:00:00Z',
    });
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });
});

describe('pullCanvasDocument', () => {
  beforeEach(resetMocks);

  it('persists the remote snapshot before returning applied', async () => {
    const localDocument = makeDoc({
      name: 'Local',
      updatedAt: '2026-07-22T10:00:00Z',
    });
    const remoteDocument = makeDoc({
      name: 'Remote',
      updatedAt: '2026-07-22T12:00:00Z',
    });
    vi.mocked(api.canvasSave).mockResolvedValue({ document: remoteDocument });
    enqueue({
      document: remoteDocument,
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    });

    const result = await pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    });

    expect(result).toMatchObject({ kind: 'applied', remoteUpdatedAt: '2026-07-22T12:00:00Z' });
    expect(vi.mocked(api.canvasSave)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Remote', updatedAt: '2026-07-22T12:00:00Z' }),
      { touch: false },
    );
  });

  it('returns a conflict without writing when the open document is dirty', async () => {
    const localDocument = makeDoc({ name: 'Local', updatedAt: '2026-07-22T10:00:00Z' });
    const remoteDocument = makeDoc({ name: 'Remote', updatedAt: '2026-07-22T12:00:00Z' });
    enqueue({
      document: remoteDocument,
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    });

    const result = await pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: true,
    });

    expect(result).toMatchObject({
      kind: 'conflict',
      conflict: { localDoc: { name: 'Local' }, remoteDoc: { name: 'Remote' } },
    });
    expect(vi.mocked(api.canvasSave)).not.toHaveBeenCalled();
  });

  it('returns a deletion conflict even when the editor is clean', async () => {
    const localDocument = makeDoc({ updatedAt: '2026-07-22T10:00:00Z' });
    enqueue({
      document: null,
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    });

    const result = await pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    });

    expect(result).toMatchObject({
      kind: 'deleted',
      conflict: { remoteDoc: null, remoteDeleted: true },
    });
    expect(vi.mocked(api.canvasSave)).not.toHaveBeenCalled();
  });

  it('does not apply an equal or older remote snapshot', async () => {
    const localDocument = makeDoc({ updatedAt: '2026-07-22T12:00:00Z' });
    const remoteDocument = makeDoc({ name: 'Remote', updatedAt: '2026-07-22T11:00:00Z' });
    enqueue({
      document: remoteDocument,
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    });

    const result = await pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    });

    expect(result).toMatchObject({ kind: 'unchanged', remoteUpdatedAt: '2026-07-22T12:00:00Z' });
    expect(vi.mocked(api.canvasSave)).not.toHaveBeenCalled();
  });

  it('fails instead of accepting a remote row without a document snapshot', async () => {
    const localDocument = makeDoc({ updatedAt: '2026-07-22T10:00:00Z' });
    enqueue({
      document: null,
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    });

    await expect(pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    })).rejects.toThrow(/remote.*document|snapshot/i);
  });

  it('fails instead of accepting a remote row with an invalid timestamp', async () => {
    const localDocument = makeDoc({ updatedAt: '2026-07-22T10:00:00Z' });
    enqueue({
      document: makeDoc({ updatedAt: '2026-07-22T12:00:00Z' }),
      updated_at: 'not-a-date',
      deleted_at: null,
    });

    await expect(pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    })).rejects.toThrow(/timestamp|fecha|remote/i);
  });

  it('fails instead of accepting a deletion row with an invalid timestamp', async () => {
    const localDocument = makeDoc({ updatedAt: '2026-07-22T10:00:00Z' });
    enqueue({
      document: null,
      updated_at: 'not-a-date',
      deleted_at: 'not-a-date',
    });

    await expect(pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    })).rejects.toThrow(/timestamp|fecha|remote/i);
  });
});

