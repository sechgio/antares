import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasGuide } from '../types';
import { MM_TO_PX } from '../ops/drawHelpers';
import { createGuide } from '../ops/guides';

const RULER = 20;

interface CanvasRulersProps {
  zoom: number;
  pan: { x: number; y: number };
  pageWidthMm: number;
  pageHeightMm: number;
  pageIndex: number;
  onCreateGuide: (guide: CanvasGuide) => void;
}

/**
 * Top + left rulers synced to the A4 page under the current pan/zoom.
 * Drag from a ruler into the canvas to create a persistent guide.
 */
export default function CanvasRulers({
  zoom,
  pan,
  pageWidthMm,
  pageHeightMm,
  pageIndex,
  onCreateGuide,
}: CanvasRulersProps) {
  const frameW = Math.round(pageWidthMm * MM_TO_PX * zoom);
  const frameH = Math.round(pageHeightMm * MM_TO_PX * zoom);

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

  /** Page origin (0,0) in viewport coordinates. */
  const originX = `calc(50% + ${Math.round(pan.x)}px - ${frameW / 2}px)`;
  const originY = `calc(50% + ${Math.round(pan.y)}px - ${frameH / 2}px)`;

  const startCreate = (axis: 'x' | 'y', e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startClient = axis === 'x' ? e.clientX : e.clientY;
    let created: CanvasGuide | null = null;

    const viewport = (e.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect();
    if (!viewport) return;

    const toMm = (client: number) => {
      if (axis === 'x') {
        const pageLeft = viewport.left + viewport.width / 2 + pan.x - frameW / 2;
        return (client - pageLeft) / (MM_TO_PX * zoom);
      }
      const pageTop = viewport.top + viewport.height / 2 + pan.y - frameH / 2;
      return (client - pageTop) / (MM_TO_PX * zoom);
    };

    const onMove = (ev: PointerEvent) => {
      const pos = toMm(axis === 'x' ? ev.clientX : ev.clientY);
      if (!created) {
        // Only create after leaving the ruler strip.
        const delta = Math.abs((axis === 'x' ? ev.clientX : ev.clientY) - startClient);
        if (delta < 4) return;
        created = createGuide(axis, Math.max(0, Math.min(axis === 'x' ? pageWidthMm : pageHeightMm, pos)), pageIndex);
        onCreateGuide(created);
        return;
      }
      created = { ...created, posMm: Math.max(0, Math.min(axis === 'x' ? pageWidthMm : pageHeightMm, pos)) };
      onCreateGuide(created);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      {/* Corner */}
      <div
        data-testid="canvas-ruler-corner"
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
    </>
  );
}

export const RULER_SIZE = RULER;
