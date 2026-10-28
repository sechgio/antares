import type { AgentBrowserElement } from '../../api/agentApi';

export type Point = { x: number; y: number };
export type Mark =
  | { kind: 'pen'; color: string; width: number; points: Point[] }
  | { kind: 'line' | 'arrow' | 'rect' | 'ellipse'; color: string; width: number; from: Point; to: Point }
  | { kind: 'step'; color: string; width: number; at: Point; n: number }
  | { kind: 'text'; color: string; width: number; at: Point; text: string }
  | { kind: 'pick'; color: string; width: number; from: Point; to: Point; n: number; info: AgentBrowserElement };

export const ink = (color: string) => (['#ffffff', '#f59e0b'].includes(color) ? '#111111' : '#ffffff');

function badge(ctx: CanvasRenderingContext2D, color: string, n: number, at: Point, unit: number) {
  ctx.beginPath();
  ctx.arc(at.x, at.y, 12 * unit, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = ink(color);
  ctx.font = `600 ${13 * unit}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), at.x, at.y + unit);
}

export function drawMark(ctx: CanvasRenderingContext2D, mark: Mark, unit: number, selected = false) {
  ctx.save();
  ctx.strokeStyle = mark.color;
  ctx.fillStyle = mark.color;
  ctx.lineWidth = mark.width * unit;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (selected) { ctx.shadowColor = 'rgba(59,130,246,0.9)'; ctx.shadowBlur = 8 * unit; }
  if (mark.kind === 'pen') {
    ctx.beginPath();
    mark.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  } else if (mark.kind === 'line' || mark.kind === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(mark.from.x, mark.from.y);
    ctx.lineTo(mark.to.x, mark.to.y);
    ctx.stroke();
    if (mark.kind === 'arrow') {
      const angle = Math.atan2(mark.to.y - mark.from.y, mark.to.x - mark.from.x);
      const head = (10 + mark.width * 2) * unit;
      ctx.beginPath();
      ctx.moveTo(mark.to.x, mark.to.y);
      ctx.lineTo(mark.to.x - head * Math.cos(angle - Math.PI / 7), mark.to.y - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(mark.to.x - head * Math.cos(angle + Math.PI / 7), mark.to.y - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    }
  } else if (mark.kind === 'rect') {
    ctx.strokeRect(Math.min(mark.from.x, mark.to.x), Math.min(mark.from.y, mark.to.y),
      Math.abs(mark.to.x - mark.from.x), Math.abs(mark.to.y - mark.from.y));
  } else if (mark.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse((mark.from.x + mark.to.x) / 2, (mark.from.y + mark.to.y) / 2,
      Math.abs(mark.to.x - mark.from.x) / 2, Math.abs(mark.to.y - mark.from.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mark.kind === 'step') {
    badge(ctx, mark.color, mark.n, mark.at, unit);
  } else if (mark.kind === 'pick') {
    const box = { x: mark.from.x, y: mark.from.y, w: mark.to.x - mark.from.x, h: mark.to.y - mark.from.y };
    ctx.globalAlpha = 0.12;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.globalAlpha = 1;
    ctx.setLineDash?.([6 * unit, 4 * unit]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash?.([]);
    badge(ctx, mark.color, mark.n, { x: Math.max(12 * unit, box.x), y: Math.max(12 * unit, box.y) }, unit);
  } else if (mark.kind === 'text') {
    const size = (12 + mark.width * 2) * unit;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    const pad = 6 * unit;
    const textWidth = ctx.measureText?.(mark.text).width ?? mark.text.length * size * 0.6;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(mark.at.x - pad, mark.at.y - pad, textWidth + pad * 2, size + pad * 2, 6 * unit);
    else ctx.rect(mark.at.x - pad, mark.at.y - pad, textWidth + pad * 2, size + pad * 2);
    ctx.fill();
    ctx.fillStyle = ink(mark.color);
    ctx.fillText(mark.text, mark.at.x, mark.at.y);
  }
  ctx.restore();
}

export function bounds(mark: Mark, unit: number) {
  const pts = mark.kind === 'pen' ? mark.points
    : mark.kind === 'step' ? [{ x: mark.at.x - 12 * unit, y: mark.at.y - 12 * unit }, { x: mark.at.x + 12 * unit, y: mark.at.y + 12 * unit }]
      : mark.kind === 'text' ? [mark.at, { x: mark.at.x + mark.text.length * (8 + mark.width) * unit, y: mark.at.y + (14 + mark.width * 2) * unit }]
        : [mark.from, mark.to];
  const pad = (mark.width + 6) * unit;
  return {
    left: Math.min(...pts.map((p) => p.x)) - pad, right: Math.max(...pts.map((p) => p.x)) + pad,
    top: Math.min(...pts.map((p) => p.y)) - pad, bottom: Math.max(...pts.map((p) => p.y)) + pad,
  };
}

export function moved(mark: Mark, dx: number, dy: number): Mark {
  const shift = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  if (mark.kind === 'pen') return { ...mark, points: mark.points.map(shift) };
  if (mark.kind === 'step' || mark.kind === 'text') return { ...mark, at: shift(mark.at) };
  return { ...mark, from: shift(mark.from), to: shift(mark.to) };
}

export function annotationNotes(pages: Mark[][], multiPage: boolean) {
  return pages.flatMap((marks, index) => marks.flatMap((mark) => {
    const where = multiPage ? ` (pág. ${index + 1})` : '';
    if (mark.kind === 'text') return [`Nota${where}: «${mark.text}»`];
    if (mark.kind !== 'pick') return [];
    const { info } = mark;
    const name = `<${info.tag}${info.id ? `#${info.id}` : ''}${info.classes.length ? `.${info.classes.join('.')}` : ''}>`;
    const said = info.text || info.label;
    return [`[${mark.n}]${where} ${name}${said ? ` «${said.slice(0, 120)}»` : ''} — ${info.selector}${info.href ? ` → ${info.href}` : ''}`];
  }));
}
