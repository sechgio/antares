import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasDocument } from '../types';

const serializeDocumentImages = vi.hoisted(() =>
  vi.fn(async (doc: CanvasDocument) => ({ ...doc, name: `${doc.name}-serialized` })),
);

const supabaseMock = vi.hoisted(() => {
  const responses: Array<{ data: unknown; error: unknown }> = [];
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'maybeSingle', 'update', 'insert', 'upsert', 'single', 'order', 'limit']) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable.then = (
    onFulfilled: ((v: unknown) => unknown) | undefined,
    onRejected?: ((e: unknown) => unknown) | undefined,
  ) => {
    const next = responses.shift() ?? { data: null, error: null };
    return Promise.resolve(next).then(onFulfilled, onRejected);
  };
  return {
    responses,
    chainable,
    from: vi.fn(() => chainable),
    getSession: vi.fn(async () => ({
      data: { session: { user: { id: 'user-1' } } },
    })),
  };
});

vi.mock('../utils/imageBlobStore', () => ({
  serializeDocumentImages: (...args: unknown[]) =>
    serializeDocumentImages(...(args as [CanvasDocument])),
  hydrateDocumentImages: vi.fn(async (doc: CanvasDocument) => doc),
  clearBlobStore: vi.fn(),
  releaseImageBlob: vi.fn(),
  getBlobUrl: vi.fn((v: string) => v),
  getThumbnailUrl: vi.fn((v: string) => v),
}));

vi.mock('../../../api', () => ({
  api: {
    canvasSave: vi.fn(async (doc: CanvasDocument) => ({ document: doc })),
  },
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: supabaseMock.getSession },
    from: supabaseMock.from,
  },
}));

import { api } from '../../../api';
import { restoreCanvasVersion } from '../sync/canvasCloudSync';

function makeDoc(overrides: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    version: 2,
    id: 'doc-1',
    name: 'Old version',
    updatedAt: '2026-01-01T00:00:00Z',
    page: { widthMm: 210, heightMm: 297 },
    layers: [],
    fields: [],
    ...overrides,
  };
}

describe('restoreCanvasVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.responses.length = 0;
    serializeDocumentImages.mockImplementation(async (doc: CanvasDocument) => ({
      ...doc,
      name: `${doc.name}-serialized`,
    }));
  });

  it('serializes before save, force-resurrects via opChain, returns doc for editor reload', async () => {
    const versionDoc = makeDoc();
    // 1) fetch version row
    supabaseMock.responses.push({ data: { document: versionDoc }, error: null });
    // 2) push LWW select
    supabaseMock.responses.push({ data: null, error: null });
    // 3) push upsert
    supabaseMock.responses.push({ data: null, error: null });

    const restored = await restoreCanvasVersion('doc-1', 'ver-1');

    expect(serializeDocumentImages).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1', name: 'Old version' }),
    );
    expect(api.canvasSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Old version-serialized' }),
      { touch: true },
    );
    expect(supabaseMock.chainable.upsert).toHaveBeenCalled();
    const [row] = (supabaseMock.chainable.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(row).toMatchObject({
      id: 'doc-1',
      name: 'Old version-serialized',
      deleted_at: null,
    });
    expect(restored).toEqual(expect.objectContaining({ name: 'Old version-serialized' }));
    expect(restored?.updatedAt).not.toBe('2026-01-01T00:00:00Z');
  });
});
