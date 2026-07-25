import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { CanvasLayer, PathPoint } from '../types';
import { parseMm } from '../types';
import { mmToScreenPx } from '../ops/drawHelpers';
import { ensureLinePath } from '../ops/pathGeometry';

interface PathHandlesOverlayProps {
  layer: CanvasLayer;
  zoom: number;
  onPointPointerDown: (
    pointIndex: number,
    kind: 'anchor' | 'hin' | 'hout',
    e: ReactPointerEvent<SVGCircleElement>,
  ) => void;
}

function HandleDot({
  x,
  y,
  kind,
  onPointerDown,
}: {
  x: number;
  y: number;
  kind: 'anchor' | 'hin' | 'hout';
  onPointerDown: (e: ReactPointerEvent<SVGCircleElement>) => void;
}) {
  const r = kind === 'anchor' ? 4.5 : 3.5;
  return (
    <circle
      cx={x}
      cy={y}
      r={r}
      fill={kind === 'anchor' ? '#ffffff' : 'var(--cv-accent)'}
      stroke="var(--cv-accent)"
      strokeWidth={1.5}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
      onPointerDown={onPointerDown}
    />
  );
}

function handleVisible(p: PathPoint, which: 'hin' | 'hout'): boolean {
  const h = p[which];
  if (!h) return false;
  return h.x !== p.x || h.y !== p.y;
}

export default function PathHandlesOverlay({ layer, zoom, onPointPointerDown }: PathHandlesOverlayProps) {
  if (layer.type !== 'line') return null;
  const ensured = ensureLinePath(layer);
  const path = ensured.meta?.path;
  if (!path?.points?.length) return null;

  const ox = parseMm(ensured.cssVars['--translate-x']);
  const oy = parseMm(ensured.cssVars['--translate-y']);

  const toScreen = (pt: { x: number; y: number }) => ({
    x: mmToScreenPx(ox + pt.x, zoom),
    y: mmToScreenPx(oy + pt.y, zoom),
  });

  return (
    <svg
      data-testid="canvas-path-handles"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 45,
      }}
    >
      {path.points.map((p, i) => {
        const anchor = toScreen(p);
        const nodes: ReactNode[] = [];
        if (handleVisible(p, 'hin') && p.hin) {
          const hin = toScreen(p.hin);
          nodes.push(
            <line
              key={`hin-l-${i}`}
              x1={anchor.x}
              y1={anchor.y}
              x2={hin.x}
              y2={hin.y}
              stroke="var(--cv-accent)"
              strokeWidth={1}
            />,
            <HandleDot
              key={`hin-${i}`}
              x={hin.x}
              y={hin.y}
              kind="hin"
              onPointerDown={(e) => onPointPointerDown(i, 'hin', e)}
            />,
          );
        }
        if (handleVisible(p, 'hout') && p.hout) {
          const hout = toScreen(p.hout);
          nodes.push(
            <line
              key={`hout-l-${i}`}
              x1={anchor.x}
              y1={anchor.y}
              x2={hout.x}
              y2={hout.y}
              stroke="var(--cv-accent)"
              strokeWidth={1}
            />,
            <HandleDot
              key={`hout-${i}`}
              x={hout.x}
              y={hout.y}
              kind="hout"
              onPointerDown={(e) => onPointPointerDown(i, 'hout', e)}
            />,
          );
        }
        nodes.push(
          <HandleDot
            key={`a-${i}`}
            x={anchor.x}
            y={anchor.y}
            kind="anchor"
            onPointerDown={(e) => onPointPointerDown(i, 'anchor', e)}
          />,
        );
        return <g key={i}>{nodes}</g>;
      })}
    </svg>
  );
}
