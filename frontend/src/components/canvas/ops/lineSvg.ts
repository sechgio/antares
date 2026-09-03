
import type { CanvasLayer } from '../types';
import { parseMm } from '../types';
import { ensureLinePath, parseStrokeCap, pathToSvgD } from './pathGeometry';
import { lineStrokeWidthPx, pxToMm, resolveLineFillColor, parseStrokeDash, strokeDasharrayMm } from './layerStyle';

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function strokeLinecap(cap: ReturnType<typeof parseStrokeCap>): 'butt' | 'round' | 'square' {
  if (cap === 'round') return 'round';
  if (cap === 'square') return 'square';
  return 'butt';
}

function markerId(layerId: string, end: 'start' | 'end'): string {
  const safe = layerId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `mk-${safe}-${end}`;
}

function arrowMarker(id: string, color: string, orient: 'auto-start-reverse' | 'auto'): string {
  return `<marker id="${escapeAttr(id)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="${orient}" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeAttr(color)}"/></marker>`;
}

export function buildLineSvgContent(layer: CanvasLayer): string {
  const ensured = ensureLinePath(layer);
  const path = ensured.meta?.path;
  if (!path?.points?.length) return '';

  const w = Math.max(0.5, parseMm(ensured.cssVars['--width'], 10));
  const h = Math.max(0.5, parseMm(ensured.cssVars['--height'], 10));
  const strokeWidthMm = Math.max(0.05, pxToMm(lineStrokeWidthPx(ensured)));
  const color = resolveLineFillColor(ensured.cssVars);
  const visible = ensured.cssVars['--stroke-visible'] !== '0' && color !== 'transparent';
  const startCap = parseStrokeCap(ensured.cssVars['--stroke-start']);
  const endCap = parseStrokeCap(ensured.cssVars['--stroke-end']);
  const d = pathToSvgD(path.points, Boolean(path.closed));

  const defs: string[] = [];
  let markerStart = '';
  let markerEnd = '';
  if (visible && startCap === 'arrow') {
    const id = markerId(ensured.id, 'start');
    defs.push(arrowMarker(id, color, 'auto-start-reverse'));
    markerStart = ` marker-start="url(#${id})"`;
  }
  if (visible && endCap === 'arrow') {
    const id = markerId(ensured.id, 'end');
    defs.push(arrowMarker(id, color, 'auto'));
    markerEnd = ` marker-end="url(#${id})"`;
  }

  const linecap =
    startCap === 'arrow' || endCap === 'arrow'
      ? 'butt'
      : strokeLinecap(startCap === 'none' && endCap !== 'none' ? endCap : startCap);

  const dash = parseStrokeDash(ensured.cssVars['--stroke-dash']);
  const dashAttr = (() => {
    const arr = strokeDasharrayMm(dash, strokeWidthMm);
    return arr ? ` stroke-dasharray="${escapeAttr(arr)}"` : '';
  })();

  const defsBlock = defs.length ? `<defs>${defs.join('')}</defs>` : '';
  const pathEl = visible
    ? `<path d="${escapeAttr(d)}" fill="none" stroke="${escapeAttr(color)}" stroke-width="${strokeWidthMm}" stroke-linecap="${linecap}" stroke-linejoin="round"${dashAttr}${markerStart}${markerEnd} />`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${w} ${h}" overflow="visible" preserveAspectRatio="none">${defsBlock}${pathEl}</svg>`;
}
