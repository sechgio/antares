import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasDocument } from '../../types';

const getSupabaseClient = vi.fn();
vi.mock('../../../../lib/supabaseLazy', () => ({
  getSupabaseClient: () => getSupabaseClient(),
}));
vi.mock('../canvasRealtime', () => ({
  broadcastCanvasDocumentSaved: vi.fn(),
  broadcastCanvasDocumentDeleted: vi.fn(),
}));
vi.mock('../../../../utils/observability', () => ({
  reportFrontendEvent: vi.fn(),
  reportFrontendError: vi.fn(),
}));

import {
  listRemoteCanvasMeta,
  markRemoteCanvasDeleted,
  pushCanvasDocument,
  pushCanvasDocumentResult,
} from '../canvasCloudSync';

const doc = (overrides: Partial<CanvasDocument> = {}): CanvasDocument =>
  ({
    version: 2,
    id: 'doc-1',
    name: 'Doc',
    updatedAt: '2026-09-17T00:00:00Z',
    page: { widthMm: 210, heightMm: 297 },
    layers: [],
    fields: [],
    ...overrides,
  }) as CanvasDocument;

type RpcHandler = (
  name: string,
  params: unknown,
) => Promise<{
  data?: unknown;
  error?: { message: string; code?: string; details?: string } | null;
} | null>;

interface FakeSupabaseOpts {
  userId?: string | null;
  rpc?: RpcHandler | undefined;
  list?: { data?: unknown; error?: { message: string } | null };
  select?: { data?: unknown; error?: { message: string } | null };
  upsert?: { data?: unknown; error?: { message: string } | null };
  update?: { data?: unknown; error?: { message: string } | null };
}

function makeSupabase(opts: FakeSupabaseOpts) {
  // select() devuelve un objeto thenable (para list/fetch) y a la vez chainable
  // (eq/in/is/maybeSingle para el select puntual del push).
  const selectChain = () => {
    const thenable = Promise.resolve(opts.list ?? { data: [], error: null });
    const sel: Record<string, unknown> = {
      then: thenable.then.bind(thenable),
      catch: thenable.catch.bind(thenable),
      finally: thenable.finally.bind(thenable),
      eq: () => sel,
      in: () => sel,
      is: () => sel,
      select: () => sel,
      maybeSingle: async () => opts.select ?? { data: null, error: null },
    };
    return sel;
  };
  const from = vi.fn(() => ({
    select: selectChain,
    upsert: vi.fn(() => ({
      select: vi.fn(
        async () => opts.upsert ?? { data: [{ id: 'doc-1' }], error: null },
      ),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(
          async () => opts.update ?? { data: [{ id: 'x' }], error: null },
        ),
      })),
    })),
  }));
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session:
            opts.userId === null ? null : { user: { id: opts.userId ?? 'u1' } },
        },
      })),
    },
    from,
    rpc: opts.rpc === undefined ? undefined : vi.fn(opts.rpc),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('listRemoteCanvasMeta', () => {
  it('null sin supabase o sin sesión', async () => {
    getSupabaseClient.mockResolvedValue(null);
    expect(await listRemoteCanvasMeta()).toBeNull();
    getSupabaseClient.mockResolvedValue(makeSupabase({ userId: null }));
    expect(await listRemoteCanvasMeta()).toBeNull();
  });

  it('devuelve filas y propaga error', async () => {
    getSupabaseClient.mockResolvedValue(
      makeSupabase({ list: { data: [{ id: 'a', updated_at: 'x' }] } }),
    );
    expect(await listRemoteCanvasMeta()).toEqual([
      { id: 'a', updated_at: 'x' },
    ]);
    getSupabaseClient.mockResolvedValue(
      makeSupabase({ list: { error: { message: 'boom' } } }),
    );
    await expect(listRemoteCanvasMeta()).rejects.toThrow('boom');
  });
});

describe('pushCanvasDocumentResult', () => {
  it('rechaza sin supabase o sin sesión sin lanzar', async () => {
    getSupabaseClient.mockResolvedValue(null);
    expect((await pushCanvasDocumentResult(doc())).accepted).toBe(false);
    getSupabaseClient.mockResolvedValue(makeSupabase({ userId: null }));
    expect((await pushCanvasDocumentResult(doc())).accepted).toBe(false);
  });

  it('rpc v2 acepta/rechaza según data booleana', async () => {
    getSupabaseClient.mockResolvedValue(
      makeSupabase({ rpc: async () => ({ data: true, error: null }) }),
    );
    expect((await pushCanvasDocumentResult(doc())).accepted).toBe(true);
    getSupabaseClient.mockResolvedValue(
      makeSupabase({ rpc: async () => ({ data: false, error: null }) }),
    );
    expect((await pushCanvasDocumentResult(doc())).accepted).toBe(false);
  });

  it('error de rpc real lanza su mensaje', async () => {
    getSupabaseClient.mockResolvedValue(
      makeSupabase({
        rpc: async () => ({
          data: null,
          error: { message: 'permiso denegado' },
        }),
      }),
    );
    await expect(pushCanvasDocumentResult(doc())).rejects.toThrow(
      'permiso denegado',
    );
  });

  it('rpc v2 ausente cae al legacy rpc', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'canvas_push_document_lww_v2'
        ? { data: null, error: { message: 'nf', code: 'PGRST202' } }
        : { data: true, error: null },
    );
    getSupabaseClient.mockResolvedValue(makeSupabase({ rpc }));
    expect((await pushCanvasDocumentResult(doc())).accepted).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'canvas_push_document_lww',
      expect.anything(),
    );
  });

  it('sin ningún rpc LWW lanza error claro', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'nf', code: 'PGRST202' },
    }));
    getSupabaseClient.mockResolvedValue(makeSupabase({ rpc }));
    await expect(pushCanvasDocumentResult(doc())).rejects.toThrow(
      'ningún RPC LWW',
    );
  });

  it('sin rpc + forceResurrect hace select+upsert', async () => {
    getSupabaseClient.mockResolvedValue(
      makeSupabase({
        rpc: undefined,
        select: { data: { created_by: 'otro' }, error: null },
        upsert: { data: [{ id: 'doc-1' }], error: null },
      }),
    );
    const res = await pushCanvasDocumentResult(doc(), { forceResurrect: true });
    expect(res.accepted).toBe(true);
    expect(res.updatedBy).toBe('u1');
  });

  it('upsert vacío (LWW suprimido) reporta rechazo y preserva vía rpc', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'canvas_append_document_version'
        ? { data: 'ok', error: null }
        : { data: null, error: { message: 'nf', code: 'PGRST202' } },
    );
    getSupabaseClient.mockResolvedValue(
      makeSupabase({
        rpc,
        select: { data: null, error: null },
        upsert: { data: [], error: null },
      }),
    );
    const res = await pushCanvasDocumentResult(doc(), { forceResurrect: true });
    expect(res.accepted).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      'canvas_append_document_version',
      expect.anything(),
    );
  });

  it('error de select propaga', async () => {
    getSupabaseClient.mockResolvedValue(
      makeSupabase({
        rpc: undefined,
        select: { data: null, error: { message: 'sel fail' } },
      }),
    );
    await expect(
      pushCanvasDocumentResult(doc(), { forceResurrect: true }),
    ).rejects.toThrow('sel fail');
  });

  it('documento >16MiB lanza antes de tocar la red', async () => {
    const rpc = vi.fn();
    getSupabaseClient.mockResolvedValue(makeSupabase({ rpc }));
    const big = doc({
      layers: [
        {
          id: 'x',
          type: 'text',
          name: 'x',
          value: 'a'.repeat(17 * 1024 * 1024),
          cssVars: {},
        },
      ] as never,
    });
    await expect(pushCanvasDocumentResult(big)).rejects.toThrow('16 MiB');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('pushCanvasDocument devuelve solo accepted', async () => {
    getSupabaseClient.mockResolvedValue(
      makeSupabase({ rpc: async () => ({ data: true, error: null }) }),
    );
    expect(await pushCanvasDocument(doc())).toBe(true);
  });
});

describe('markRemoteCanvasDeleted', () => {
  it('false sin supabase/sesión', async () => {
    getSupabaseClient.mockResolvedValue(null);
    expect(await markRemoteCanvasDeleted('d')).toBe(false);
    getSupabaseClient.mockResolvedValue(makeSupabase({ userId: null }));
    expect(await markRemoteCanvasDeleted('d')).toBe(false);
  });

  it('rpc v2 devuelve su boolean', async () => {
    getSupabaseClient.mockResolvedValue(
      makeSupabase({ rpc: async () => ({ data: true, error: null }) }),
    );
    expect(await markRemoteCanvasDeleted('d')).toBe(true);
  });

  it('rpc ausente cae a update+select; vacío = tombstone suprimido', async () => {
    getSupabaseClient.mockResolvedValue(
      makeSupabase({
        rpc: async () => {
          throw { code: 'PGRST202', message: 'missing' };
        },
        update: { data: [], error: null },
      }),
    );
    expect(await markRemoteCanvasDeleted('d')).toBe(false);
  });

  it('error de update propaga', async () => {
    getSupabaseClient.mockResolvedValue(
      makeSupabase({
        rpc: async () => {
          throw { code: 'PGRST202', message: 'missing' };
        },
        update: { data: null, error: { message: 'upd fail' } },
      }),
    );
    await expect(markRemoteCanvasDeleted('d')).rejects.toThrow('upd fail');
  });
});
