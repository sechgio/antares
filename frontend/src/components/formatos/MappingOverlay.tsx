import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Move, ZoomIn } from 'lucide-react';
import type { VisualMapping } from '../../types';
import {
  clampMappingRect,
  computePageDisplayScale,
  mappingColorCss,
  mappingFontNameToCss,
  mappingFontWeight,
  mappingRectToOverlayStyle,
  mappingTextTopPercent,
  screenToMappingPoint,
  type MappingRect,
  type PdfPageSize,
} from './mappingCoords';

type DragMode = 'move' | 'resize' | null;

function pad(n: number, len: number) {
  return String(n).padStart(len, '0');
}

function mappingToRect(mapping: VisualMapping): MappingRect {
  return {
    x: mapping.x,
    y: mapping.y,
    width: mapping.width,
    height: mapping.height,
  };
}

function useImageDisplayScale(
  imageRef: RefObject<HTMLImageElement | null>,
  pageSize: PdfPageSize,
): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const img = imageRef.current;
    if (!img) return undefined;

    const update = () => {
      setScale(computePageDisplayScale(img.clientHeight, pageSize.height));
    };

    update();
    img.addEventListener('load', update);

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => {
        img.removeEventListener('load', update);
        window.removeEventListener('resize', update);
      };
    }

    const observer = new ResizeObserver(update);
    observer.observe(img);
    return () => {
      img.removeEventListener('load', update);
      observer.disconnect();
    };
  }, [imageRef, pageSize.height]);

  return scale;
}

interface MappingOverlayProps {
  mapping: VisualMapping;
  pageSize: PdfPageSize;
  imageRef: RefObject<HTMLImageElement | null>;
  sampleNumber?: number;
  onChange: (partial: Pick<VisualMapping, 'x' | 'y' | 'width' | 'height'>) => void;
}

export default function MappingOverlay({
  mapping,
  pageSize,
  imageRef,
  sampleNumber = 1234,
  onChange,
}: MappingOverlayProps) {
  const rect = useMemo(() => mappingToRect(mapping), [mapping]);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [liveRect, setLiveRect] = useState<MappingRect>(rect);
  const dragRef = useRef<{ startX: number; startY: number; origin: MappingRect } | null>(null);
  const liveRectRef = useRef(liveRect);
  const displayScale = useImageDisplayScale(imageRef, pageSize);

  useEffect(() => {
    setLiveRect(rect);
  }, [rect]);

  useEffect(() => {
    liveRectRef.current = liveRect;
  }, [liveRect]);

  const toMappingPoint = useCallback((clientX: number, clientY: number) => {
    const img = imageRef.current;
    if (!img) return { x: 0, y: 0 };
    return screenToMappingPoint(clientX, clientY, img, pageSize);
  }, [imageRef, pageSize]);

  const emitRect = useCallback((nextRect: MappingRect) => {
    const clamped = clampMappingRect(nextRect, pageSize);
    setLiveRect(clamped);
    onChange(clamped);
  }, [onChange, pageSize]);

  const finishDrag = useCallback(() => {
    setDragMode(null);
    dragRef.current = null;
  }, []);

  const placeAtPoint = useCallback((clientX: number, clientY: number) => {
    const point = toMappingPoint(clientX, clientY);
    emitRect(clampMappingRect({
      ...liveRectRef.current,
      x: point.x - liveRectRef.current.width / 2,
      y: point.y - liveRectRef.current.height / 2,
    }, pageSize));
  }, [emitRect, pageSize, toMappingPoint]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!dragMode || !dragRef.current) return;
    const point = toMappingPoint(event.clientX, event.clientY);
    const start = dragRef.current;
    const origin = start.origin;

    if (dragMode === 'move') {
      emitRect({
        ...origin,
        x: origin.x + (point.x - start.startX),
        y: origin.y + (point.y - start.startY),
      });
      return;
    }

    emitRect({
      ...origin,
      width: Math.max(20, point.x - origin.x),
      height: Math.max(12, point.y - origin.y),
    });
  }, [dragMode, emitRect, toMappingPoint]);

  const handleMouseUp = useCallback(() => {
    if (!dragMode) return;
    finishDrag();
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
    const point = toMappingPoint(event.clientX, event.clientY);
    dragRef.current = { startX: point.x, startY: point.y, origin: liveRectRef.current };
    setDragMode('move');
  }, [toMappingPoint]);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const point = toMappingPoint(event.clientX, event.clientY);
    dragRef.current = { startX: point.x, startY: point.y, origin: liveRectRef.current };
    setDragMode('resize');
  }, [toMappingPoint]);

  const handleBackdropClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    placeAtPoint(event.clientX, event.clientY);
  }, [placeAtPoint]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    placeAtPoint(event.clientX, event.clientY);
  }, [placeAtPoint]);

  const hitBoxStyle = useMemo(
    () => mappingRectToOverlayStyle(liveRect, pageSize),
    [liveRect, pageSize],
  );

  const sampleText = pad(sampleNumber, mapping.padding);
  const fontSizePx = mapping.font_size * displayScale;
  const textColor = mappingColorCss(mapping.color_r, mapping.color_g, mapping.color_b);

  const textStyle = useMemo((): CSSProperties => ({
    position: 'absolute',
    left: `${(liveRect.x / pageSize.width) * 100}%`,
    top: mappingTextTopPercent(liveRect.y, mapping.font_size, pageSize.height),
    fontFamily: mappingFontNameToCss(mapping.font_name),
    fontWeight: mappingFontWeight(mapping.font_name),
    fontSize: `${fontSizePx}px`,
    lineHeight: 1,
    color: textColor,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    userSelect: 'none',
  }), [liveRect.x, liveRect.y, mapping.color_b, mapping.color_g, mapping.color_r, mapping.font_name, mapping.font_size, pageSize.height, pageSize.width, fontSizePx, textColor]);

  const showEditChrome = dragMode !== null;

  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair"
      onClick={handleBackdropClick}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <span data-testid="mapping-preview-text" style={textStyle}>
        {sampleText}
      </span>

      <div
        data-testid="mapping-overlay"
        className={`absolute z-20 touch-none ${dragMode === 'move' ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={hitBoxStyle}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={startMove}
      >
        <div
          className={`pointer-events-none absolute inset-0 rounded transition-opacity ${
            showEditChrome
              ? 'border-2 border-dashed border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 opacity-100'
              : 'border border-[var(--accent-primary)]/25 opacity-0 hover:opacity-100'
          }`}
        />
        <div
          aria-label="Redimensionar mapping"
          className={`absolute -bottom-2 -right-2 z-30 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-[var(--text-on-accent)] bg-[var(--accent-primary)] shadow transition-opacity ${
            showEditChrome ? 'opacity-100' : 'opacity-0 hover:opacity-100'
          }`}
          onMouseDown={startResize}
        />
      </div>

      <div className="pointer-events-none absolute left-4 top-4 z-30 max-w-[280px] rounded-md border border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--text-secondary)]" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 80%, transparent)' }}>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><Move size={11} /> Mover</span>
          <span className="inline-flex items-center gap-1"><ZoomIn size={11} /> Redimensionar</span>
        </div>
        <p className="mt-1 text-[var(--text-muted)]">Haz clic en la página, arrastra el recuadro o edita los valores manualmente.</p>
      </div>
    </div>
  );
}
