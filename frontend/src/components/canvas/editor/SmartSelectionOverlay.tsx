import { Fragment, memo, type PointerEvent as ReactPointerEvent } from 'react';
import { mmToScreenPx } from '../ops/drawHelpers';
import { smartGapRect, type SmartSequence } from '../ops/smartSelection';
import type { RectMm } from '../ops/selectionTransform';
import { screenChromePx } from '../ops/textTypography';

const SMART_COLOR = 'var(--cv-accent-2)';

interface SmartSelectionOverlayProps {
  seq: SmartSequence;
  selectionBbox: RectMm | null;
  zoom: number;
  onGapPointerDown: (seq: SmartSequence, index: number, e: ReactPointerEvent<HTMLDivElement>) => void;
  onTidy: (seq: SmartSequence, e: ReactPointerEvent<HTMLDivElement>) => void;
}

function knobStyle(zoom: number, round: boolean) {
  const size = screenChromePx(9, zoom);
  return {
    width: size,
    height: size,
    borderRadius: round ? '50%' : 0,
    transform: round ? undefined : 'rotate(45deg)',
    background: SMART_COLOR,
    border: `${screenChromePx(1.5, zoom)}px solid #fff`,
    boxSizing: 'border-box' as const,
    pointerEvents: 'none' as const,
  };
}

export const SmartSelectionOverlay = memo(function SmartSelectionOverlay({
  seq,
  selectionBbox,
  zoom,
  onGapPointerDown,
  onTidy,
}: SmartSelectionOverlayProps) {
  const bar = screenChromePx(2, zoom);
  const hitSize = screenChromePx(16, zoom);
  const hitWrap = (left: number, top: number) => ({
    position: 'absolute' as const,
    left,
    top,
    width: hitSize,
    height: hitSize,
    marginLeft: -hitSize / 2,
    marginTop: -hitSize / 2,
    zIndex: 45,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  return (
    <>
      {seq.gaps.map((gap, i) => {
        const rect = smartGapRect(seq, i);
        const gx = mmToScreenPx(rect.x, 1);
        const gy = mmToScreenPx(rect.y, 1);
        const gw = mmToScreenPx(rect.w, 1);
        const gh = mmToScreenPx(rect.h, 1);
        const cx = gx + gw / 2;
        const cy = gy + gh / 2;
        const barStyle =
          seq.axis === 'x'
            ? { left: gx, top: cy - bar / 2, width: gw, height: bar }
            : { left: cx - bar / 2, top: gy, width: bar, height: gh };
        return (
          <Fragment key={`gap-${i}`}>
            <div
              aria-hidden
              style={{
                position: 'absolute',
                ...barStyle,
                background: SMART_COLOR,
                opacity: 0.7,
                pointerEvents: 'none',
                zIndex: 44,
              }}
            />
            <div
              data-testid={`canvas-gap-handle-${i}`}
              aria-label={`Separación ${i + 1}`}
              title={`${Math.abs(gap).toFixed(1)} mm`}
              style={{
                ...hitWrap(cx, cy),
                cursor: seq.axis === 'x' ? 'ew-resize' : 'ns-resize',
              }}
              onPointerDown={(e) => onGapPointerDown(seq, i, e)}
            >
              <div aria-hidden style={knobStyle(zoom, true)} />
            </div>
          </Fragment>
        );
      })}
      {!seq.uniform && seq.gaps.length > 1 && selectionBbox && (
        <div
          data-testid="canvas-tidy-handle"
          aria-label="Espaciado uniforme"
          title="Espaciado uniforme"
          style={{
            ...hitWrap(
              mmToScreenPx(selectionBbox.x + selectionBbox.w / 2, 1),
              mmToScreenPx(selectionBbox.y + selectionBbox.h / 2, 1),
            ),
            cursor: 'pointer',
          }}
          onPointerDown={(e) => onTidy(seq, e)}
        >
          <div aria-hidden style={knobStyle(zoom, false)} />
        </div>
      )}
    </>
  );
});
