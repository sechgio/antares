import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Move, ZoomIn } from 'lucide-react';
import PdfPagePreview from './PdfPagePreview';
import type { PdfPageSize, StampDragMode, StampPosition, StampRect } from './types';
import { clampStampRect } from './utils';

const POSITION_COLORS = [
  'var(--accent-primary)',
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#a855f7',
  '#ec4899',
];

interface StampPlacementEditorProps {
  pdfBase64?: string | null;
  pdfPath?: string | null;
  stampUrl: string;
  positions: StampPosition[];
  activeIndex: number;
  pageSize: PdfPageSize;
  previewWidth: number;
  onChangePosition: (index: number, rect: StampRect) => void;
}

export default function StampPlacementEditor({
  pdfBase64,
  pdfPath,
  stampUrl,
  positions,
  activeIndex,
  pageSize,
  previewWidth,
  onChangePosition,
}: StampPlacementEditorProps) {
  const activePosition = positions[activeIndex] ?? positions[0];
  const rect = activePosition?.rect;
  const [dragMode, setDragMode] = useState<StampDragMode>(null);
  const [liveRect, setLiveRect] = useState<StampRect>(rect);
  const dragRef = useRef<{ startX: number; startY: number; origin: StampRect } | null>(null);
  const liveRectRef = useRef(liveRect);

  useEffect(() => {
    if (rect) setLiveRect(rect);
  }, [rect]);

  useEffect(() => {
    liveRectRef.current = liveRect;
  }, [liveRect]);

  const toPdfPoint = useCallback((clientX: number, clientY: number) => {
    const img = document.querySelector('[data-stamp-page-image]') as HTMLImageElement | null;
    if (!img) return { x: 0, y: 0 };
    const bounds = img.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
    return {
      x: ((clientX - bounds.left) / bounds.width) * pageSize.width,
      y: ((clientY - bounds.top) / bounds.height) * pageSize.height,
    };
  }, [pageSize.height, pageSize.width]);

  const finishDrag = useCallback((nextRect: StampRect) => {
    const clamped = clampStampRect(nextRect, pageSize);
    setLiveRect(clamped);
    onChangePosition(activeIndex, clamped);
    setDragMode(null);
    dragRef.current = null;
  }, [activeIndex, onChangePosition, pageSize]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!dragMode || !dragRef.current) return;
    const point = toPdfPoint(event.clientX, event.clientY);
    const start = dragRef.current;
    const origin = start.origin;

    if (dragMode === 'move') {
      setLiveRect(clampStampRect({
        ...origin,
        x: origin.x + (point.x - start.startX),
        y: origin.y + (point.y - start.startY),
      }, pageSize));
      return;
    }

    const aspect = origin.width / origin.height;
    const nextWidth = Math.max(24, point.x - origin.x);
    setLiveRect(clampStampRect({
      ...origin,
      width: nextWidth,
      height: nextWidth / aspect,
    }, pageSize));
  }, [dragMode, pageSize, toPdfPoint]);

  const handleMouseUp = useCallback(() => {
    if (!dragMode) return;
    finishDrag(liveRectRef.current);
  }, [dragMode, finishDrag]);

  useEffect(() => {
    if (!dragMode) return undefined;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragMode, handleMouseMove, handleMouseUp]);

  const startMove = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const point = toPdfPoint(event.clientX, event.clientY);
    dragRef.current = { startX: point.x, startY: point.y, origin: liveRectRef.current };
    setDragMode('move');
  }, [toPdfPoint]);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const point = toPdfPoint(event.clientX, event.clientY);
    dragRef.current = { startX: point.x, startY: point.y, origin: liveRectRef.current };
    setDragMode('resize');
  }, [toPdfPoint]);

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const point = toPdfPoint(event.clientX, event.clientY);
    const aspect = liveRectRef.current.width / liveRectRef.current.height;
    finishDrag(clampStampRect({
      ...liveRectRef.current,
      x: point.x - liveRectRef.current.width / 2,
      y: point.y - liveRectRef.current.height / 2,
      width: liveRectRef.current.width,
      height: liveRectRef.current.width / aspect,
    }, pageSize));
  };

  const overlayStyle = useMemo(() => ({
    left: `${(liveRect.x / pageSize.width) * 100}%`,
    top: `${(liveRect.y / pageSize.height) * 100}%`,
    width: `${(liveRect.width / pageSize.width) * 100}%`,
    height: `${(liveRect.height / pageSize.height) * 100}%`,
  }), [liveRect, pageSize.height, pageSize.width]);

  const inactiveOverlays = useMemo(() => positions.map((pos, index) => {
    if (index === activeIndex) return null;
    const color = POSITION_COLORS[index % POSITION_COLORS.length];
    const style = {
      left: `${(pos.rect.x / pageSize.width) * 100}%`,
      top: `${(pos.rect.y / pageSize.height) * 100}%`,
      width: `${(pos.rect.width / pageSize.width) * 100}%`,
      height: `${(pos.rect.height / pageSize.height) * 100}%`,
      borderColor: color,
    };
    return (
      <div
        key={pos.id}
        className="pointer-events-none absolute rounded border-2 border-dashed opacity-60"
        style={style}
        title={pos.name}
      >
        <span
          className="absolute -top-5 left-0 rounded px-1 text-[9px] font-mono uppercase"
          style={{ color, background: 'rgba(255,255,255,0.9)' }}
        >
          {pos.name}
        </span>
      </div>
    );
  }), [activeIndex, pageSize.height, pageSize.width, positions]);

  const activeOverlay = useMemo(() => (
    <div
      className={`absolute touch-none ${dragMode === 'move' ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={overlayStyle}
      onMouseDown={startMove}
    >
      <img
        src={stampUrl}
        alt="Sello"
        className="pointer-events-none h-full w-full select-none object-contain"
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-0 rounded border-2 border-[var(--accent-primary)] bg-[var(--accent-primary)]/10" />
      <div
        aria-label="Redimensionar sello"
        className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-[var(--accent-primary)] shadow"
        onMouseDown={startResize}
      />
    </div>
  ), [dragMode, overlayStyle, stampUrl, startMove, startResize]);

  if (!rect) return null;

  return (
    <div
      className="space-y-2"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <span>
          Editando <strong className="text-[var(--text-primary)]">{activePosition.name}</strong>
          . Las demás posiciones se muestran en guía punteada.
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-1"><Move size={11} /> Mover</span>
          <span className="inline-flex items-center gap-1"><ZoomIn size={11} /> Redimensionar</span>
        </div>
      </div>
      <PdfPagePreview
        pdfBase64={pdfBase64}
        pdfPath={pdfPath}
        width={previewWidth}
        overlay={(
          <>
            {inactiveOverlays}
            {activeOverlay}
          </>
        )}
      />
    </div>
  );
}
