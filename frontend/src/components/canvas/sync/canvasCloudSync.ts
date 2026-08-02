/**
 * Local-first Canvas cloud sync (Supabase).
 *
 * UX: disk is always the editor source of truth (instant, offline).
 * Cloud sync runs in the background: metadata-only listing, full docs
 * fetched only when remote is newer; LWW by updatedAt.
 */
import { api } from '../../../api';
import { supabase } from '../../../lib/supabase';
import type { CanvasDocument } from '../types';
import { normalizeDocument } from '../types';

export type CanvasRemoteMeta = {
  id: string;
  name: string;
  updated_at: string;
  deleted_at: string | null;
};

/** Conflict detected: remote is newer but the open doc has unsaved local edits. */
export type SyncConflict = {
  localDoc: CanvasDocument;
  /** null when the remote row is soft-deleted */
  remoteDoc: CanvasDocument | null;
  remoteUpdatedAt: string;
  localUpdatedAt: string;
  remoteDeleted?: boolean;
};

export type SyncResult = {
  pulled: number;
  pushed: number;
  deletedLocal: number;
  /** Open document was updated from cloud and should be reloaded. */
  reloadOpenId?: string;
  skipped: boolean;
  reason?: string;
  /** Number of docs that failed to push (transient or persistent). */
  pushErrors: number;
  /** Last push error message, if any. */
  lastError?: string;
  /** Conflict on the currently open document (dirty local vs newer remote). */
  conflict?: SyncConflict;
};

type LocalSummary = { id: string; name: string; updatedAt?: string };

/** Bound every Supabase round-trip so a hung HTTPS never sticks the sync mutex. */
export const CLOUD_SYNC_TIMEOUT_MS = 30_000;

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function isNewer(a?: string, b?: string): boolean {
  if (!a) return false;
  if (!b) return true;
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left)) return false;
  if (Number.isNaN(right)) return true;
  return left > right;
}

/** Whether a local push should overwrite the remote row (client-side LWW guard). */
export function shouldPushCanvasRow(
  localUpdatedAt: string | undefined,
  remoteUpdatedAt: string | null | undefined,
  remoteDeletedAt: string | null | undefined,
): boolean {
  if (remoteDeletedAt) return false;
  if (!remoteUpdatedAt) return true;
  if (!localUpdatedAt) return false;
  return !isNewer(remoteUpdatedAt, localUpdatedAt);
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

export async function pushCanvasDocument(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<boolean> {
  if (!supabase) return false;
  const uid = await sessionUserId();
  if (!uid) return false;

  const updatedAt = doc.updatedAt || new Date().toISOString();

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
        supabase.from('canvas_document_versions').insert({
          document_id: doc.id,
          document: doc,
          created_by: uid,
          created_at: updatedAt,
        }),
        CLOUD_SYNC_TIMEOUT_MS,
        'canvas-push-skip-preserve',
      );
    } catch {
      // Ignore preserve errors so main skip flow completes cleanly
    }
    return false;
  }

  // Preserve the original creator on update: upsert overwrites every column,
  // so without this a second user's push would steal created_by.
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

  // Atomic upsert on PK — avoids the select-then-insert/update race where two
  // concurrent pushes could both see "no existing row" and duplicate.
  const { error } = await withTimeout(
    supabase.from('canvas_documents').upsert(row, { onConflict: 'id' }),
    CLOUD_SYNC_TIMEOUT_MS,
    'canvas-push-upsert',
  );
  if (error) throw new Error(error.message);
  return true;
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
    const raw = row.document as CanvasDocument | null;
    if (!raw || typeof raw !== 'object') continue;
    const doc = normalizeDocument({
      ...raw,
      updatedAt: raw.updatedAt || row.updated_at,
    });
    out.push(doc);
  }
  return out;
}

export type SyncOptions = {
  openDocumentId?: string;
  /** When true, never overwrite the open document from cloud. */
  openDirty?: boolean;
  /**
   * Guarded (first-boot) sync: never destroy or overwrite a document that
   * already exists locally. Local-first principle — the on-disk JSON is the
   * source of truth and must never be silently clobbered just because a
   * background startup sync saw a divergent/stale remote row. In guarded mode
   * the sync only: pushes local docs up (so they survive), pulls remote docs
   * that have no local counterpart, and surfaces any divergence on an existing
   * local doc as a conflict for the user to resolve — it never calls
   * canvasDelete on a present local doc nor overwrites it with a remote.
   */
  guarded?: boolean;
  /**
   * Called with the coalesced retry's SyncResult when this call was skipped
   * because another sync was in flight. Not invoked for the in-flight caller.
   */
  followUp?: (result: SyncResult) => void;
};

// Module-level mutex: focus events and GeneratePanel can both fire sync in
// overlapping windows; reentrancy here would let a late pull overwrite a
// doc that was just locally edited and pushed. Declared before use so the
// queued-push waiter never hits a TDZ violation.
let syncPromise: Promise<unknown> | null = null;
/** Coalesced options for one retry after the in-flight sync unlocks. */
let pendingSyncOptions: SyncOptions | null = null;
/** Side-effects callback from the skipped caller (refreshList / conflict / reload). */
let pendingSyncFollowUp: ((result: SyncResult) => void) | null = null;
/** Chain of in-flight sync/push/delete ops — pushes never overtake a coalesced retry. */
let opChain: Promise<unknown> = Promise.resolve();

function mergeSyncOptions(a: SyncOptions | null, b: SyncOptions): SyncOptions {
  return {
    openDocumentId: b.openDocumentId ?? a?.openDocumentId,
    // Prefer dirty=true so a later dirty caller is not overwritten by a clean retry.
    openDirty: Boolean(a?.openDirty || b.openDirty),
    // Prefer guarded=true so a first-boot sync is not repeated as an unguarded one.
    guarded: Boolean(a?.guarded || b.guarded),
  };
}

/**
 * Merge cloud ↔ local without blocking the editor.
 * Pulls only docs where remote is newer; pushes local-only / newer locals.
 */
export async function syncCanvasDocuments(options: SyncOptions = {}): Promise<SyncResult> {
  const empty: SyncResult = { pulled: 0, pushed: 0, deletedLocal: 0, skipped: false, pushErrors: 0 };
  if (!supabase) return { ...empty, skipped: true, reason: 'no-supabase' };
  if (syncPromise) {
    pendingSyncOptions = mergeSyncOptions(pendingSyncOptions, options);
    if (options.followUp) pendingSyncFollowUp = options.followUp;
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
      const followUp = pendingSyncFollowUp;
      pendingSyncOptions = null;
      pendingSyncFollowUp = null;
      if (next) {
        // Retry starts here so opChain (updated by this call) includes it before
        // any queued push's microtask runs.
        const retry = syncCanvasDocuments(next);
        void retry
          .then((retryResult) => {
            followUp?.(retryResult);
          })
          .catch(() => {
            followUp?.({ ...empty, skipped: true, reason: 'error' });
          });
      }
    }
  })();
  opChain = run.catch(() => {
    // Sync errors are returned as SyncResult; keep opChain from rejecting forever.
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
          // Soft-delete of the currently open doc is always a conflict —
          // never auto-delete the document the user is viewing (dirty or clean).
          conflictRemoteDeletedMeta = r;
          continue;
        }
        if (options.guarded) {
          // First boot: never destroy a non-open local doc just because the
          // remote row was soft-deleted elsewhere; keep the local doc intact.
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
      // Unchanged unguarded behavior: a dirty open doc conflicts; a clean one
      // (or a non-open doc) is pulled so the remote wins by LWW.
      if (options.openDocumentId === r.id && options.openDirty) {
        conflictRemoteMeta = r;
        continue;
      }
      if (options.guarded) {
        // First boot: the local doc already exists and is the source of truth.
        // Do not overwrite it with a divergent remote; a later unguarded sync
        // (or an explicit conflict resolution) can reconcile it.
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

  // Build the conflict payload if the open doc diverged from cloud.
  if (conflictRemoteDeletedMeta && options.openDocumentId) {
    try {
      const localGot = await api.canvasGet(options.openDocumentId);
      const localDoc = normalizeDocument(localGot.document as CanvasDocument);
      conflict = {
        localDoc,
        remoteDoc: null,
        remoteUpdatedAt: conflictRemoteDeletedMeta.updated_at,
        localUpdatedAt: localDoc.updatedAt || '',
        remoteDeleted: true,
      };
    } catch {
      // Fetch failed — degrade to the old skip behavior.
    }
  } else if (conflictRemoteMeta && options.openDocumentId) {
    try {
      const [remoteDocs, localGot] = await Promise.all([
        fetchRemoteDocuments([conflictRemoteMeta.id]),
        api.canvasGet(options.openDocumentId),
      ]);
      const remoteDoc = remoteDocs[0];
      const localDoc = normalizeDocument(localGot.document as CanvasDocument);
      if (remoteDoc) {
        conflict = {
          localDoc,
          remoteDoc,
          remoteUpdatedAt: conflictRemoteMeta.updated_at,
          localUpdatedAt: localDoc.updatedAt || '',
        };
      }
    } catch {
      // Fetch failed — degrade to the old skip behavior.
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
      const ok = await pushCanvasDocument(normalizeDocument(got.document as CanvasDocument));
      if (ok) pushed += 1;
    } catch (err) {
      // Offline / RLS — leave local; next sync retries.
      pushErrors += 1;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { pulled, pushed, deletedLocal, reloadOpenId, skipped: false, pushErrors, lastError, conflict };
}

/** Fire-and-forget push after a successful local save.
 *  Serialized behind opChain so pushes never overtake a sync's LWW guard
 *  or a coalesced retry. Resolves when this push finishes (errors swallowed —
 *  local is already saved). */
export function queueCanvasCloudPush(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<void> {
  const next = opChain.then(() => pushCanvasDocument(doc, options));
  // Keep the chain alive after a failed push so later ops are not stuck.
  opChain = next.catch(() => {});
  return next.then(() => undefined).catch(() => undefined);
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

