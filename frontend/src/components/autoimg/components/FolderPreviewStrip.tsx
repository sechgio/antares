import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { api } from '../../../api';
import type { DriveFolderThumb } from '../types';

const SLOT_COUNT = 4;
const CONCURRENCY = 2;

type PreviewState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; thumbs: DriveFolderThumb[] }
  | { status: 'error' };

/** Cache de sesión en el renderer — evita re-pedir al cambiar de tab. */
const sessionCache = new Map<string, DriveFolderThumb[]>();

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

export function useFolderPreviews(folderIds: string[]) {
  const [previews, setPreviews] = useState<Record<string, PreviewState>>(() => {
    const init: Record<string, PreviewState> = {};
    for (const id of folderIds) {
      const cached = sessionCache.get(id);
      init[id] = cached ? { status: 'ready', thumbs: cached } : { status: 'idle' };
    }
    return init;
  });
  const idsKey = folderIds.join('|');
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const ids = idsKey ? idsKey.split('|').filter(Boolean) : [];
    if (!ids.length) return;

    setPreviews((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (sessionCache.has(id)) {
          next[id] = { status: 'ready', thumbs: sessionCache.get(id)! };
        } else if (!next[id] || next[id].status === 'idle' || next[id].status === 'error') {
          next[id] = { status: 'loading' };
        }
      }
      // Drop removed folders from state (keep sessionCache for revisit).
      for (const key of Object.keys(next)) {
        if (!ids.includes(key)) delete next[key];
      }
      return next;
    });

    const pending = ids.filter((id) => !sessionCache.has(id));
    if (!pending.length) return;

    void mapWithConcurrency(pending, CONCURRENCY, async (folderId) => {
      try {
        const res = await api.autoimgDriveFolderPreview(folderId);
        if (cancelled.current) return;
        sessionCache.set(folderId, res.thumbs);
        setPreviews((prev) => ({
          ...prev,
          [folderId]: { status: 'ready', thumbs: res.thumbs },
        }));
      } catch {
        if (cancelled.current) return;
        setPreviews((prev) => ({
          ...prev,
          [folderId]: { status: 'error' },
        }));
      }
    });

    return () => {
      cancelled.current = true;
    };
  }, [idsKey]);

  const invalidate = (folderId: string) => {
    sessionCache.delete(folderId);
    setPreviews((prev) => ({ ...prev, [folderId]: { status: 'idle' } }));
  };

  return { previews, invalidate };
}

export function FolderPreviewStrip({
  state,
  folderName,
}: {
  state: PreviewState | undefined;
  folderName: string;
}) {
  const status = state?.status ?? 'loading';
  const thumbs = state?.status === 'ready' ? state.thumbs : [];
  const visibleThumbs = thumbs.filter((t) => t.dataUrl);

  if (status === 'ready' && visibleThumbs.length === 0) {
    return (
      <div
        className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]"
        aria-label={`Vista previa de ${folderName}`}
      >
        <ImageOff size={12} strokeWidth={1.5} />
        Sin miniaturas
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]"
        aria-label={`Vista previa de ${folderName}`}
      >
        <ImageOff size={12} strokeWidth={1.5} />
        Preview no disponible
      </div>
    );
  }

  return (
    <div
      className="mt-2 flex gap-1.5"
      aria-label={`Vista previa de ${folderName}`}
    >
      {status === 'loading' || status === 'idle'
        ? Array.from({ length: SLOT_COUNT }, (_, i) => (
            <div
              key={`sk-${i}`}
              className="h-11 w-11 shrink-0 animate-pulse rounded-lg bg-[var(--bg-elevated)]"
            />
          ))
        : visibleThumbs.map((thumb) => (
            <img
              key={thumb.id}
              src={thumb.dataUrl!}
              alt={thumb.name}
              title={thumb.name}
              loading="lazy"
              decoding="async"
              className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-[var(--border-subtle)]"
            />
          ))}
    </div>
  );
}
