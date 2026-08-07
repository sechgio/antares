/**
 * Pure Canvas sync helpers / types — no Supabase import.
 * Keeps the Canvas chunk free of vendor-supabase on first paint.
 */
import type { CanvasDocument } from '../types';

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
