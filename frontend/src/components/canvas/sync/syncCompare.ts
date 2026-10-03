import type { CanvasDocument } from '../types';

export type CanvasRemoteMeta = {
  id: string;
  name: string;
  updated_at: string;
  deleted_at: string | null;
};

export type SyncConflict = {
  localDoc: CanvasDocument;
  remoteDoc: CanvasDocument | null;
  remoteUpdatedAt: string;
  localUpdatedAt: string;
  remoteDeleted?: boolean;
};

export type SyncResult = {
  pulled: number;
  pushed: number;
  deletedLocal: number;
  reloadOpenId?: string;
  skipped: boolean;
  reason?: string;
  pushErrors: number;
  lastError?: string;
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
