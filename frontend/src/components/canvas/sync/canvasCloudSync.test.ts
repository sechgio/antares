import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CanvasDocument } from '../types';
import {
  isNewer,
  pushCanvasDocument,
  shouldPushCanvasRow,
  syncCanvasDocuments,
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
  const responses: Array<{ data: unknown; error: unknown }> = [];

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

  return { responses, chainable, from, getSession };
});

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
  },
}));

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

function resetMocks(): void {
  vi.mocked(api.canvasList).mockReset();
  vi.mocked(api.canvasGet).mockReset();
  vi.mocked(api.canvasSave).mockReset();
  vi.mocked(api.canvasDelete).mockReset();

  supabaseMock.responses.length = 0;
  supabaseMock.from.mockClear();
  supabaseMock.getSession.mockReset();
  supabaseMock.getSession.mockResolvedValue({
    data: { session: { user: { id: 'user-1' } } },
  });

  for (const m of ['select', 'eq', 'in', 'is', 'maybeSingle', 'update', 'insert', 'upsert']) {
    (supabaseMock.chainable[m] as ReturnType<typeof vi.fn>).mockClear();
  }
}

// ---------------------------------------------------------------------------
// Existing isNewer tests (unchanged)
// ---------------------------------------------------------------------------

describe('canvasCloudSync isNewer', () => {
  it('treats missing local as older', () => {
    expect(isNewer('2026-07-22T12:00:00.000Z', undefined)).toBe(true);
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

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });

    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: true,
    });

    expect(result.pulled).toBe(0);
    expect(result.reloadOpenId).toBeUndefined();
    expect(vi.mocked(api.canvasSave)).not.toHaveBeenCalled();
  });

  // --- Step 3b: openDirty prevents delete ---

  it('does not delete local when openDirty is true (deleted remote)', async () => {
    const localDoc = { id: 'doc-1', name: 'Old', updatedAt: '2026-07-01T00:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });

    // Response 1: listRemoteCanvasMeta
    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: true,
    });

    expect(result.deletedLocal).toBe(0);
    expect(vi.mocked(api.canvasDelete)).not.toHaveBeenCalled();
  });

  // --- Step 4: remote-deleted removes local doc ---

  it('deletes local doc when remote is deleted and openDirty is false', async () => {
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

  // --- Regression: do not resurrect remotely-deleted docs on push ---
  // Uses openDirty:true so the pull phase SKIPS deleting the local doc —
  // the doc stays in localById and reaches the push loop, where the
  // `if (r?.deleted_at) continue;` guard must skip it. Without that guard,
  // pushCanvasDocument would run and set deleted_at:null on the remote.

  it('does not push when remote is deleted, even if local is newer (openDirty)', async () => {
    const localDoc = { id: 'doc-1', name: 'Edited', updatedAt: '2026-07-22T13:00:00Z' };
    const remoteMeta = {
      id: 'doc-1',
      name: 'Old',
      updated_at: '2026-07-22T12:00:00Z',
      deleted_at: '2026-07-22T12:00:00Z',
    };

    vi.mocked(api.canvasList).mockResolvedValue({ documents: [localDoc] });

    // Response 1: listRemoteCanvasMeta
    enqueue([remoteMeta]);

    const result = await syncCanvasDocuments({
      openDocumentId: 'doc-1',
      openDirty: true,
    });

    expect(result.pushed).toBe(0);
    expect(result.deletedLocal).toBe(0);
    expect(vi.mocked(api.canvasGet)).not.toHaveBeenCalled();
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
});
