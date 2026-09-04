import { api } from '../../../api';
import { supabase } from '../../../lib/supabase';
import type { CanvasDocument } from '../types';
import { normalizeDocument } from '../types';
import {
  isNewer,
  shouldPushCanvasRow,
  type CanvasRemoteMeta,
  type SyncConflict,
  type SyncResult,
} from './syncCompare';
import { broadcastCanvasDocumentSaved } from './canvasRealtime';

export type { CanvasRemoteMeta, SyncConflict, SyncResult };
export { isNewer, shouldPushCanvasRow };

type LocalSummary = { id: string; name: string; updatedAt?: string };

export const CLOUD_SYNC_TIMEOUT_MS = 30_000;

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const msg = `${label} timed out after ${ms}ms`;
  const wrapped = Promise.resolve(promise).then(
    (value) => {
      if (timedOut) throw new Error(msg);
      return value;
    },
    (err) => {
      if (timedOut) throw new Error(msg);
      throw err;
    },
  );
  wrapped.catch(() => {});
  try {
    return await Promise.race([
      wrapped,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(msg));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function sessionUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await withTimeout(
    supabase.auth.getSession(),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-auth-session',
  );
  return data.session?.user?.id ?? null;
}

export async function listRemoteCanvasMeta(): Promise<CanvasRemoteMeta[] | null> {
  if (!supabase) return null;
  const uid = await sessionUserId();
  if (!uid) return null;
  const { data, error } = await withTimeout(
    supabase.from('canvas_documents').select('id, name, updated_at, deleted_at'),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-list-remote',
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as CanvasRemoteMeta[];
}

export type CanvasPushResult = {
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
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /PGRST202|RPC function not found|function .* does not exist/i.test(message);
}

export async function pushCanvasDocumentResult(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<CanvasPushResult> {
  if (!supabase) return pushResult(doc, false, doc.updatedAt || '');
  const uid = await sessionUserId();
  if (!uid) return pushResult(doc, false, doc.updatedAt || '');

  const { embedCanvasAssetsAsDataUrls, countCanvasAssetRefs } = await import('../utils/imageBlobStore');
  doc = await embedCanvasAssetsAsDataUrls(doc, { strict: true });
  if (countCanvasAssetRefs(doc) > 0) {
    throw new Error('No se puede sincronizar: quedan imágenes canvas-asset: sin resolver');
  }

  const updatedAt = doc.updatedAt || new Date().toISOString();

  if (typeof supabase.rpc === 'function' && !options?.forceResurrect) {
    try {
      const rpcRes = (await withTimeout(
        (supabase.rpc as unknown as (n: string, p: unknown) => PromiseLike<{ data: boolean | null; error: { message: string } | null }>)(
          'canvas_push_document_lww',
          { p_document: doc, p_updated_at: updatedAt },
        ),
        CLOUD_SYNC_TIMEOUT_MS,
        'canvas-push-rpc',
      )) as { data: boolean | null; error: { message: string } | null } | null;
      if (rpcRes?.error) {
        if (!isMissingRpcError(rpcRes.error)) throw new Error(rpcRes.error.message);
      } else if (rpcRes && typeof rpcRes.data === 'boolean') {
        return pushResult(doc, rpcRes.data, updatedAt, uid);
      } else if (rpcRes) {
        throw new Error('Respuesta inválida de canvas_push_document_lww');
      }
    } catch (err) {
      if (!isMissingRpcError(err)) throw err;
      console.warn('[canvas-sync] canvas_push_document_lww no está disponible; usando compatibilidad legacy');
    }
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
  if (
    existing &&
    !options?.forceResurrect &&
    !shouldPushCanvasRow(updatedAt, existing.updated_at, existing.deleted_at)
  ) {
    try {
      await withTimeout(
        (supabase.rpc as unknown as (n: string, p: unknown) => PromiseLike<unknown>)(
          'canvas_append_document_version',
          { p_document_id: doc.id, p_document: doc },
        ),
        CLOUD_SYNC_TIMEOUT_MS,
        'canvas-push-skip-preserve',
      );
    } catch (err) {
      if (!isMissingRpcError(err)) throw err;
      try {
        await withTimeout(
          supabase.from('canvas_document_versions').insert({
            document_id: doc.id,
            document: doc,
            created_by: uid,
            created_at: updatedAt,
          }),
          CLOUD_SYNC_TIMEOUT_MS,
          'canvas-push-skip-preserve-fallback',
        );
      } catch {}
    }
    return pushResult(doc, false, updatedAt, uid);
  }

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

  const { error } = await withTimeout(
    supabase.from('canvas_documents').upsert(row, { onConflict: 'id' }),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-push-upsert',
  );
  if (error) throw new Error(error.message);
  return pushResult(doc, true, updatedAt, uid);
}

export async function pushCanvasDocument(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<boolean> {
  return (await pushCanvasDocumentResult(doc, options)).accepted;
}

export async function markRemoteCanvasDeleted(id: string): Promise<boolean> {
  if (!supabase) return false;
  const uid = await sessionUserId();
  if (!uid) return false;
  const now = new Date().toISOString();
  const { error } = await withTimeout(
    supabase
      .from('canvas_documents')
      .update({ deleted_at: now, updated_at: now, updated_by: uid })
      .eq('id', id),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-mark-deleted',
  );
  if (error) throw new Error(error.message);
  return true;
}

async function fetchRemoteDocuments(ids: string[]): Promise<CanvasDocument[]> {
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
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid remote Canvas document snapshot: ${msg}`);
  }
}

export type TargetedCanvasPullResult =
  | { kind: 'unchanged'; remoteUpdatedAt?: string }
  | { kind: 'applied'; document: CanvasDocument; remoteUpdatedAt: string }
  | { kind: 'conflict'; conflict: SyncConflict }
  | { kind: 'deleted'; conflict: SyncConflict };

export async function pullCanvasDocument(
  documentId: string,
  options: { localDocument: CanvasDocument; openDirty: boolean },
): Promise<TargetedCanvasPullResult> {
  if (!supabase) return { kind: 'unchanged' };
  const uid = await sessionUserId();
  if (!uid) return { kind: 'unchanged' };

  const { data, error } = await withTimeout(
    supabase
      .from('canvas_documents')
      .select('document, updated_at, deleted_at')
      .eq('id', documentId)
      .maybeSingle(),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-pull-targeted',
  );
  if (error) throw new Error(error.message);

  const row = data as CanvasRemoteDocumentRow | null;
  if (!row) return { kind: 'unchanged' };

  const localDocument = normalizeDocument(options.localDocument);
  const remoteUpdatedAt = row.updated_at || row.deleted_at || '';
  if (row.deleted_at) {
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

  const { assertDocumentImagesResolvable } = await import('../utils/imageBlobStore');
  await assertDocumentImagesResolvable(remote.document);
  await api.canvasSave(remote.document, { touch: false });
  return {
    kind: 'applied',
    document: remote.document,
    remoteUpdatedAt: remote.updatedAt,
  };
}

export type SyncOptions = {
  openDocumentId?: string;
  openDocument?: CanvasDocument;
  openDirty?: boolean;
  guarded?: boolean;
  followUp?: (result: SyncResult) => void;
};

let syncPromise: Promise<unknown> | null = null;
let pendingSyncOptions: SyncOptions | null = null;
const pendingSyncFollowUps: Array<(result: SyncResult) => void> = [];
let opChain: Promise<unknown> = Promise.resolve();

const pendingPushById = new Map<
  string,
  { doc: CanvasDocument; options?: { forceResurrect?: boolean } }
>();
let pushFlushQueued = false;

function mergeSyncOptions(a: SyncOptions | null, b: SyncOptions): SyncOptions {
  return {
    openDocumentId: b.openDocumentId ?? a?.openDocumentId,
    openDocument: b.openDocument ?? a?.openDocument,
    openDirty: Boolean(a?.openDirty || b.openDirty),
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
      const lastError = err instanceof Error ? err.message : String(err);
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
  let lastError: string | undefined;
  let reloadOpenId: string | undefined;
  let conflict: SyncConflict | undefined;

  const toPullIds: string[] = [];
  let conflictRemoteMeta: CanvasRemoteMeta | undefined;
  let conflictRemoteDeletedMeta: CanvasRemoteMeta | undefined;
  for (const r of remote) {
    if (r.deleted_at) {
      if (localById.has(r.id)) {
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
      }
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
    const docs = await fetchRemoteDocuments(toPullIds);
    await Promise.all(docs.map((doc) => api.canvasSave(doc, { touch: false })));
    pulled = docs.length;
    for (const doc of docs) {
      if (options.openDocumentId === doc.id && !options.openDirty) {
        reloadOpenId = doc.id;
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
    } catch {
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
    } catch {
    }
  }

  for (const local of localById.values()) {
    const r = remoteById.get(local.id);
    if (r?.deleted_at) continue;
    const localTime = local.updatedAt || '';
    const localIsNewer = !localTime ? Boolean(r) : isNewer(localTime, r?.updated_at);
    if (r && !localIsNewer) continue;
    try {
      const got = await api.canvasGet(local.id);
      const result = await pushCanvasDocumentResult(normalizeDocument(got.document as CanvasDocument));
      if (result.accepted) {
        pushed += 1;
        await publishAcceptedPush(result);
      }
    } catch (err) {
      pushErrors += 1;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { pulled, pushed, deletedLocal, reloadOpenId, skipped: false, pushErrors, lastError, conflict };
}

async function publishAcceptedPush(result: CanvasPushResult): Promise<void> {
  if (!result.accepted || !result.updatedBy) return;
  await broadcastCanvasDocumentSaved({
    type: 'document_saved',
    documentId: result.documentId,
    updatedAt: result.updatedAt,
    updatedBy: result.updatedBy,
  }).catch(() => undefined);
}

export function queueCanvasCloudPush(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<void> {
  pendingPushById.set(doc.id, { doc, options });
  if (!pushFlushQueued) {
    pushFlushQueued = true;
    const flush = opChain.then(async () => {
      pushFlushQueued = false;
      const batch = Array.from(pendingPushById.values());
      pendingPushById.clear();
      for (const item of batch) {
        const result = await pushCanvasDocumentResult(item.doc, item.options);
        await publishAcceptedPush(result);
      }
    });
    opChain = flush.catch(() => {});
  }
  return opChain.then(() => undefined).catch(() => undefined);
}

export function queueCanvasCloudDelete(id: string): Promise<void> {
  const next = opChain.then(() => markRemoteCanvasDeleted(id));
  opChain = next.catch(() => {});
  return next.then(() => undefined).catch(() => undefined);
}

export type CanvasVersionEntry = {
  id: string;
  document_id: string;
  document?: CanvasDocument;
  created_by: string | null;
  created_at: string;
};

export async function listCanvasVersions(documentId: string): Promise<CanvasVersionEntry[]> {
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

  const { serializeDocumentImages } = await import('../utils/imageBlobStore');
  const restoredDoc = normalizeDocument({
    ...(data.document as CanvasDocument),
    updatedAt: new Date().toISOString(),
  });
  const serialized = await serializeDocumentImages(restoredDoc);

  await api.canvasSave(serialized, { touch: true });
  await queueCanvasCloudPush(serialized, { forceResurrect: true });

  return serialized;
}

