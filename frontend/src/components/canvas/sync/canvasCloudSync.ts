import { api } from '../../../api';
import { getSupabaseClient } from '../../../lib/supabaseLazy';
import type { CanvasDocument } from '../types';
import { normalizeDocument } from '../types';
import {
  isNewer,
  type CanvasRemoteMeta,
  type SyncConflict,
  type SyncResult,
} from './syncCompare';
import { broadcastCanvasDocumentSaved } from './canvasRealtime';
import { TimerScheduler } from './timerScheduler';
import { notifyPushHealth } from './pushHealth';
import { reportFrontendError, reportFrontendEvent } from '../../../utils/observability';
import { errorMessage } from '@/utils/errors';
import { withTimeout } from '@/utils/async';
import {
  pendingCanvasDeletes,
  recordPendingCanvasDelete,
  clearPendingCanvasDelete,
  pendingCanvasPushes,
  recordPendingCanvasPush,
  clearPendingCanvasPush,
} from './cloudQueue';

type LocalSummary = { id: string; name: string; updatedAt?: string };

const CLOUD_SYNC_TIMEOUT_MS = 30_000;
const CLOUD_META_PAGE_SIZE = 200;
const PULL_SYNC_CONCURRENCY = 4;
export const MAX_CLOUD_CANVAS_DOCUMENT_BYTES = 16 * 1024 * 1024;

function assertCloudCanvasDocumentSize(doc: CanvasDocument): void {
  const bytes = new TextEncoder().encode(JSON.stringify(doc)).byteLength;
  if (bytes > MAX_CLOUD_CANVAS_DOCUMENT_BYTES) {
    throw new Error('El documento Canvas excede el límite de 16 MiB para sincronización');
  }
}

async function sessionUserId(): Promise<string | null> {
  const supabase = await getSupabaseClient();
  if (!supabase) return null;
  const { data } = await withTimeout(
    supabase.auth.getSession(),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-auth-session',
  );
  return data.session?.user?.id ?? null;
}

export async function listRemoteCanvasMeta(): Promise<CanvasRemoteMeta[] | null> {
  const supabase = await getSupabaseClient();
  if (!supabase) return null;
  const uid = await sessionUserId();
  if (!uid) return null;
  const rows: CanvasRemoteMeta[] = [];
  for (let offset = 0; ; offset += CLOUD_META_PAGE_SIZE) {
    const { data, error } = await withTimeout(
      supabase.from('canvas_documents').select('id, name, updated_at, deleted_at')
        .order('id').range(offset, offset + CLOUD_META_PAGE_SIZE - 1),
      CLOUD_SYNC_TIMEOUT_MS,
      'canvas-list-remote',
    );
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < CLOUD_META_PAGE_SIZE) return rows;
  }
}

type CanvasPushResult = {
  accepted: boolean;
  documentId: string;
  updatedAt: string;
  updatedBy: string;
};

function pushResult(
  doc: CanvasDocument,
  accepted: boolean,
  updatedAt: string,
  updatedBy = '',
): CanvasPushResult {
  return {
    accepted,
    documentId: doc.id,
    updatedAt,
    updatedBy,
  };
}

function isMissingRpcError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object') {
    const errObj = error as { code?: unknown; message?: unknown; details?: unknown };
    if (typeof errObj.code === 'string' && /PGRST202/i.test(errObj.code)) {
      return true;
    }
    const msg = typeof errObj.message === 'string' ? errObj.message : '';
    if (
      /PGRST202|RPC function not found|function .* does not exist|could not find the function/i.test(
        msg,
      )
    ) {
      return true;
    }
    const details = typeof errObj.details === 'string' ? errObj.details : '';
    if (/PGRST202|could not find the function/i.test(details)) {
      return true;
    }
  }
  const message = errorMessage(error, String(error ?? ''));
  return /PGRST202|RPC function not found|function .* does not exist|could not find the function/i.test(
    message,
  );
}

type CanvasRpcError = {
  code?: string;
  details?: string;
  hint?: string;
  message: string;
};

type CanvasRpcResponse<T> = {
  data: T | null;
  error: CanvasRpcError | null;
};

export async function pushCanvasDocumentResult(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<CanvasPushResult> {
  const supabase = await getSupabaseClient();
  if (!supabase) return pushResult(doc, false, doc.updatedAt || '');
  const uid = await sessionUserId();
  if (!uid) return pushResult(doc, false, doc.updatedAt || '');

  const {
    assertCanvasAssetExpansionWithinBytes,
    embedCanvasAssetsAsDataUrls,
    countCanvasAssetRefs,
  } = await import('../utils/imageBlobStore');
  if (countCanvasAssetRefs(doc) > 0) {
    await assertCanvasAssetExpansionWithinBytes(doc, MAX_CLOUD_CANVAS_DOCUMENT_BYTES);
    doc = await embedCanvasAssetsAsDataUrls(doc, { strict: true });
    if (!window.electronAPI?.canvasAssetInfo) assertCloudCanvasDocumentSize(doc);
  } else {
    assertCloudCanvasDocumentSize(doc);
  }

  const updatedAt = doc.updatedAt || new Date().toISOString();

  if (typeof supabase.rpc === 'function') {
    try {
      const rpcRes = (await withTimeout(
        (supabase.rpc as unknown as (n: string, p: unknown) => PromiseLike<CanvasRpcResponse<boolean>>)(
          'canvas_push_document_lww_v2',
          {
            p_document: doc,
            p_updated_at: updatedAt,
            p_force_resurrect: options?.forceResurrect ?? false,
          },
        ),
        CLOUD_SYNC_TIMEOUT_MS,
        'canvas-push-rpc',
      )) as CanvasRpcResponse<boolean> | null;
      if (rpcRes?.error) {
        if (!isMissingRpcError(rpcRes.error)) throw new Error(rpcRes.error.message);
        throw rpcRes.error;
      } else if (rpcRes && typeof rpcRes.data === 'boolean') {
        return pushResult(doc, rpcRes.data, updatedAt, uid);
      } else if (rpcRes) {
        throw new Error('Respuesta inválida de canvas_push_document_lww_v2');
      }
    } catch (err) {
      if (!isMissingRpcError(err)) throw err;
      reportFrontendEvent({
        event: 'canvas.push',
        level: 'WARN',
        outcome: 'degraded',
        reason: 'lww_rpc_v2_missing',
      });

      if (!options?.forceResurrect) {
        try {
          const legacyRes = (await withTimeout(
            (supabase.rpc as unknown as (n: string, p: unknown) => PromiseLike<CanvasRpcResponse<boolean>>)(
              'canvas_push_document_lww',
              { p_document: doc, p_updated_at: updatedAt },
            ),
            CLOUD_SYNC_TIMEOUT_MS,
            'canvas-push-legacy-rpc',
          )) as CanvasRpcResponse<boolean> | null;
          if (legacyRes?.error) {
            if (!isMissingRpcError(legacyRes.error)) throw new Error(legacyRes.error.message);
            throw legacyRes.error;
          }
          if (legacyRes && typeof legacyRes.data === 'boolean') {
            return pushResult(doc, legacyRes.data, updatedAt, uid);
          }
          if (legacyRes) throw new Error('Respuesta inválida de canvas_push_document_lww');
        } catch (legacyErr) {
          if (!isMissingRpcError(legacyErr)) throw legacyErr;
          throw new Error('No se puede sincronizar Canvas: ningún RPC LWW está disponible');
        }
      }
    }
  }

  if (!options?.forceResurrect) {
    throw new Error('No se puede sincronizar Canvas: ningún RPC LWW está disponible');
  }

  const { data: existing, error: selectError } = await withTimeout(
    supabase
      .from('canvas_documents')
      .select('updated_at, deleted_at, created_by')
      .eq('id', doc.id)
      .maybeSingle(),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-push-select',
  );
  if (selectError) throw new Error(selectError.message);

  const existingRow = existing as { created_by?: string } | null;
  const row = {
    id: doc.id,
    name: doc.name,
    document: doc,
    updated_at: updatedAt,
    updated_by: uid,
    deleted_at: null as string | null,
    created_by: existingRow?.created_by ?? uid,
  };

  const { data: upserted, error } = await withTimeout(
    supabase.from('canvas_documents').upsert(row, { onConflict: 'id' }).select('id'),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-push-upsert',
  );
  if (error) throw new Error(error.message);
  if (!upserted || upserted.length === 0) {
    try {
      const appendRes = (await withTimeout(
        (supabase.rpc as unknown as (n: string, p: unknown) => PromiseLike<{ data: unknown; error: { message: string; code?: string; details?: string } | null }>)(
          'canvas_append_document_version',
          { p_document_id: doc.id, p_document: doc },
        ),
        CLOUD_SYNC_TIMEOUT_MS,
        'canvas-push-skip-preserve',
      )) as { data: unknown; error: { message: string; code?: string; details?: string } | null } | null;
      if (appendRes?.error && !isMissingRpcError(appendRes.error)) {
        reportFrontendEvent({
          event: 'canvas.push',
          level: 'WARN',
          outcome: 'degraded',
          reason: 'preserve_rejected_version_failed',
        });
      }
    } catch (err) {
      if (!isMissingRpcError(err)) {
        reportFrontendEvent({
          event: 'canvas.push',
          level: 'WARN',
          outcome: 'degraded',
          reason: 'preserve_rejected_version_failed',
        });
      }
    }
    return pushResult(doc, false, updatedAt, uid);
  }
  return pushResult(doc, true, updatedAt, uid);
}

export async function pushCanvasDocument(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<boolean> {
  return (await pushCanvasDocumentResult(doc, options)).accepted;
}

export async function markRemoteCanvasDeleted(id: string): Promise<boolean> {
  const supabase = await getSupabaseClient();
  if (!supabase) return false;
  const uid = await sessionUserId();
  if (!uid) return false;
  const now = new Date().toISOString();

  if (typeof supabase.rpc === 'function') {
    try {
      const rpcRes = (await withTimeout(
        (supabase.rpc as unknown as (n: string, p: unknown) => PromiseLike<CanvasRpcResponse<boolean>>)(
          'canvas_delete_document_lww_v2',
          { p_id: id, p_deleted_at: now },
        ),
        CLOUD_SYNC_TIMEOUT_MS,
        'canvas-mark-deleted-rpc',
      )) as CanvasRpcResponse<boolean> | null;
      if (rpcRes?.error) {
        if (!isMissingRpcError(rpcRes.error)) throw new Error(rpcRes.error.message);
        throw rpcRes.error;
      }
      if (rpcRes && typeof rpcRes.data === 'boolean') return rpcRes.data;
      if (rpcRes) throw new Error('Respuesta inválida de canvas_delete_document_lww_v2');
    } catch (err) {
      if (!isMissingRpcError(err)) throw err;
      reportFrontendEvent({
        event: 'canvas.push',
        level: 'WARN',
        outcome: 'degraded',
        reason: 'lww_rpc_v2_missing',
      });
    }
  }

  const { data: updated, error } = await withTimeout(
    supabase
      .from('canvas_documents')
      .update({ deleted_at: now, updated_at: now, updated_by: uid })
      .eq('id', id)
      .select('id'),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-mark-deleted',
  );
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) {
    reportFrontendEvent({
      event: 'canvas.push',
      level: 'WARN',
      outcome: 'rejected',
      reason: 'tombstone_suppressed',
    });
    return false;
  }
  return true;
}

async function replayPendingCanvasDeletes(): Promise<void> {
  const ids = pendingCanvasDeletes(true);
  if (ids.length === 0) return;
  const supabase = await getSupabaseClient();
  if (!supabase || !await sessionUserId()) return;
  for (const id of ids) {
    pendingPushById.delete(id);
    try {
      const local = await api.canvasGet(id);
      if (local?.document) {
        clearPendingCanvasDelete(id);
        continue;
      }
    } catch (err) {
      if (!(err && typeof err === 'object' && 'category' in err && err.category === 'NOT_FOUND')) throw err;
    }
    if (!await markRemoteCanvasDeleted(id)) {
      const { data, error } = await withTimeout(
        supabase.from('canvas_documents').select('deleted_at').eq('id', id).maybeSingle(),
        CLOUD_SYNC_TIMEOUT_MS,
        'canvas-confirm-deleted',
      );
      if (error) throw new Error(error.message);
      if (data && !data.deleted_at) throw new Error('El servidor no confirmó el borrado del documento');
    }
    clearPendingCanvasDelete(id);
  }
}

async function fetchRemoteDocuments(ids: string[]): Promise<CanvasDocument[]> {
  const supabase = await getSupabaseClient();
  if (!supabase || ids.length === 0) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('canvas_documents')
      .select('document, updated_at')
      .in('id', ids)
      .is('deleted_at', null),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-fetch-remote',
  );
  if (error) throw new Error(error.message);
  const out: CanvasDocument[] = [];
  for (const row of data ?? []) {
    const raw = row.document;
    const remoteId = raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string'
      ? raw.id
      : '';
    out.push(remoteDocumentFromRow(row, remoteId).document);
  }
  return out;
}

type CanvasRemoteDocumentRow = {
  document?: unknown;
  updated_at?: string | null;
  deleted_at?: string | null;
};

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function remoteDocumentFromRow(
  row: CanvasRemoteDocumentRow,
  documentId: string,
): { document: CanvasDocument; updatedAt: string } {
  if (!documentId || !row.document || typeof row.document !== 'object') {
    throw new Error('Invalid remote Canvas document snapshot');
  }
  const raw = row.document as CanvasDocument;
  const updatedAt = row.updated_at || raw.updatedAt || '';
  if (!isValidTimestamp(updatedAt)) {
    throw new Error('Invalid remote Canvas document timestamp');
  }

  try {
    return {
      document: normalizeDocument({
        ...raw,
        id: documentId,
        updatedAt,
      }),
      updatedAt,
    };
  } catch (err) {
    const msg = errorMessage(err, String(err));
    throw new Error(`Invalid remote Canvas document snapshot: ${msg}`);
  }
}

type TargetedCanvasPullResult =
  | { kind: 'unchanged'; remoteUpdatedAt?: string }
  | { kind: 'applied'; document: CanvasDocument; remoteUpdatedAt: string }
  | { kind: 'conflict'; conflict: SyncConflict }
  | { kind: 'deleted'; conflict: SyncConflict };

export async function pullCanvasDocument(
  documentId: string,
  options: { localDocument: CanvasDocument; openDirty: boolean; getOpenState?: SyncOptions['getOpenState'] },
): Promise<TargetedCanvasPullResult> {
  if (pendingCanvasDeletes().includes(documentId)) return { kind: 'unchanged' };
  const supabase = await getSupabaseClient();
  if (!supabase) return { kind: 'unchanged' };
  const uid = await sessionUserId();
  if (!uid) return { kind: 'unchanged' };

  const { data: meta, error: metaError } = await withTimeout(
    supabase
      .from('canvas_documents')
      .select('updated_at, deleted_at')
      .eq('id', documentId)
      .maybeSingle(),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-pull-meta',
  );
  if (metaError) throw new Error(metaError.message);

  const metaRow = meta as CanvasRemoteDocumentRow | null;
  if (!metaRow) return { kind: 'unchanged' };

  const localDocument = normalizeDocument(options.localDocument);
  const remoteUpdatedAt = metaRow.updated_at || metaRow.deleted_at || '';
  if (metaRow.deleted_at) {
    if (!isValidTimestamp(remoteUpdatedAt)) {
      throw new Error('Invalid remote Canvas document deletion timestamp');
    }
    return {
      kind: 'deleted',
      conflict: {
        localDoc: localDocument,
        remoteDoc: null,
        remoteUpdatedAt,
        localUpdatedAt: localDocument.updatedAt || '',
        remoteDeleted: true,
      },
    };
  }

  if (remoteUpdatedAt && !isValidTimestamp(remoteUpdatedAt)) {
    throw new Error('Invalid remote Canvas document timestamp');
  }
  if (!isNewer(remoteUpdatedAt, localDocument.updatedAt)) {
    return { kind: 'unchanged', remoteUpdatedAt };
  }

  const { data, error } = await withTimeout(
    supabase
      .from('canvas_documents')
      .select('document, updated_at')
      .eq('id', documentId)
      .maybeSingle(),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-pull-doc',
  );
  if (error) throw new Error(error.message);

  const row = data as CanvasRemoteDocumentRow | null;
  if (!row) return { kind: 'unchanged', remoteUpdatedAt };

  const remote = remoteDocumentFromRow(row, documentId);
  if (!isNewer(remote.updatedAt, localDocument.updatedAt)) {
    return { kind: 'unchanged', remoteUpdatedAt: remote.updatedAt };
  }

  if (options.openDirty) {
    return {
      kind: 'conflict',
      conflict: {
        localDoc: localDocument,
        remoteDoc: remote.document,
        remoteUpdatedAt: remote.updatedAt,
        localUpdatedAt: localDocument.updatedAt || '',
      },
    };
  }

  const { assertDocumentImagesResolvable, persistDataUrlsAsCanvasAssets } = await import(
    '../utils/imageBlobStore'
  );
  await assertDocumentImagesResolvable(remote.document);
  const storedRemote = await persistDataUrlsAsCanvasAssets(remote.document);
  if (pendingCanvasDeletes().includes(documentId)) return { kind: 'unchanged' };
  const current = options.getOpenState?.();
  if (options.getOpenState && (!current || current.document.id !== documentId)) return { kind: 'unchanged' };
  if (current?.dirty) {
    return { kind: 'conflict', conflict: {
      localDoc: current.document, remoteDoc: remote.document,
      remoteUpdatedAt: remote.updatedAt, localUpdatedAt: current.document.updatedAt || '',
    } };
  }
  try {
    await api.canvasSave(storedRemote, {
      touch: false, slim: true, expectedUpdatedAt: localDocument.updatedAt || '',
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'category' in err && err.category === 'RESOURCE_LOCKED') {
      return { kind: 'unchanged' };
    }
    throw err;
  }
  return {
    kind: 'applied',
    document: storedRemote,
    remoteUpdatedAt: remote.updatedAt,
  };
}

export type SyncOptions = {
  openDocumentId?: string;
  openDocument?: CanvasDocument;
  openDirty?: boolean;
  getOpenState?: () => { document: CanvasDocument; dirty: boolean } | null;
  guarded?: boolean;
  followUp?: (result: SyncResult) => void;
};

let syncPromise: Promise<unknown> | null = null;
let pendingSyncOptions: SyncOptions | null = null;
const pendingSyncFollowUps: Array<(result: SyncResult) => void> = [];
let opChain: Promise<unknown> = Promise.resolve();

const pendingPushById = new Map<
  string,
  { id: string; doc?: CanvasDocument; options?: { forceResurrect?: boolean } }
>();
let pushFlushQueued = false;
let pushFlushPromise: Promise<void> | null = null;

function hydratePendingCanvasPushes(): void {
  const deletedIds = new Set(pendingCanvasDeletes());
  for (const pending of pendingCanvasPushes()) {
    if (deletedIds.has(pending.id)) {
      pendingPushById.delete(pending.id);
      clearPendingCanvasPush(pending.id);
    } else if (!pendingPushById.has(pending.id)) {
      pendingPushById.set(pending.id, pending);
    }
  }
}

function mergeSyncOptions(a: SyncOptions | null, b: SyncOptions): SyncOptions {
  return {
    openDocumentId: b.openDocumentId ?? a?.openDocumentId,
    openDocument: b.openDocument,
    openDirty: Boolean(a?.openDirty || b.openDirty),
    getOpenState: b.getOpenState ?? a?.getOpenState,
    guarded: Boolean(a?.guarded || b.guarded),
  };
}

async function resolveConflictLocalDoc(options: SyncOptions): Promise<CanvasDocument | null> {
  if (
    options.openDocument &&
    (!options.openDocumentId || options.openDocument.id === options.openDocumentId)
  ) {
    return normalizeDocument(options.openDocument);
  }
  if (!options.openDocumentId) return null;
  const localGot = await api.canvasGet(options.openDocumentId);
  return normalizeDocument(localGot.document as CanvasDocument);
}

export async function syncCanvasDocuments(options: SyncOptions = {}): Promise<SyncResult> {
  const empty: SyncResult = { pulled: 0, pushed: 0, deletedLocal: 0, skipped: false, pushErrors: 0 };
  const supabase = await getSupabaseClient();
  if (!supabase) return { ...empty, skipped: true, reason: 'no-supabase' };
  if (syncPromise) {
    pendingSyncOptions = mergeSyncOptions(pendingSyncOptions, options);
    if (options.followUp) pendingSyncFollowUps.push(options.followUp);
    return { ...empty, skipped: true, reason: 'sync-in-flight' };
  }
  let releaseSync!: () => void;
  syncPromise = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  const run = (async (): Promise<SyncResult> => {
    try {
      const uid = await sessionUserId();
      if (!uid) return { ...empty, skipped: true, reason: 'no-session' };
      return await runSync(options);
    } catch (err) {
      const lastError = errorMessage(err, String(err));
      reportFrontendError({
        kind: 'sync_error',
        view: 'canvas.sync',
        name: err instanceof Error ? err.name : undefined,
        message: lastError,
      });
      return { ...empty, skipped: true, reason: 'error', lastError };
    } finally {
      releaseSync();
      syncPromise = null;
      const next = pendingSyncOptions;
      const followUps = pendingSyncFollowUps.splice(0);
      pendingSyncOptions = null;
      if (next) {
        const retry = syncCanvasDocuments(next);
        void retry
          .then((retryResult) => {
            for (const cb of followUps) cb?.(retryResult);
          })
          .catch(() => {
            for (const cb of followUps) cb?.({ ...empty, skipped: true, reason: 'error' });
          });
      }
    }
  })();
  opChain = run.catch(() => {
  });
  return run;
}

async function runSync(options: SyncOptions): Promise<SyncResult> {
  const empty: SyncResult = { pulled: 0, pushed: 0, deletedLocal: 0, skipped: false, pushErrors: 0 };
  const deletingIds = new Set(pendingCanvasDeletes());
  await replayPendingCanvasDeletes();
  const [remote, localRes] = await Promise.all([
    listRemoteCanvasMeta(),
    api.canvasList(),
  ]);
  if (!remote) return { ...empty, skipped: true, reason: 'no-session' };

  const localList = localRes.documents as LocalSummary[];
  const localById = new Map(localList.map((d) => [d.id, d]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));

  let pulled = 0;
  let pushed = 0;
  let deletedLocal = 0;
  let pushErrors = 0;
  let pullErrors = 0;
  let lastError: string | undefined;
  let reloadOpenId: string | undefined;
  let conflict: SyncConflict | undefined;

  const toPullIds: string[] = [];
  let conflictRemoteMeta: CanvasRemoteMeta | undefined;
  let conflictRemoteDeletedMeta: CanvasRemoteMeta | undefined;
  for (const r of remote) {
    if (deletingIds.has(r.id) || pendingCanvasDeletes().includes(r.id)) continue;
    if (r.deleted_at) {
      const localDeleted = localById.get(r.id);
      if (!localDeleted) continue;
      if (!isNewer(r.deleted_at || r.updated_at, localDeleted.updatedAt || '')) {
        continue;
      }
      if (options.openDocumentId === r.id) {
        conflictRemoteDeletedMeta = r;
        continue;
      }
      if (options.guarded) {
        continue;
      }
      await api.canvasDelete(r.id);
      deletedLocal += 1;
      localById.delete(r.id);
      continue;
    }
    const local = localById.get(r.id);
    const localTime = local?.updatedAt || '';
    const remoteNewer = localTime ? isNewer(r.updated_at, localTime) : false;
    if (!local) {
      toPullIds.push(r.id);
    } else if (remoteNewer) {
      if (options.openDocumentId === r.id && options.openDirty) {
        conflictRemoteMeta = r;
        continue;
      }
      if (options.guarded) {
        continue;
      }
      toPullIds.push(r.id);
    }
  }

  if (toPullIds.length > 0) {
    const { persistDataUrlsAsCanvasAssets } = await import('../utils/imageBlobStore');
    for (let offset = 0; offset < toPullIds.length; offset += PULL_SYNC_CONCURRENCY) {
      const ids = toPullIds.slice(offset, offset + PULL_SYNC_CONCURRENCY);
      let docs: CanvasDocument[];
      try {
        docs = await fetchRemoteDocuments(ids);
      } catch (err) {
        pullErrors += ids.length;
        lastError = errorMessage(err, String(err));
        continue;
      }
      const settled = await Promise.allSettled(docs.map(async (remoteDoc) => {
        const doc = await persistDataUrlsAsCanvasAssets(remoteDoc);
        if (deletingIds.has(doc.id) || pendingCanvasDeletes().includes(doc.id)) return;
        const current = options.getOpenState?.();
        if (current?.document.id === doc.id && current.dirty) {
          conflict = {
            localDoc: current.document, remoteDoc: doc,
            remoteUpdatedAt: doc.updatedAt || '', localUpdatedAt: current.document.updatedAt || '',
          };
          return;
        }
        try {
          await api.canvasSave(doc, {
            touch: false, slim: true, expectedUpdatedAt: localById.get(doc.id)?.updatedAt || '',
          });
        } catch (err) {
          if (err && typeof err === 'object' && 'category' in err && err.category === 'RESOURCE_LOCKED') return;
          throw err;
        }
        pulled += 1;
        if (options.openDocumentId === doc.id && !options.openDirty) {
          reloadOpenId = doc.id;
        }
      }));
      for (const result of settled) {
        if (result.status === 'rejected') {
          pullErrors += 1;
          lastError = errorMessage(result.reason, String(result.reason));
        }
      }
    }
  }

  if (conflictRemoteDeletedMeta && options.openDocumentId) {
    try {
      const localDoc = await resolveConflictLocalDoc(options);
      if (localDoc) {
        conflict = {
          localDoc,
          remoteDoc: null,
          remoteUpdatedAt: conflictRemoteDeletedMeta.updated_at,
          localUpdatedAt: localDoc.updatedAt || '',
          remoteDeleted: true,
        };
      }
    } catch (err) {
      reportFrontendError({
        kind: 'sync_error',
        view: 'canvas.sync',
        name: err instanceof Error ? err.name : undefined,
        message: errorMessage(err, String(err)),
      });
      reportFrontendEvent({
        event: 'canvas.cloud_sync',
        level: 'WARN',
        outcome: 'degraded',
        reason: 'conflict_resolution_failed',
      });
    }
  } else if (conflictRemoteMeta && options.openDocumentId) {
    try {
      const [remoteDocs, localDoc] = await Promise.all([
        fetchRemoteDocuments([conflictRemoteMeta.id]),
        resolveConflictLocalDoc(options),
      ]);
      const remoteDoc = remoteDocs[0];
      if (remoteDoc && localDoc) {
        conflict = {
          localDoc,
          remoteDoc,
          remoteUpdatedAt: conflictRemoteMeta.updated_at,
          localUpdatedAt: localDoc.updatedAt || '',
        };
      }
    } catch (err) {
      reportFrontendError({
        kind: 'sync_error',
        view: 'canvas.sync',
        name: err instanceof Error ? err.name : undefined,
        message: errorMessage(err, String(err)),
      });
      reportFrontendEvent({
        event: 'canvas.cloud_sync',
        level: 'WARN',
        outcome: 'degraded',
        reason: 'conflict_resolution_failed',
      });
    }
  }

  const pushCandidates: LocalSummary[] = [];
  for (const local of localById.values()) {
    if (deletingIds.has(local.id) || pendingCanvasDeletes().includes(local.id)) continue;
    const r = remoteById.get(local.id);
    if (r?.deleted_at) continue;
    const localTime = local.updatedAt || '';
    const localIsNewer = !localTime ? Boolean(r) : isNewer(localTime, r?.updated_at);
    if (r && !localIsNewer) continue;
    pushCandidates.push(local);
  }

  const PUSH_SYNC_CONCURRENCY = 4;
  for (let i = 0; i < pushCandidates.length; i += PUSH_SYNC_CONCURRENCY) {
    const settled = await Promise.allSettled(
      pushCandidates.slice(i, i + PUSH_SYNC_CONCURRENCY).map(async (local) => {
        const got = await api.canvasGet(local.id);
        const result = await pushCanvasDocumentResult(normalizeDocument(got.document as CanvasDocument));
        if (result.accepted) await publishAcceptedPush(result);
        return result;
      }),
    );
    for (const s of settled) {
      if (s.status === 'rejected') {
        pushErrors += 1;
        lastError = errorMessage(s.reason, String(s.reason));
      } else if (s.value.accepted) {
        pushed += 1;
      } else {
        pushErrors += 1;
        lastError = 'El servidor conservó una versión más reciente del documento';
      }
    }
  }

  if (pushErrors > 0) {
    reportFrontendEvent({
      event: 'canvas.push',
      level: 'WARN',
      outcome: 'partial',
      reason: 'push_failed',
      count: pushErrors,
    });
    reportFrontendError({
      kind: 'sync_error',
      view: 'canvas.push',
      message: lastError ?? 'Cloud push failed',
    });
  }

  if (pullErrors > 0) {
    reportFrontendError({ kind: 'sync_error', view: 'canvas.pull', message: lastError ?? 'Cloud pull failed' });
  }
  return { pulled, pushed, deletedLocal, reloadOpenId, skipped: false, pushErrors, pullErrors, lastError, conflict };
}

async function publishAcceptedPush(result: CanvasPushResult): Promise<void> {
  if (!result.accepted || !result.updatedBy) return;
  await broadcastCanvasDocumentSaved({
    type: 'document_saved',
    documentId: result.documentId,
    updatedAt: result.updatedAt,
    updatedBy: result.updatedBy,
  }).catch(() => {
    reportFrontendEvent({
      event: 'canvas.push',
      level: 'WARN',
      outcome: 'degraded',
      reason: 'broadcast_failed',
    });
  });
}

const PUSH_RETRY_BASE_MS = 5_000;
const PUSH_RETRY_MAX_DELAY_MS = 120_000;
const pushRetry = new TimerScheduler(() => {
  if (pendingPushById.size === 0 && pendingCanvasDeletes().length === 0) return;
  void flushPendingPushes().catch(() => {});
});

function schedulePendingPushRetry(): void {
  if (pushRetry.pending) return;
  const delay = Math.min(PUSH_RETRY_BASE_MS * 2 ** pushRetry.attempts, PUSH_RETRY_MAX_DELAY_MS);
  pushRetry.attempts += 1;
  pushRetry.schedule(delay);
}

function flushPendingPushes(): Promise<void> {
  if (pushFlushQueued) {
    return (pushFlushPromise ?? Promise.resolve()).then(() => undefined);
  }
  pushFlushQueued = true;
  const flush = opChain.then(async () => {
    pushFlushQueued = false;
    try {
      hydratePendingCanvasPushes();
      await replayPendingCanvasDeletes();
    } catch (err) {
      schedulePendingPushRetry();
      notifyPushHealth(true);
      throw err;
    }
    const batch = Array.from(pendingPushById.values());
    pendingPushById.clear();
    let firstError: unknown = null;
    for (const item of batch) {
      if (pendingCanvasDeletes().includes(item.id)) continue;
      try {
        const doc = item.doc ?? normalizeDocument((await api.canvasGet(item.id)).document as CanvasDocument);
        const result = await pushCanvasDocumentResult(doc, item.options);
        if (!result.accepted) {
          firstError ??= new Error('El servidor conservó una versión más reciente del documento');
        } else {
          await publishAcceptedPush(result);
        }
        if (!pendingPushById.has(item.id)) clearPendingCanvasPush(item.id);
      } catch (err) {
        firstError ??= err;
        if (!pendingPushById.has(item.id)) {
          pendingPushById.set(item.id, { id: item.id, options: item.options });
          recordPendingCanvasPush({ id: item.id, options: item.options });
        }
      }
    }
    if (firstError) {
      if (pendingPushById.size > 0) schedulePendingPushRetry();
      notifyPushHealth(true);
      reportFrontendError({
        kind: 'sync_error',
        view: 'canvas.push',
        name: firstError instanceof Error ? firstError.name : undefined,
        message: firstError instanceof Error ? firstError.message : String(firstError),
      });
      throw firstError;
    }
    const hasPendingDeletes = pendingCanvasDeletes().length > 0;
    if (hasPendingDeletes) schedulePendingPushRetry();
    else pushRetry.reset();
    notifyPushHealth(hasPendingDeletes);
  });
  pushFlushPromise = flush;
  opChain = flush.catch(() => {});
  return flush.then(() => undefined);
}

export function queueCanvasCloudPush(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<void> {
  pendingPushById.set(doc.id, { id: doc.id, doc, options });
  recordPendingCanvasPush({ id: doc.id, options });
  return flushPendingPushes();
}

export function _resetCanvasPushQueueForTests(): void {
  pendingPushById.clear();
  pushRetry.cancel();
  for (const pending of pendingCanvasPushes()) clearPendingCanvasPush(pending.id);
}

export function queueCanvasCloudDelete(id: string): Promise<void> {
  recordPendingCanvasDelete(id);
  const next = opChain.then(async () => {
    pendingPushById.delete(id);
    clearPendingCanvasPush(id);
    if (pendingPushById.size === 0) {
      pushRetry.cancel();
      notifyPushHealth(false);
    }
    try {
      await replayPendingCanvasDeletes();
      if (pendingCanvasDeletes().length > 0) schedulePendingPushRetry();
      notifyPushHealth(pendingCanvasDeletes().length > 0);
    } catch (err) {
      schedulePendingPushRetry();
      notifyPushHealth(true);
      reportFrontendError({
        kind: 'sync_error',
        view: 'canvas.delete',
        name: err instanceof Error ? err.name : undefined,
        message: errorMessage(err, String(err)),
      });
      throw err;
    }
  });
  opChain = next.catch(() => {});
  return next.then(() => undefined);
}

export type CanvasVersionEntry = {
  id: string;
  document_id: string;
  document?: CanvasDocument;
  created_by: string | null;
  created_at: string;
};

export async function listCanvasVersions(documentId: string): Promise<CanvasVersionEntry[]> {
  const supabase = await getSupabaseClient();
  if (!supabase) return [];
  const uid = await sessionUserId();
  if (!uid) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('canvas_document_versions')
      .select('id, document_id, created_by, created_at')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(50),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-list-versions',
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as CanvasVersionEntry[];
}

export async function restoreCanvasVersion(
  documentId: string,
  versionId: string,
): Promise<CanvasDocument | null> {
  const supabase = await getSupabaseClient();
  if (!supabase) return null;
  const uid = await sessionUserId();
  if (!uid) return null;

  const { data, error } = await withTimeout(
    supabase
      .from('canvas_document_versions')
      .select('document')
      .eq('id', versionId)
      .eq('document_id', documentId)
      .single(),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-fetch-version',
  );
  if (error || !data?.document) return null;

  const { serializeDocumentImages, persistDataUrlsAsCanvasAssets } = await import(
    '../utils/imageBlobStore'
  );
  const restoredDoc = normalizeDocument({
    ...(data.document as CanvasDocument),
    updatedAt: new Date().toISOString(),
  });
  const serialized = await persistDataUrlsAsCanvasAssets(
    await serializeDocumentImages(restoredDoc),
  );

  await api.canvasSave(serialized, { touch: true, slim: true });
  await queueCanvasCloudPush(serialized, { forceResurrect: true });

  return serialized;
}

