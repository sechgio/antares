import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ChevronDown, Circle, Minus, MousePointer2, Pencil, Square, Type, X } from 'lucide-react';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';

type Point = { x: number; y: number };
type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'step';
type Tool = 'select' | 'pen' | 'text' | ShapeKind;
export type Mark =
  | { kind: 'pen'; color: string; width: number; points: Point[] }
  | { kind: 'line' | 'arrow' | 'rect' | 'ellipse'; color: string; width: number; from: Point; to: Point }
  | { kind: 'step'; color: string; width: number; at: Point; n: number }
  | { kind: 'text'; color: string; width: number; at: Point; text: string };

const SHAPES: { id: ShapeKind; label: string; icon: ReactElement }[] = [
  { id: 'line', label: 'Línea', icon: <Minus size={14} className="-rotate-45" /> },
  { id: 'arrow', label: 'Flecha', icon: <ArrowUpRight size={14} /> },
  { id: 'rect', label: 'Rectángulo', icon: <Square size={14} /> },
  { id: 'ellipse', label: 'Elipse', icon: <Circle size={14} /> },
  { id: 'step', label: 'Paso', icon: <span aria-hidden="true" className="flex size-[14px] items-center justify-center rounded-full border border-current text-[9px] leading-none">1</span> },
];
const COLORS = [
  { value: '#ef4444', label: 'Rojo' },
  { value: '#f59e0b', label: 'Ámbar' },
  { value: '#22c55e', label: 'Verde' },
  { value: '#3b82f6', label: 'Azul' },
  { value: '#a855f7', label: 'Violeta' },
  { value: '#ffffff', label: 'Blanco' },
  { value: '#111111', label: 'Negro' },
];
const WIDTHS = [{ value: 2, label: 'Fino' }, { value: 4, label: 'Medio' }, { value: 8, label: 'Grueso' }];

// Las medidas viven en píxeles de la captura; `unit` las escala para que el trazo
// tenga el mismo grosor en pantalla sea cual sea la densidad de la captura.
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
    const r = 12 * unit;
    ctx.beginPath();
    ctx.arc(mark.at.x, mark.at.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mark.color === '#ffffff' ? '#111111' : '#ffffff';
    ctx.font = `600 ${13 * unit}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(mark.n), mark.at.x, mark.at.y + unit);
  } else if (mark.kind === 'text') {
    ctx.font = `600 ${(12 + mark.width * 2) * unit}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(mark.text, mark.at.x, mark.at.y);
  }
  ctx.restore();
}

function bounds(mark: Mark, unit: number) {
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

function moved(mark: Mark, dx: number, dy: number): Mark {
  const shift = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  if (mark.kind === 'pen') return { ...mark, points: mark.points.map(shift) };
  if (mark.kind === 'step' || mark.kind === 'text') return { ...mark, at: shift(mark.at) };
  return { ...mark, from: shift(mark.from), to: shift(mark.to) };
}

function Menu({ label, trigger, children }: { label: string; trigger: ReactElement; children: (close: () => void) => ReactElement }) {
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({ estimatedWidth: 160, estimatedHeight: 200, direction: 'up', align: 'start' });
  return <>
    <button ref={menu.triggerRef} type="button" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={menu.isOpen}
      onClick={menu.toggle} className="flex h-8 items-center gap-1 rounded-lg px-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]">
      {trigger}
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    {menu.isOpen && createPortal(
      <div ref={menu.popupRef} role="menu" aria-label={label}
        className="fixed z-[300] rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
        style={{ top: menu.position?.top ?? -9999, left: menu.position?.left ?? -9999, visibility: menu.position ? 'visible' : 'hidden' }}>
        {children(menu.close)}
      </div>, document.body,
    )}
  </>;
}

export default function BrowserAnnotator({ image, width, height, onSubmit, onClose }: {
  image: string;
  width: number;
  height: number;
  onSubmit: (file: File) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shotRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [shape, setShape] = useState<ShapeKind>('rect');
  const [color, setColor] = useState(COLORS[0].value);
  const [stroke, setStroke] = useState(WIDTHS[1].value);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [typing, setTyping] = useState<{ at: Point; css: Point; text: string } | null>(null);
  const drag = useRef<{ start: Point; last: Point } | null>(null);
  const unit = () => {
    const canvas = canvasRef.current;
    return canvas && canvas.clientWidth ? width / canvas.clientWidth : 1;
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, width, height);
    const u = unit();
    marks.forEach((mark, index) => drawMark(ctx, mark, u, index === selected));
    if (draft) drawMark(ctx, draft, u);
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== null) {
        setMarks((prev) => prev.filter((_, i) => i !== selected));
        setSelected(null);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setMarks((prev) => prev.slice(0, -1));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, selected, typing]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      css: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      at: { x: (event.clientX - rect.left) * (width / (rect.width || width)), y: (event.clientY - rect.top) * (height / (rect.height || height)) },
    };
  };

  const commitText = () => {
    if (typing?.text.trim()) setMarks((prev) => [...prev, { kind: 'text', color, width: stroke, at: typing.at, text: typing.text.trim() }]);
    setTyping(null);
  };

  const down = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const { at, css } = point(event);
    if (tool === 'text') { commitText(); setTyping({ at, css, text: '' }); return; }
    if (tool === 'step') {
      const n = marks.filter((mark) => mark.kind === 'step').length + 1;
      setMarks((prev) => [...prev, { kind: 'step', color, width: stroke, at, n }]);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { start: at, last: at };
    if (tool === 'select') {
      const u = unit();
      const hit = marks.map((mark, i) => ({ box: bounds(mark, u), i }))
        .reverse().find(({ box }) => at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom);
      setSelected(hit ? hit.i : null);
      if (!hit) drag.current = null;
      return;
    }
    setDraft(tool === 'pen' ? { kind: 'pen', color, width: stroke, points: [at] } : { kind: tool, color, width: stroke, from: at, to: at });
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = drag.current;
    if (!state) return;
    const { at } = point(event);
    if (tool === 'select' && selected !== null) {
      const dx = at.x - state.last.x;
      const dy = at.y - state.last.y;
      setMarks((prev) => prev.map((mark, i) => (i === selected ? moved(mark, dx, dy) : mark)));
    } else {
      setDraft((prev) => (!prev ? prev : prev.kind === 'pen' ? { ...prev, points: [...prev.points, at] }
        : 'from' in prev ? { ...prev, to: at } : prev));
    }
    state.last = at;
  };

  const up = () => {
    drag.current = null;
    if (draft) setMarks((prev) => [...prev, draft]);
    setDraft(null);
  };

  const submit = () => {
    const shot = shotRef.current;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx || !shot) return;
    ctx.drawImage(shot, 0, 0, width, height);
    const u = unit();
    const all = typing?.text.trim() ? [...marks, { kind: 'text', color, width: stroke, at: typing.at, text: typing.text.trim() } as Mark] : marks;
    all.forEach((mark) => drawMark(ctx, mark, u));
    out.toBlob((blob) => {
      if (blob) onSubmit(new File([blob], 'anotacion.png', { type: 'image/png' }));
    }, 'image/png');
  };

  const button = (active: boolean) => `flex size-8 items-center justify-center rounded-lg transition-colors ${active
    ? 'bg-[color-mix(in_srgb,var(--accent-primary)_18%,transparent)] text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]'
    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'}`;
  const current = SHAPES.find((item) => item.id === shape)!;
  const cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';

  return (
    <div role="region" aria-label="Anotar la página" className="absolute inset-0 z-10 overflow-hidden bg-[var(--bg-surface)]">
      <img ref={shotRef} src={`data:image/png;base64,${image}`} alt="Captura de la página" className="pointer-events-none absolute inset-0 size-full object-fill" draggable={false} />
      <canvas
        ref={canvasRef}
        data-testid="annotation-canvas"
        width={width}
        height={height}
        className="absolute inset-0 size-full touch-none"
        style={{ cursor }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {typing && (
        <input
          autoFocus
          aria-label="Texto de la anotación"
          value={typing.text}
          onChange={(event) => setTyping({ ...typing, text: event.target.value })}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commitText(); }
            if (event.key === 'Escape') { event.preventDefault(); setTyping(null); }
          }}
          className="absolute min-w-[80px] border-none bg-transparent font-semibold outline-none"
          style={{ left: typing.css.x, top: typing.css.y, color, fontSize: 12 + stroke * 2 }}
        />
      )}
      <div role="toolbar" aria-label="Herramientas de anotación"
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
        <button type="button" title="Seleccionar" aria-label="Seleccionar" aria-pressed={tool === 'select'} className={button(tool === 'select')} onClick={() => setTool('select')}>
          <MousePointer2 size={15} />
        </button>
        <button type="button" title="Lápiz" aria-label="Lápiz" aria-pressed={tool === 'pen'} className={button(tool === 'pen')} onClick={() => setTool('pen')}>
          <Pencil size={15} />
        </button>
        <div className={`flex items-center rounded-lg ${SHAPES.some((item) => item.id === tool) ? 'ring-1 ring-[var(--accent-primary)]' : ''}`}>
          <button type="button" title={current.label} aria-label={current.label} aria-pressed={tool === shape} className={button(false)} onClick={() => setTool(shape)}>
            {current.icon}
          </button>
          <Menu label="Formas" trigger={<span className="sr-only">Formas</span>}>
            {(close) => <>
              {SHAPES.map((item) => (
                <button key={item.id} type="button" role="menuitem"
                  onClick={() => { setShape(item.id); setTool(item.id); close(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-input)]">
                  {item.icon}{item.label}
                </button>
              ))}
            </>}
          </Menu>
        </div>
        <button type="button" title="Texto" aria-label="Texto" aria-pressed={tool === 'text'} className={button(tool === 'text')} onClick={() => setTool('text')}>
          <Type size={15} />
        </button>
        <span className="mx-1 h-5 w-px bg-[var(--border-medium)]" aria-hidden="true" />
        <Menu label="Color de tinta" trigger={<span className="size-4 rounded-full border border-[var(--border-medium)]" style={{ background: color }} />}>
          {(close) => <div className="grid grid-cols-4 gap-1 p-1">
            {COLORS.map((item) => (
              <button key={item.value} type="button" role="menuitemradio" aria-checked={item.value === color} aria-label={item.label} title={item.label}
                onClick={() => { setColor(item.value); close(); }}
                className={`size-6 rounded-full border ${item.value === color ? 'ring-2 ring-[var(--accent-primary)]' : 'border-[var(--border-medium)]'}`}
                style={{ background: item.value }} />
            ))}
          </div>}
        </Menu>
        <Menu label="Grosor del trazo" trigger={<span className="block w-5 rounded-full bg-current" style={{ height: Math.max(2, stroke / 2) }} />}>
          {(close) => <>
            {WIDTHS.map((item) => (
              <button key={item.value} type="button" role="menuitemradio" aria-checked={item.value === stroke}
                onClick={() => { setStroke(item.value); close(); }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-input)]">
                <span className="block w-6 rounded-full bg-current" style={{ height: Math.max(2, item.value / 2) }} />{item.label}
              </button>
            ))}
          </>}
        </Menu>
        <button type="button" onClick={submit}
          className="ml-1 h-8 rounded-lg bg-[var(--bg-input)] px-3 text-[13px] text-[var(--text-primary)] hover:bg-[var(--accent-primary)] hover:text-white">
          Agregar al chat
        </button>
        <button type="button" title="Cerrar la anotación" aria-label="Cerrar la anotación" className={button(false)} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
