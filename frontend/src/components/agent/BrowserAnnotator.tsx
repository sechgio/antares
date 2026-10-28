import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Circle, Loader2, Minus, MousePointer2, Pencil, Square, Type, X } from 'lucide-react';
import type { AgentBrowserElement } from '../../api/agentApi';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import type { AnnotationPage, AnnotationSource } from './annotationSource';
import { annotationNotes, bounds, drawMark, ink, moved, type Mark, type Point } from './annotationMarks';

type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'step';
type Tool = 'select' | 'pen' | 'text' | ShapeKind;

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
const PICK_COLOR = '#3b82f6';

function Menu({ label, trigger, children }: { label: string; trigger: ReactElement; children: (close: () => void) => ReactElement }) {
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({ estimatedWidth: 160, estimatedHeight: 200, direction: 'up', align: 'start' });
  return <>
    <button ref={menu.triggerRef} type="button" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={menu.isOpen}
      onClick={menu.toggle} className="flex h-7 items-center gap-0.5 rounded-md px-1 text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]">
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

function loadImage(base64: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo preparar la página'));
    image.src = `data:image/png;base64,${base64}`;
  });
}

export default function BrowserAnnotator({ source, onPick, onSubmit, onClose }: {
  source: AnnotationSource;
  onPick?: (x: number, y: number) => Promise<AgentBrowserElement | null>;
  onSubmit: (result: { files: File[]; notes: string[] }) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shotRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [shape, setShape] = useState<ShapeKind>('rect');
  const [color, setColor] = useState(COLORS[0].value);
  const [stroke, setStroke] = useState(WIDTHS[1].value);
  const [index, setIndex] = useState(0);
  const [pages, setPages] = useState<Record<number, AnnotationPage>>({});
  const [pageMarks, setPageMarks] = useState<Mark[][]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [typing, setTyping] = useState<{ at: Point; css: Point; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [hover, setHover] = useState<{ from: Point; to: Point } | null>(null);
  const drag = useRef<{ start: Point; last: Point } | null>(null);
  const probe = useRef<{ busy: boolean; next: Point | null; left: boolean }>({ busy: false, next: null, left: false });
  const page = pages[index];
  const width = page?.width ?? 1;
  const height = page?.height ?? 1;
  const marks = pageMarks[index] ?? [];
  const setMarks = (update: (prev: Mark[]) => Mark[]) => setPageMarks((prev) => {
    const next = [...prev];
    next[index] = update(prev[index] ?? []);
    return next;
  });
  const unit = () => {
    const canvas = canvasRef.current;
    return canvas && canvas.clientWidth ? width / canvas.clientWidth : 1;
  };

  useEffect(() => {
    if (pages[index]) return undefined;
    let alive = true;
    void source.page(index).then((next) => { if (alive) setPages((prev) => ({ ...prev, [index]: next })); }).catch(() => {});
    return () => { alive = false; };
  }, [index, pages, source]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, width, height);
    const u = unit();
    marks.forEach((mark, i) => drawMark(ctx, mark, u, i === selected));
    if (draft) drawMark(ctx, draft, u);
    if (hover && tool === 'select') {
      ctx.save();
      ctx.strokeStyle = PICK_COLOR;
      ctx.lineWidth = 1.5 * u;
      ctx.strokeRect(hover.from.x, hover.from.y, hover.to.x - hover.from.x, hover.to.y - hover.from.y);
      ctx.restore();
    }
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
  });

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      css: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      at: { x: (event.clientX - rect.left) * (width / (rect.width || width)), y: (event.clientY - rect.top) * (height / (rect.height || height)) },
    };
  };

  const typed = () => (typing?.text.trim() ? { kind: 'text', color, width: stroke, at: typing.at, text: typing.text.trim() } as Mark : null);

  const commitText = () => {
    const mark = typed();
    if (mark) setMarks((prev) => [...prev, mark]);
    setTyping(null);
  };

  const goTo = (next: number) => {
    commitText();
    setSelected(null);
    setIndex(Math.min(source.count - 1, Math.max(0, next)));
  };

  const area = (info: AgentBrowserElement) => ({
    from: { x: info.box.x * width, y: info.box.y * height },
    to: { x: (info.box.x + info.box.width) * width, y: (info.box.y + info.box.height) * height },
  });

  const pick = async (at: Point) => {
    const info = await onPick?.(at.x / width, at.y / height).catch(() => null);
    if (!info) return;
    setMarks((prev) => prev.some((mark) => mark.kind === 'pick' && mark.info.selector === info.selector) ? prev : [...prev, {
      kind: 'pick', color: PICK_COLOR, width: 2, info, n: prev.filter((mark) => mark.kind === 'pick').length + 1, ...area(info),
    }]);
  };

  const highlight = (at: Point) => {
    const state = probe.current;
    state.next = at;
    state.left = false;
    if (state.busy || !onPick) return;
    state.busy = true;
    void (async () => {
      while (state.next) {
        const next = state.next;
        state.next = null;
        const info = await onPick(next.x / width, next.y / height).catch(() => null);
        if (!state.left) setHover(info ? area(info) : null);
      }
      state.busy = false;
    })();
  };

  const down = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || !page) return;
    event.preventDefault();
    const { at, css } = point(event);
    if (tool === 'text') { commitText(); setTyping({ at, css, text: '' }); return; }
    if (tool === 'step') {
      setMarks((prev) => [...prev, { kind: 'step', color, width: stroke, at, n: prev.filter((mark) => mark.kind === 'step').length + 1 }]);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { start: at, last: at };
    if (tool === 'select') {
      const u = unit();
      const hit = marks.map((mark, i) => ({ box: bounds(mark, u), i }))
        .reverse().find(({ box }) => at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom);
      setSelected(hit ? hit.i : null);
      if (!hit) {
        drag.current = null;
        void pick(at);
      }
      return;
    }
    setDraft(tool === 'pen' ? { kind: 'pen', color, width: stroke, points: [at] } : { kind: tool, color, width: stroke, from: at, to: at });
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = drag.current;
    const { at } = point(event);
    if (!state) {
      if (tool === 'select' && page) highlight(at);
      return;
    }
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
    const empty = !draft || (draft.kind === 'pen' ? draft.points.length < 2
      : 'from' in draft && draft.from.x === draft.to.x && draft.from.y === draft.to.y);
    if (draft && !empty) setMarks((prev) => [...prev, draft]);
    setDraft(null);
  };

  const submit = async () => {
    const pending = typed();
    const all = pageMarks.slice();
    if (pending) all[index] = [...(all[index] ?? []), pending];
    const chosen = Object.keys(pages).map(Number).filter((i) => all[i]?.length);
    const targets = chosen.length ? chosen.sort((a, b) => a - b) : [index];
    setSending(true);
    try {
      const files = await Promise.all(targets.map(async (i) => {
        const target = pages[i];
        const shot = i === index ? shotRef.current : await loadImage(target.png_base64);
        const out = document.createElement('canvas');
        out.width = target.width;
        out.height = target.height;
        const ctx = out.getContext('2d');
        if (!ctx || !shot) throw new Error('No se pudo preparar la anotación');
        ctx.drawImage(shot, 0, 0, target.width, target.height);
        const u = canvasRef.current?.clientWidth ? target.width / canvasRef.current.clientWidth : 1;
        (all[i] ?? []).forEach((mark) => drawMark(ctx, mark, u));
        const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('No se pudo preparar la anotación');
        return new File([blob], source.count > 1 ? `anotacion-p${i + 1}.png` : 'anotacion.png', { type: 'image/png' });
      }));
      onSubmit({ files, notes: annotationNotes(targets.map((i) => all[i] ?? []), source.count > 1) });
    } catch {
      setSending(false);
    }
  };

  const button = (active: boolean) => `flex size-7 items-center justify-center rounded-md transition-colors ${active
    ? 'bg-[color-mix(in_srgb,var(--accent-primary)_28%,transparent)] text-[var(--text-primary)]'
    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'}`;
  const current = SHAPES.find((item) => item.id === shape)!;
  const cursor = tool === 'select' ? (onPick ? 'pointer' : 'default') : tool === 'text' ? 'text' : 'crosshair';
  const selectLabel = onPick ? 'Seleccionar un elemento' : 'Seleccionar';

  return (
    <div role="region" aria-label="Anotar la página" className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-[var(--bg-surface)] [container-type:size]">
      {page ? (
        <div className="relative" style={{ aspectRatio: `${width} / ${height}`, width: `min(100cqw, 100cqh * ${width / height})` }}>
        <img ref={shotRef} src={`data:image/png;base64,${page.png_base64}`} alt={`Página de ${source.name}`} className="pointer-events-none absolute inset-0 size-full" draggable={false} />
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
          onPointerLeave={() => { probe.current.next = null; probe.current.left = true; setHover(null); }}
        />
      {typing && (
        <input
          autoFocus
          aria-label="Texto de la anotación"
          placeholder="Escribe una nota"
          value={typing.text}
          onChange={(event) => setTyping({ ...typing, text: event.target.value })}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commitText(); }
            if (event.key === 'Escape') { event.preventDefault(); setTyping(null); }
          }}
          className="absolute min-w-[120px] rounded-md px-1.5 py-1 font-semibold outline-none placeholder:opacity-70"
          style={{ left: typing.css.x - 6, top: typing.css.y - 6, background: color, color: ink(color), fontSize: 12 + stroke * 2 }}
        />
      )}
        </div>
      ) : (
        <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" aria-label="Cargando la página" />
      )}
      <div role="toolbar" aria-label="Herramientas de anotación"
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
        {source.count > 1 && <>
          <button type="button" aria-label="Página anterior" disabled={index === 0} className={`${button(false)} disabled:opacity-40`} onClick={() => goTo(index - 1)}>
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[44px] text-center text-[12px] tabular-nums text-[var(--text-secondary)]">{index + 1} / {source.count}</span>
          <button type="button" aria-label="Página siguiente" disabled={index === source.count - 1} className={`${button(false)} disabled:opacity-40`} onClick={() => goTo(index + 1)}>
            <ChevronRight size={15} />
          </button>
          <span className="mx-1 h-5 w-px bg-[var(--border-medium)]" aria-hidden="true" />
        </>}
        <button type="button" title={selectLabel} aria-label={selectLabel} aria-pressed={tool === 'select'} className={button(tool === 'select')} onClick={() => setTool('select')}>
          <MousePointer2 size={15} />
        </button>
        <button type="button" title="Lápiz" aria-label="Lápiz" aria-pressed={tool === 'pen'} className={button(tool === 'pen')} onClick={() => setTool('pen')}>
          <Pencil size={15} />
        </button>
        <div className={`flex items-center rounded-md ${SHAPES.some((item) => item.id === tool) ? 'bg-[color-mix(in_srgb,var(--accent-primary)_28%,transparent)]' : ''}`}>
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
        <Menu label="Color y grosor" trigger={<span className="size-3.5 rounded-full border border-[var(--border-medium)]" style={{ background: color }} />}>
          {(close) => <div className="w-[152px]">
            <div className="grid grid-cols-4 gap-1 p-1">
              {COLORS.map((item) => (
                <button key={item.value} type="button" role="menuitemradio" aria-checked={item.value === color} aria-label={item.label} title={item.label}
                  onClick={() => { setColor(item.value); close(); }}
                  className={`size-6 rounded-full border ${item.value === color ? 'ring-2 ring-[var(--accent-primary)]' : 'border-[var(--border-medium)]'}`}
                  style={{ background: item.value }} />
              ))}
            </div>
            <div className="my-1 h-px bg-[var(--border-medium)]" />
            {WIDTHS.map((item) => (
              <button key={item.value} type="button" role="menuitemradio" aria-checked={item.value === stroke}
                onClick={() => { setStroke(item.value); close(); }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-input)]">
                <span className="block w-6 rounded-full bg-current" style={{ height: Math.max(2, item.value / 2) }} />{item.label}
              </button>
            ))}
          </div>}
        </Menu>
        <span className="mx-1 h-5 w-px bg-[var(--border-medium)]" aria-hidden="true" />
        <button type="button" onClick={() => void submit()} disabled={!page || sending}
          className="h-7 whitespace-nowrap rounded-md bg-[var(--text-primary)] px-2.5 text-[12.5px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:opacity-50">
          Agregar al chat
        </button>
        <button type="button" title="Cerrar la anotación" aria-label="Cerrar la anotación" className={button(false)} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
