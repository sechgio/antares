import { useCallback, useRef, useState } from 'react';
import { DelogoOverlay } from '../preview/DelogoOverlay';
import { hitTest, isDegenerate, moveRect, normalizeRect, resizeRect, screenToSource } from '../preview/delogoEffect';
import type { DelogoRect } from '../types';

interface DragState {
  mode: 'draw' | 'move' | 'resize';
  rectId: string | null;
  startX: number;
  startY: number;
  origin: DelogoRect | null;
}

export function RemoveLogoPanel({
  clipId,
  rects,
  onApply,
}: {
  clipId: string | null;
  rects: DelogoRect[];
  onApply: (next: DelogoRect[]) => void;
}) {
  const [draft, setDraft] = useState<DelogoRect[]>(rects);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const nextIdRef = useRef(1);

  const viewportSize = useCallback(() => {
    const el = viewportRef.current;
    const width = el?.clientWidth ?? 0;
    const height = el?.clientHeight ?? 0;
    if (width <= 0 || height <= 0) return { width: 320, height: 240 };
    return { width, height };
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!clipId) return;
      const viewport = viewportSize();
      const bounds = event.currentTarget.getBoundingClientRect();
      const point = screenToSource(event.clientX - bounds.left, event.clientY - bounds.top, viewport);
      const hit = hitTest(draft, point.x, point.y);
      if (hit) {
        setSelectedId(hit.id);
        dragRef.current = { mode: 'move', rectId: hit.id, startX: point.x, startY: point.y, origin: hit };
      } else {
        const id = `mask-${nextIdRef.current++}`;
        const created = normalizeRect({ id, x: point.x, y: point.y, width: 0.02, height: 0.02 });
        setDraft((prev) => [...prev, created]);
        setSelectedId(id);
        dragRef.current = { mode: 'resize', rectId: id, startX: point.x, startY: point.y, origin: created };
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [clipId, draft, viewportSize],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || !drag.origin) return;
      const viewport = viewportSize();
      const bounds = event.currentTarget.getBoundingClientRect();
      const point = screenToSource(event.clientX - bounds.left, event.clientY - bounds.top, viewport);
      setDraft((prev) =>
        prev.map((rect) => {
          if (rect.id !== drag.rectId) return rect;
          if (drag.mode === 'move') {
            return moveRect(rect, point.x - drag.startX, point.y - drag.startY);
          }
          return resizeRect(rect, point.x - drag.startX, point.y - drag.startY);
        }),
      );
    },
    [viewportSize],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setError(null);
  }, []);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setDraft((prev) => prev.filter((rect) => rect.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  const handleApply = useCallback(() => {
    const degenerate = draft.find((rect) => isDegenerate(rect));
    if (degenerate) {
      setError(`La máscara «${degenerate.id}» es demasiado pequeña; agrándala o bórrala.`);
      return;
    }
    setError(null);
    onApply(draft);
  }, [draft, onApply]);

  const handleCancel = useCallback(() => {
    setDraft(rects);
    setSelectedId(null);
    setError(null);
  }, [rects]);

  const handleReset = useCallback(() => {
    setDraft([]);
    setSelectedId(null);
    setError(null);
  }, []);

  if (!clipId) {
    return (
      <div className="p-3 text-xs text-[var(--text-muted)]">
        Selecciona un clip de video para quitar su logo.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3" data-testid="remove-logo-panel">
      <div
        ref={viewportRef}
        className="relative aspect-video w-full touch-none overflow-hidden rounded border border-[var(--border-medium)] bg-black"
        role="application"
        aria-label="Zona de selección de máscaras"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <DelogoOverlay rects={draft} selectedId={selectedId} />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-[var(--border-medium)] px-2 py-1 text-xs text-[var(--text-secondary)]"
          onClick={removeSelected}
          disabled={!selectedId}
        >
          Borrar máscara
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border-medium)] px-2 py-1 text-xs text-[var(--text-secondary)]"
          onClick={handleReset}
        >
          Restablecer
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border-medium)] px-2 py-1 text-xs text-[var(--text-secondary)]"
          onClick={handleCancel}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="ml-auto rounded bg-[var(--accent-primary)] px-3 py-1 text-xs text-white"
          onClick={handleApply}
        >
          Aplicar
        </button>
      </div>

      {error && (
        <p className="text-xs text-[var(--accent-red)]" role="alert">
          {error}
        </p>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        {draft.length === 0
          ? 'Arrastra sobre el video para marcar la región del logo.'
          : `${draft.length} ${draft.length === 1 ? 'máscara' : 'máscaras'} sin aplicar.`}{' '}
        La vista previa rápida es aproximada; el render final usa el filtro delogo.
      </p>
    </div>
  );
}

export default RemoveLogoPanel;
