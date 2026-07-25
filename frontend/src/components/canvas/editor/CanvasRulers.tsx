import { memo, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasGuide } from '../types';
import { MM_TO_PX } from '../ops/drawHelpers';
import { clampGuidePos, createGuide, formatGapMm, isGuideRemovalPoint } from '../ops/guides';
import { createGestureRaf } from '../ops/gestureRaf';

const RULER = 20;

interface CanvasRulersProps {
  zoom: number;
  pan: { x: number; y: number };
  pageWidthMm: number;
  pageHeightMm: number;
  pageIndex: number;
  onCreateGuide: (guide: CanvasGuide) => void;
  /** Abort an in-progress guide creation (Esc, or released back onto the ruler). */
  onCancelCreate?: (id: string) => void;
}

/** Floating label that follows the pointer while creating/dragging a guide. */
export function GuidePositionChip({
  x,
  y,
  label,
  danger = false,
}: {
  x: number;
  y: number;
  label: string;
  danger?: boolean;
}) {
  return (
    <div
      data-testid="canvas-guide-chip"
      style={{
        position: 'fixed',
        left: x + 12,
        top: y + 12,
        zIndex: 80,
        background: danger ? 'var(--cv-danger)' : 'var(--cv-accent)',
        color: '#fff',
        fontSize: 10,
        padding: '1px 4px',
        borderRadius: 2,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      {label}
    </div>
  );
}

/**
 * Top + left rulers synced to the A4 page under the current pan/zoom.
 * Drag from a ruler into the canvas to create a persistent guide.
 */
function CanvasRulers({
  zoom,
  pan,
  pageWidthMm,
  pageHeightMm,
  pageIndex,
  onCreateGuide,
  onCancelCreate,
}: CanvasRulersProps) {
  const frameW = Math.round(pageWidthMm * MM_TO_PX * zoom);
  const frameH = Math.round(pageHeightMm * MM_TO_PX * zoom);
  const [createChip, setCreateChip] = useState<{ posMm: number; x: number; y: number } | null>(null);

  const ticksH = useMemo(() => {
    const stepMm = zoom >= 1.5 ? 5 : zoom >= 0.6 ? 10 : 20;
    const out: Array<{ mm: number; major: boolean }> = [];
    for (let mm = 0; mm <= pageWidthMm + 0.01; mm += stepMm) {
      out.push({ mm, major: mm % (stepMm * 2) === 0 || mm === 0 || Math.abs(mm - pageWidthMm) < 0.01 });
    }
    return out;
  }, [pageWidthMm, zoom]);

  const ticksV = useMemo(() => {
    const stepMm = zoom >= 1.5 ? 5 : zoom >= 0.6 ? 10 : 20;
    const out: Array<{ mm: number; major: boolean }> = [];
    for (let mm = 0; mm <= pageHeightMm + 0.01; mm += stepMm) {
      out.push({ mm, major: mm % (stepMm * 2) === 0 || mm === 0 || Math.abs(mm - pageHeightMm) < 0.01 });
    }
    return out;
  }, [pageHeightMm, zoom]);

  /**
   * Page origin (0,0) relative to the ruler strip. The strip starts RULER px
   * into the viewport, so shift by -RULER / 2 to keep ticks aligned with the page.
   */
  const originX = `calc(50% + ${Math.round(pan.x) - RULER / 2}px - ${frameW / 2}px)`;
  const originY = `calc(50% + ${Math.round(pan.y) - RULER / 2}px - ${frameH / 2}px)`;

  const startCreate = (axis: 'x' | 'y', e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startClient = axis === 'x' ? e.clientX : e.clientY;
    const maxMm = axis === 'x' ? pageWidthMm : pageHeightMm;
    let created: CanvasGuide | null = null;
    let cancelled = false;

    const viewportEl = e.currentTarget.parentElement as HTMLElement | null;
    const viewport = viewportEl?.getBoundingClientRect();
    if (!viewport) return;

    const toMm = (client: number) => {
      if (axis === 'x') {
        const pageLeft = viewport.left + viewport.width / 2 + pan.x - frameW / 2;
        return (client - pageLeft) / (MM_TO_PX * zoom);
      }
      const pageTop = viewport.top + viewport.height / 2 + pan.y - frameH / 2;
      return (client - pageTop) / (MM_TO_PX * zoom);
    };

    // Coalesce per-event document updates to one apply per animation frame.
    const raf = createGestureRaf((ev: PointerEvent) => {
      if (cancelled) return;
      const pos = toMm(axis === 'x' ? ev.clientX : ev.clientY);
      if (!created) {
        // Only create after leaving the ruler strip.
        const delta = Math.abs((axis === 'x' ? ev.clientX : ev.clientY) - startClient);
        if (delta < 4) return;
        created = createGuide(axis, clampGuidePos(pos, maxMm), pageIndex);
      } else {
        created = { ...created, posMm: clampGuidePos(pos, maxMm) };
      }
      onCreateGuide(created);
      setCreateChip({ posMm: created.posMm, x: ev.clientX, y: ev.clientY });
    });

    const cleanup = () => {
      raf.cancel();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      setCreateChip(null);
    };

    const cancel = () => {
      cancelled = true;
      if (created) onCancelCreate?.(created.id);
      created = null;
      cleanup();
    };

    const onMove = (ev: PointerEvent) => raf.schedule(ev);

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') cancel();
    };

    const onUp = (ev: PointerEvent) => {
      raf.flush();
      // Released back onto the ruler → no guide is created (Figma behavior).
      if (!cancelled && created) {
        const rect = viewportEl?.getBoundingClientRect();
        if (rect && isGuideRemovalPoint(axis, ev.clientX, ev.clientY, rect, RULER)) {
          onCancelCreate?.(created.id);
        }
      }
      cleanup();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
  };


  return (
    <>
      {/* Corner */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: RULER,
          height: RULER,
          background: 'var(--cv-panel-elevated, #ffffff)',
          borderRight: '1px solid var(--cv-border, #e2e6eb)',
          borderBottom: '1px solid var(--cv-border, #e2e6eb)',
          zIndex: 60,
          pointerEvents: 'none',
        }}
      />

      {/* Top ruler */}
      <div
        data-testid="canvas-ruler-top"
        onPointerDown={(e) => startCreate('y', e)}
        style={{
          position: 'absolute',
          left: RULER,
          top: 0,
          right: 0,
          height: RULER,
          background: 'var(--cv-panel-elevated, #ffffff)',
          borderBottom: '1px solid var(--cv-border, #e2e6eb)',
          zIndex: 60,
          cursor: 'ns-resize',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', left: originX, top: 0, height: '100%', pointerEvents: 'none' }}>
          {ticksH.map(({ mm: m, major }) => (
            <div
              key={`h-${m}`}
              style={{
                position: 'absolute',
                left: m * MM_TO_PX * zoom,
                bottom: 0,
                width: 1,
                height: major ? 12 : 6,
                background: 'var(--cv-text-secondary, #5c6778)',
              }}
            >
              {major && (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: 2,
                    fontSize: 9,
                    color: 'var(--cv-text-secondary, #5c6778)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Left ruler */}
      <div
        data-testid="canvas-ruler-left"
        onPointerDown={(e) => startCreate('x', e)}
        style={{
          position: 'absolute',
          left: 0,
          top: RULER,
          bottom: 0,
          width: RULER,
          background: 'var(--cv-panel-elevated, #ffffff)',
          borderRight: '1px solid var(--cv-border, #e2e6eb)',
          zIndex: 60,
          cursor: 'ew-resize',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: originY, left: 0, width: '100%', pointerEvents: 'none' }}>
          {ticksV.map(({ mm: m, major }) => (
            <div
              key={`v-${m}`}
              style={{
                position: 'absolute',
                top: m * MM_TO_PX * zoom,
                right: 0,
                height: 1,
                width: major ? 12 : 6,
                background: 'var(--cv-text-secondary, #5c6778)',
              }}
            >
              {major && (
                <span
                  style={{
                    position: 'absolute',
                    left: 2,
                    top: 2,
                    fontSize: 9,
                    color: 'var(--cv-text-secondary, #5c6778)',
                    whiteSpace: 'nowrap',
                    writingMode: 'vertical-lr',
                    transform: 'rotate(180deg)',
                  }}
                >
                  {m}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {createChip && <GuidePositionChip x={createChip.x} y={createChip.y} label={formatGapMm(createChip.posMm)} />}
    </>
  );
}

export default memo(CanvasRulers);

export const RULER_SIZE = RULER;

