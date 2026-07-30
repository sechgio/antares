import { memo, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { radiusHandleInsetPx } from '../ops/cornerRadiusGesture';
import { mmToScreenPx } from '../ops/drawHelpers';
import { formatSizeMm } from '../ops/guides';
import type { CornerId } from '../ops/layerStyle';
import type { HandlePos, RectMm } from '../ops/selectionTransform';
import { screenChromePx } from '../ops/textTypography';
import { MeasurementBadge } from './CanvasRulers';

const HANDLE = 7;
const RADIUS_HANDLE = 8;
const ROTATE_HANDLE_OFFSET = 24;

function handleStyle(left: number, top: number, cursor: string, cameraZoom: number): CSSProperties {
  const size = screenChromePx(HANDLE, cameraZoom);
  return {
    position: 'absolute',
    left,
    top,
    width: size,
    height: size,
    marginLeft: -size / 2,
    marginTop: -size / 2,
    background: '#fff',
    border: `${screenChromePx(1, cameraZoom)}px solid var(--cv-accent)`,
    borderRadius: 1,
    // Above radius handles so corner resize always wins on overlap.
    zIndex: 42,
    cursor,
    boxSizing: 'border-box',
  };
}

function radiusHandleStyle(left: number, top: number, cameraZoom: number): CSSProperties {
  const size = screenChromePx(RADIUS_HANDLE, cameraZoom);
  return {
    position: 'absolute',
    left,
    top,
    width: size,
    height: size,
    marginLeft: -size / 2,
    marginTop: -size / 2,
    background: '#fff',
    border: `${screenChromePx(1.5, cameraZoom)}px solid var(--cv-accent)`,
    borderRadius: '50%',
    zIndex: 41,
    cursor: 'default',
    boxSizing: 'border-box',
    pointerEvents: 'auto',
  };
}

export interface SelectionChromeOverlayProps {
  bbox: RectMm;
  zoom: number;
  /** When false, only the outline + size badge show (locked / non-editable selection). */
  showHandles?: boolean;
  showRadiusHandles?: boolean;
  cornerRadii?: Record<CornerId, number>;
  radiusDragLabel?: string | null;
  radiusDragCorner?: CornerId | null;
  onResize: (e: ReactPointerEvent<HTMLDivElement>, handle: HandlePos) => void;
  onRotate: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onRadiusResize?: (e: ReactPointerEvent<HTMLDivElement>, corner: CornerId) => void;
}

/** Selection outline + handles + size badge — isolated from LayerNode paint. */
export const SelectionChromeOverlay = memo(function SelectionChromeOverlay({
  bbox,
  zoom,
  showHandles = true,
  showRadiusHandles = false,
  cornerRadii,
  radiusDragLabel = null,
  radiusDragCorner = null,
  onResize,
  onRotate,
  onRadiusResize,
}: SelectionChromeOverlayProps) {
  const x = mmToScreenPx(bbox.x, 1);
  const y = mmToScreenPx(bbox.y, 1);
  const w = mmToScreenPx(bbox.w, 1);
  const h = mmToScreenPx(bbox.h, 1);
  const rotateOffset = screenChromePx(ROTATE_HANDLE_OFFSET, zoom);
  const handleSize = screenChromePx(HANDLE, zoom);
  const rotateHandleX = x + w / 2;
  const rotateHandleY = y - rotateOffset;

  const radii = cornerRadii ?? { tl: 0, tr: 0, br: 0, bl: 0 };
  // Inset is already layout px (document CSS + min clearance under camera zoom).
  const inset = {
    tl: radiusHandleInsetPx(radii.tl, zoom),
    tr: radiusHandleInsetPx(radii.tr, zoom),
    br: radiusHandleInsetPx(radii.br, zoom),
    bl: radiusHandleInsetPx(radii.bl, zoom),
  };
  // Keep handles inside the box for tiny selections.
  const maxInsetX = Math.max(0, w / 2 - screenChromePx(RADIUS_HANDLE, zoom));
  const maxInsetY = Math.max(0, h / 2 - screenChromePx(RADIUS_HANDLE, zoom));
  const clampInset = (v: number) => Math.min(v, maxInsetX, maxInsetY);
  const radiusCorners: Array<{
    id: CornerId;
    left: number;
    top: number;
  }> = [
    { id: 'tl', left: x + clampInset(inset.tl), top: y + clampInset(inset.tl) },
    { id: 'tr', left: x + w - clampInset(inset.tr), top: y + clampInset(inset.tr) },
    { id: 'br', left: x + w - clampInset(inset.br), top: y + h - clampInset(inset.br) },
    { id: 'bl', left: x + clampInset(inset.bl), top: y + h - clampInset(inset.bl) },
  ];
  const activeRadiusHandle =
    radiusCorners.find((c) => c.id === radiusDragCorner) ?? radiusCorners[0]!;

  return (
    <>
      <div
        data-testid="canvas-selection-chrome"
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: h,
          outline: '1px solid var(--cv-accent)',
          pointerEvents: 'none',
          zIndex: 30,
          boxSizing: 'border-box',
        }}
      />
      <MeasurementBadge
        testId="canvas-size-badge"
        label={formatSizeMm(bbox.w, bbox.h)}
        style={{
          position: 'absolute',
          left: x + w / 2,
          top: y + h + screenChromePx(8, zoom),
          transform: 'translate(-50%, 0)',
          zIndex: 46,
        }}
      />
      {showHandles && (
        <>
          <div
            style={{
              position: 'absolute',
              left: rotateHandleX,
              top: y,
              width: screenChromePx(1, zoom),
              height: rotateOffset,
              marginLeft: -screenChromePx(0.5, zoom),
              background: 'var(--cv-accent)',
              pointerEvents: 'none',
              zIndex: 39,
            }}
          />
          <WithHoverTooltip
            label="Rotar"
            shortcut="Shift · 15°"
            placement="top"
            variant="dark"
            className="!absolute"
            style={{
              left: rotateHandleX,
              top: rotateHandleY,
              width: handleSize,
              height: handleSize,
              marginLeft: -handleSize / 2,
              marginTop: -handleSize / 2,
              zIndex: 40,
            }}
          >
            <div
              data-testid="canvas-rotate-handle"
              aria-label="Rotar"
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                background: 'var(--cv-accent)',
                border: `${screenChromePx(1, zoom)}px solid #fff`,
                cursor: 'grab',
                boxSizing: 'border-box',
              }}
              onPointerDown={onRotate}
            />
          </WithHoverTooltip>
          {(
            [
              ['nw', x, y, 'nwse-resize'],
              ['n', x + w / 2, y, 'ns-resize'],
              ['ne', x + w, y, 'nesw-resize'],
              ['e', x + w, y + h / 2, 'ew-resize'],
              ['se', x + w, y + h, 'nwse-resize'],
              ['s', x + w / 2, y + h, 'ns-resize'],
              ['sw', x, y + h, 'nesw-resize'],
              ['w', x, y + h / 2, 'ew-resize'],
            ] as const
          ).map(([pos, left, top, cursorName]) => (
            <div
              key={pos}
              data-testid={`canvas-resize-handle-${pos}`}
              style={handleStyle(left, top, cursorName, zoom)}
              onPointerDown={(ev) => onResize(ev, pos)}
            />
          ))}
          {showRadiusHandles &&
            onRadiusResize &&
            radiusCorners.map(({ id, left, top }) => (
              <div
                key={`radius-${id}`}
                data-testid={`canvas-radius-handle-${id}`}
                aria-label={`Radio ${id.toUpperCase()}`}
                style={radiusHandleStyle(left, top, zoom)}
                onPointerDown={(ev) => onRadiusResize(ev, id)}
              />
            ))}
          {radiusDragLabel ? (
            <MeasurementBadge
              testId="canvas-radius-badge"
              label={radiusDragLabel}
              accent
              style={{
                position: 'absolute',
                left: activeRadiusHandle.left + screenChromePx(14, zoom),
                top: activeRadiusHandle.top - screenChromePx(14, zoom),
                transform: 'translate(-50%, -100%)',
                zIndex: 47,
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
});
