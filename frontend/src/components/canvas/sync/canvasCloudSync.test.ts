import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CanvasDocument } from '../types';
import {
  isNewer,
  MAX_CLOUD_CANVAS_DOCUMENT_BYTES,
  markRemoteCanvasDeleted,
  pullCanvasDocument,
  pushCanvasDocument,
  queueCanvasCloudDelete,
  queueCanvasCloudPush,
  shouldPushCanvasRow,
  syncCanvasDocuments,
  withTimeout,
  _resetCanvasPushQueueForTests,
} from './canvasCloudSync';

const supabaseMock = vi.hoisted(() => {
  const responses: Array<
    { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>
  > = [];

  const chainable: Record<string, unknown> = {};

  for (const m of ['select', 'eq', 'in', 'is', 'maybeSingle', 'update', 'insert', 'upsert']) {
    chainable[m] = vi.fn(() => chainable);
  }

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

function enqueue(data: unknown, error: unknown = null): void {
  supabaseMock.responses.push({ data, error });
}

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
  _resetCanvasPushQueueForTests();
  vi.mocked(api.canvasList).mockReset();
  vi.mocked(api.canvasGet).mockReset();
  vi.mocked(api.canvasSave).mockReset();
  vi.mocked(api.canvasDelete).mockReset();
  realtimeMock.broadcastCanvasDocumentSaved.mockReset();
  realtimeMock.broadcastCanvasDocumentSaved.mockResolvedValue(true);

  supabaseMock.responses.length = 0;
  supabaseMock.from.mockClear();
  supabaseMock.rpc.mockReset();
  supabaseMock.rpc.mockResolvedValue({ data: true, error: null });
  supabaseMock.getSession.mockReset();
  supabaseMock.getSession.mockResolvedValue({
    data: { session: { user: { id: 'user-1' } } },
  });

  for (const m of ['select', 'eq', 'in', 'is', 'maybeSingle', 'update', 'insert', 'upsert']) {
    (supabaseMock.chainable[m] as ReturnType<typeof vi.fn>).mockClear();
  }
}

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

describe('syncCanvasDocuments', () => {
  beforeEach(resetMocks);

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

    enqueue([remoteMeta]);
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

    enqueue([remoteMeta]);
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null });
    enqueue(null);

    const result = await syncCanvasDocuments({});

    expect(result.pushed).toBe(1);
    expect(vi.mocked(api.canvasGet)).toHaveBeenCalledWith('doc-1');
    expect(realtimeMock.broadcastCanvasDocumentSaved).toHaveBeenCalledWith({
      type: 'document_saved',
      documentId: 'doc-1',
      updatedAt: '2026-07-22T13:00:00Z',
      updatedBy: 'user-1',
    });
  });

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

  it('does not push when remote is deleted and open doc is dirty (conflict instead)', async () => {
    const localDoc = { id: 'doc-1', name: 'Edited', updatedAt: '2026-07-22T11:00:00Z' };
    const localFull = makeDoc({ id: 'doc-1', name: 'Edited', updatedAt: '2026-07-22T11:00:00Z' });
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

    enqueue([remoteMeta]);
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null });
    supabaseMock.rpc.mockRejectedValueOnce(new Error('RLS denied'));

    const result = await syncCanvasDocuments({});

    expect(result.pushErrors).toBe(1);
    expect(result.lastError).toContain('RLS denied');
    expect(result.pushed).toBe(0);
  });

  it('keeps a local doc newer than the remote tombstone (no delete, no conflict)', async () => {
    const localDoc = { id: 'doc-1', name: 'Edited', updatedAt: '2026-07-22T13:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });
    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: false,
    });

    expect(result.deletedLocal).toBe(0);
    expect(result.conflict).toBeUndefined();
    expect(vi.mocked(api.canvasDelete)).not.toHaveBeenCalled();
  });

  it('surfaces a rejected push (remote newer) as pushErrors instead of silent success', async () => {
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

    enqueue([remoteMeta]);
    supabaseMock.rpc.mockResolvedValueOnce({ data: false, error: null });

    const result = await syncCanvasDocuments({});

    expect(result.pushed).toBe(0);
    expect(result.pushErrors).toBe(1);
    expect(result.lastError).toBeTruthy();
    expect(realtimeMock.broadcastCanvasDocumentSaved).not.toHaveBeenCalled();
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
    enqueue([]);
    enqueue([]);

    const first = syncCanvasDocuments({ openDocumentId: 'doc-a', openDirty: false });
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

    vi.mocked(api.canvasList)
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValue({ documents: [localDoc] });
    vi.mocked(api.canvasGet).mockResolvedValue({ document: localFull });

    enqueue([]);
    enqueue([remoteMeta]);
    enqueue([{ document: remoteDoc, updated_at: '2026-07-22T12:00:00Z' }]);

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
    expect(followUp).not.toHaveBeenCalled();
  });

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
    enqueue([]);
    enqueue([]);

    supabaseMock.rpc.mockImplementation(async (name: string) => {
      if (name === 'canvas_push_document_lww_v2') events.push('push-rpc');
      return { data: true, error: null };
    });

    const first = syncCanvasDocuments({ openDocumentId: 'doc-a', openDirty: false });
    await Promise.resolve();
    await Promise.resolve();

    queueCanvasCloudPush(makeDoc({ id: 'doc-push' }));

    const skipped = await syncCanvasDocuments({ openDocumentId: 'doc-b', openDirty: true });
    expect(skipped.skipped).toBe(true);

    releaseSession({ data: { session: { user: { id: 'user-1' } } } });
    await first;

    await vi.waitFor(() => {
      expect(events.filter((e) => e === 'list')).toHaveLength(2);
      expect(events).toContain('push-rpc');
    });
    const firstList = events.indexOf('list');
    const secondList = events.indexOf('list', firstList + 1);
    const pushAt = events.indexOf('push-rpc');
    expect(secondList).toBeGreaterThan(firstList);
    expect(pushAt).toBeGreaterThan(secondList);
  });

  it('serializes two queued pushes (second waits for first)', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    supabaseMock.rpc.mockImplementation(async (name: string, params: { p_document?: { id: string } }) => {
      if (name !== 'canvas_push_document_lww_v2') return { data: true, error: null };
      callCount += 1;
      events.push(`rpc:${params.p_document?.id}`);
      if (callCount === 1) await firstGate;
      return { data: true, error: null };
    });

    queueCanvasCloudPush(makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T12:00:00Z' }));
    queueCanvasCloudPush(makeDoc({ id: 'doc-2', updatedAt: '2026-07-22T12:00:00Z' }));

    await vi.waitFor(() => {
      expect(events).toEqual(['rpc:doc-1']);
    });

    releaseFirst();
    await vi.waitFor(() => {
      expect(events).toEqual(['rpc:doc-1', 'rpc:doc-2']);
    });
  });

  it('flushes a push queued while the previous batch is in flight', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    supabaseMock.rpc.mockImplementation(async (name: string, params: { p_document?: { id: string } }) => {
      if (name !== 'canvas_push_document_lww_v2') return { data: true, error: null };
      callCount += 1;
      events.push(`rpc:${params.p_document?.id}`);
      if (callCount === 1) await firstGate;
      return { data: true, error: null };
    });

    const first = queueCanvasCloudPush(makeDoc({ id: 'doc-in-flight-1' }));
    await vi.waitFor(() => {
      expect(events).toEqual(['rpc:doc-in-flight-1']);
    });
    const second = queueCanvasCloudPush(makeDoc({ id: 'doc-in-flight-2' }));

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['rpc:doc-in-flight-1', 'rpc:doc-in-flight-2']);
  });

  it('coalesces five pushes of the same id into one atomic push (last-write-wins)', async () => {
    const names: string[] = [];
    supabaseMock.rpc.mockImplementation(async (name: string, params: { p_document?: { name: string } }) => {
      if (name === 'canvas_push_document_lww_v2') names.push(params.p_document?.name ?? '');
      return { data: true, error: null };
    });

    for (let i = 0; i < 5; i++) {
      queueCanvasCloudPush(makeDoc({ id: 'doc-same', name: `v${i}`, updatedAt: '2026-07-22T12:00:00Z' }));
    }

    await vi.waitFor(() => {
      expect(names).toEqual(['v4']);
    });
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it('runs push immediately when opChain is idle', async () => {
    await expect(queueCanvasCloudPush(makeDoc({ id: 'doc-idle' }))).resolves.toBeUndefined();
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'canvas_push_document_lww_v2',
      expect.objectContaining({ p_document: expect.objectContaining({ id: 'doc-idle' }) }),
    );
  });

  it('serializes delete behind a pending push', async () => {
    const events: string[] = [];
    let releasePush!: () => void;
    const pushGate = new Promise<void>((resolve) => {
      releasePush = resolve;
    });
    supabaseMock.rpc.mockImplementation(async (name: string) => {
      if (name === 'canvas_push_document_lww_v2') {
        events.push('push');
        await pushGate;
      } else if (name === 'canvas_delete_document_lww_v2') {
        events.push('delete');
      }
      return { data: true, error: null };
    });

    queueCanvasCloudPush(makeDoc({ id: 'doc-1' }));
    queueCanvasCloudDelete('doc-1');
    await vi.waitFor(() => expect(events).toEqual(['push']));

    releasePush();
    await vi.waitFor(() => {
      expect(events).toEqual(['push', 'delete']);
    });
  });

  it('publishes only an accepted queued push', async () => {
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
    supabaseMock.rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(queueCanvasCloudPush(makeDoc({
      id: 'doc-rejected',
      updatedAt: '2026-07-22T12:00:00Z',
    }))).resolves.toBeUndefined();

    expect(realtimeMock.broadcastCanvasDocumentSaved).not.toHaveBeenCalled();
  });

  it('continues the batch and retries a failed queued document', async () => {
    const first = makeDoc({ id: 'doc-batch-fail-1' });
    const second = makeDoc({ id: 'doc-batch-fail-2' });
    let attempts = 0;
    supabaseMock.rpc.mockImplementation(async (name: string) => {
      if (name === 'canvas_push_document_lww_v2') {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary cloud failure');
        return { data: true, error: null };
      }
      return { data: true, error: null };
    });

    const firstPush = queueCanvasCloudPush(first);
    const secondPush = queueCanvasCloudPush(second);

    await expect(firstPush).rejects.toThrow('temporary cloud failure');
    await expect(secondPush).rejects.toThrow('temporary cloud failure');
    await expect(queueCanvasCloudPush(first)).resolves.toBeUndefined();
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'canvas_push_document_lww_v2',
      expect.objectContaining({ p_document: second }),
    );
  });

  it('automatically retries a failed queued push with backoff', async () => {
    vi.useFakeTimers();
    const doc = makeDoc({ id: 'doc-auto-retry', updatedAt: '2026-07-22T12:00:00Z' });
    let calls = 0;
    supabaseMock.rpc.mockImplementation(async (name: string) => {
      if (name === 'canvas_push_document_lww_v2') {
        calls += 1;
        if (calls === 1) return { data: null, error: { code: 'XX001', message: 'temporary failure' } };
        return { data: true, error: null };
      }
      return { data: true, error: null };
    });

    const push = queueCanvasCloudPush(doc);
    const settled = expect(push).rejects.toThrow('temporary failure');
    await vi.advanceTimersByTimeAsync(0);
    await settled;
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });
});

describe('pushCanvasDocument', () => {
  beforeEach(resetMocks);

  it('uses the atomic LWW RPC for a normal push', async () => {
    const doc = makeDoc({
      id: 'doc-1',
      name: 'Test',
      updatedAt: '2026-07-22T12:00:00Z',
    });

    supabaseMock.rpc.mockResolvedValueOnce({ data: true, error: null });

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(true);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('canvas_push_document_lww_v2', {
      p_document: doc,
      p_updated_at: '2026-07-22T12:00:00Z',
      p_force_resurrect: false,
    });
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('fails closed when remote is newer but version preservation is unavailable', async () => {
    const doc = makeDoc({
      id: 'doc-1',
      updatedAt: '2026-07-22T12:00:00Z',
    });
    supabaseMock.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'canvas_push_document_lww_v2 is missing' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'canvas_push_document_lww is missing' },
      });

    await expect(pushCanvasDocument(doc)).rejects.toThrow(/ningún RPC LWW/);
    expect(supabaseMock.chainable.insert).not.toHaveBeenCalled();
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('preserves existing created_by on update instead of overwriting with the current user', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T13:00:00Z' });
    supabaseMock.rpc.mockResolvedValueOnce({ data: true, error: null });

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(true);
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('sets created_by to the current user when the row is new', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T13:00:00Z' });
    supabaseMock.rpc.mockResolvedValueOnce({ data: true, error: null });

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(true);
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
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

  it('rejects an oversized cloud payload before calling Supabase', async () => {
    const doc = makeDoc({
      id: 'doc-large',
      name: 'x'.repeat(MAX_CLOUD_CANVAS_DOCUMENT_BYTES),
    });

    await expect(pushCanvasDocument(doc)).rejects.toThrow(/16 MiB/);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('fails closed when the version-preservation RPC is unavailable', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T10:00:00Z' });
    supabaseMock.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'canvas_push_document_lww_v2 is missing' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'canvas_push_document_lww is missing' },
      });
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null, created_by: 'user-other' });

    await expect(pushCanvasDocument(doc)).rejects.toThrow(/ningún RPC LWW/);

    expect(supabaseMock.chainable.insert).not.toHaveBeenCalled();
  });

  it('uses the versioned atomic RPC when available and returns true on success', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T12:00:00Z' });
    supabaseMock.rpc.mockResolvedValueOnce({ data: true, error: null });

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(true);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('canvas_push_document_lww_v2', {
      p_document: doc,
      p_updated_at: '2026-07-22T12:00:00Z',
      p_force_resurrect: false,
    });
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('falls back to the legacy atomic LWW RPC when v2 is missing', async () => {
    const doc = makeDoc({ id: 'doc-legacy-rpc', updatedAt: '2026-07-22T12:00:00Z' });
    supabaseMock.rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.canvas_push_document_lww_v2',
        },
      })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(pushCanvasDocument(doc)).resolves.toBe(true);

    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(2, 'canvas_push_document_lww', {
      p_document: doc,
      p_updated_at: '2026-07-22T12:00:00Z',
    });
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('fails closed instead of using an unsafe upsert when both LWW RPCs are missing', async () => {
    const doc = makeDoc({ id: 'doc-no-rpc', updatedAt: '2026-07-22T12:00:00Z' });
    supabaseMock.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'canvas_push_document_lww_v2 is missing' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'canvas_push_document_lww is missing' },
      });

    await expect(pushCanvasDocument(doc)).rejects.toThrow(/LWW.*disponible|sincronizar/i);
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('forceResurrect without LWW RPCs uses the manual upsert and reports trigger suppression', async () => {
    const doc = makeDoc({ id: 'doc-force', updatedAt: '2026-07-22T12:00:00Z' });
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'rpc missing' },
    });
    // select() for the existing row, then upsert() suppressed by the LWW trigger.
    enqueue(null);
    enqueue([]);

    await expect(pushCanvasDocument(doc, { forceResurrect: true })).resolves.toBe(false);
    expect(supabaseMock.chainable.upsert).toHaveBeenCalled();
  });

  it('forceResurrect without LWW RPCs accepts a landed manual upsert', async () => {
    const doc = makeDoc({ id: 'doc-force-ok', updatedAt: '2026-07-22T12:00:00Z' });
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'rpc missing' },
    });
    enqueue(null);
    enqueue([{ id: 'doc-force-ok' }]);

    await expect(pushCanvasDocument(doc, { forceResurrect: true })).resolves.toBe(true);
  });

  it('uses the versioned atomic RPC and returns false when remote was newer', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T10:00:00Z' });
    supabaseMock.rpc.mockResolvedValueOnce({ data: false, error: null });

    const ok = await pushCanvasDocument(doc);

    expect(ok).toBe(false);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('canvas_push_document_lww_v2', {
      p_document: doc,
      p_updated_at: '2026-07-22T10:00:00Z',
      p_force_resurrect: false,
    });
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('passes force resurrection through the versioned atomic RPC', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T10:00:00Z' });
    supabaseMock.rpc.mockResolvedValueOnce({ data: true, error: null });

    await expect(pushCanvasDocument(doc, { forceResurrect: true })).resolves.toBe(true);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('canvas_push_document_lww_v2', {
      p_document: doc,
      p_updated_at: '2026-07-22T10:00:00Z',
      p_force_resurrect: true,
    });
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('uses the versioned atomic RPC for remote deletion', async () => {
    supabaseMock.rpc.mockResolvedValueOnce({ data: true, error: null });

    await expect(markRemoteCanvasDeleted('doc-1')).resolves.toBe(true);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('canvas_delete_document_lww_v2', {
      p_id: 'doc-1',
      p_deleted_at: expect.any(String),
    });
    expect(supabaseMock.chainable.update).not.toHaveBeenCalled();
  });

  it('keeps legacy deletion available when the versioned RPC is missing', async () => {
    supabaseMock.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.canvas_delete_document_lww_v2 in the schema cache',
      },
    });
    enqueue([{ id: 'doc-1' }]);

    await expect(markRemoteCanvasDeleted('doc-1')).resolves.toBe(true);

    expect(supabaseMock.chainable.update).toHaveBeenCalledWith(expect.objectContaining({
      deleted_at: expect.any(String),
      updated_at: expect.any(String),
      updated_by: 'user-1',
    }));
    expect(supabaseMock.chainable.select).toHaveBeenCalledWith('id');
  });

  it('reports false when the legacy tombstone update is suppressed by the LWW trigger', async () => {
    supabaseMock.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.canvas_delete_document_lww_v2 in the schema cache',
      },
    });
    enqueue([]);

    await expect(markRemoteCanvasDeleted('doc-1')).resolves.toBe(false);
  });

  it('does not hide transient LWW RPC failures behind the legacy upsert', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T12:00:00Z' });
    supabaseMock.rpc.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(pushCanvasDocument(doc)).rejects.toThrow('deadlock detected');
    expect(supabaseMock.chainable.upsert).not.toHaveBeenCalled();
  });

  it('does not fall back to an unsafe upsert after real PostgREST missing-RPC errors', async () => {
    const doc = makeDoc({ id: 'doc-1', updatedAt: '2026-07-22T12:00:00Z' });
    supabaseMock.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function public.canvas_push_document_lww_v2' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function public.canvas_push_document_lww' },
      });

    await expect(pushCanvasDocument(doc)).rejects.toThrow(/ningún RPC LWW/);
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
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null });
    enqueue({ document: remoteDocument, updated_at: '2026-07-22T12:00:00Z' });

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
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null });
    enqueue({ document: remoteDocument, updated_at: '2026-07-22T12:00:00Z' });

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
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });

  it('does not apply an equal or older remote snapshot', async () => {
    const localDocument = makeDoc({ updatedAt: '2026-07-22T12:00:00Z' });
    enqueue({
      updated_at: '2026-07-22T11:00:00Z',
      deleted_at: null,
    });

    const result = await pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    });

    expect(result).toMatchObject({ kind: 'unchanged', remoteUpdatedAt: '2026-07-22T11:00:00Z' });
    expect(vi.mocked(api.canvasSave)).not.toHaveBeenCalled();
  });

  it('skips the document column fetch when the remote row is not newer', async () => {
    const localDocument = makeDoc({ updatedAt: '2026-07-22T12:00:00Z' });
    enqueue({
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: null,
    });

    const result = await pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    });

    expect(result).toMatchObject({ kind: 'unchanged' });
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.chainable.select).toHaveBeenCalledWith('updated_at, deleted_at');
    expect(supabaseMock.chainable.select).not.toHaveBeenCalledWith(
      expect.stringContaining('document'),
    );
  });

  it('fails instead of accepting a remote row without a document snapshot', async () => {
    const localDocument = makeDoc({ updatedAt: '2026-07-22T10:00:00Z' });
    enqueue({ updated_at: '2026-07-22T12:00:00Z', deleted_at: null });
    enqueue({ document: null, updated_at: '2026-07-22T12:00:00Z' });

    await expect(pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    })).rejects.toThrow(/remote.*document|snapshot/i);
  });

  it('fails instead of accepting a remote row with an invalid timestamp', async () => {
    const localDocument = makeDoc({ updatedAt: '2026-07-22T10:00:00Z' });
    enqueue({
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
      updated_at: 'not-a-date',
      deleted_at: 'not-a-date',
    });

    await expect(pullCanvasDocument('doc-1', {
      localDocument,
      openDirty: false,
    })).rejects.toThrow(/timestamp|fecha|remote/i);
  });
});

