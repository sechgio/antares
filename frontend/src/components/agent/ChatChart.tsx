import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { chartToMermaid, pieSlices, type ChartSpec } from '../../../../shared/chart-spec.js';

export const PALETTE = ['#5E6AD2', '#22C7A9', '#F59E0B', '#EF4444', '#3B82F6', '#A855F7', '#22C55E', '#EC4899'];

export const PELE_THEME = {
  '--pele-bg': 'var(--bg-elevated)',
  '--pele-fg': 'var(--text-primary)',
  '--pele-muted': 'var(--text-muted)',
  '--pele-line': 'var(--text-muted)',
  '--pele-surface': 'color-mix(in srgb, var(--text-primary) 6%, transparent)',
  '--pele-surface-alt': 'color-mix(in srgb, var(--text-primary) 10%, transparent)',
  '--pele-border': 'color-mix(in srgb, var(--text-primary) 28%, transparent)',
  '--pele-accent': 'var(--accent-primary)',
  '--pele-critical': 'var(--accent-red)',
  ...Object.fromEntries(PALETTE.map((color, i) => [`--pele-series-${i + 1}`, color])),
} as CSSProperties;

const compact = new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
const format = (n: number) => (Math.abs(n) >= 10000 ? compact.format(n) : full.format(n));

// Monta un diagrama con Pele en el elemento referenciado y devuelve el error si no
// se pudo dibujar. onRendered se invoca tras cada render (incluidos los re-render
// por cambio de ancho), cuando el SVG ya está en el DOM.
export function usePeleMount(ref: RefObject<HTMLDivElement | null>, source: string, onRendered?: () => void): string | null {
  const [error, setError] = useState<string | null>(null);
  const rendered = useRef(onRendered);
  rendered.current = onRendered;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    let mounted: { destroy(): void } | undefined;
    const fail = (reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'No se pudo dibujar el diagrama.');
    };
    Promise.all([import('pele/lazy'), import('dompurify')])
      .then(([pele, { default: DOMPurify }]) => {
        if (cancelled) return undefined;
        const purifier = DOMPurify(window);
        return pele.mountAsync(element, source, {
          links: false,
          images: false,
          zoom: { labels: { zoomIn: 'Acercar', zoomOut: 'Alejar', reset: 'Restablecer' } },
          autoDirection: false,
          fontSize: 13,
          sanitize: (svg) =>
            purifier.sanitize(svg, {
              FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset'],
              FORBID_TAGS: ['a', 'image', 'foreignObject', 'style'],
              USE_PROFILES: { svg: true, svgFilters: true },
              RETURN_DOM_FRAGMENT: true,
            }),
          onRender: () => {
            setError(null);
            rendered.current?.();
          },
          onError: fail,
        });
      })
      .then((result) => {
        if (cancelled) result?.destroy();
        else mounted = result;
      }, fail);
    return () => {
      cancelled = true;
      mounted?.destroy();
    };
  }, [ref, source]);
  return error;
}

function Swatch({ color }: { color: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

type Hover = { si: number; i: number; xp: number; y: number };

// Pele reordena las series por tipo (barras antes que líneas) y las porciones de
// pie omiten los valores cero: el emparejamiento con los datos se hace por data-id.
function seriesGroups(root: HTMLElement, spec: ChartSpec): (Element | null)[] {
  const groups = [...root.querySelectorAll('.pele-series')];
  if (groups.length === 0) return [];
  if (spec.series.length === 1) return [groups[0]];
  return spec.series.map((s) => groups.find((group) => group.getAttribute('data-id') === s.name) ?? null);
}

function dim(nodes: Element[], keep: Element | Set<Element> | null) {
  for (const node of nodes) {
    const active = !keep || node === keep || (keep instanceof Set && keep.has(node));
    (node as HTMLElement | SVGElement).style.opacity = active ? '' : '0.35';
  }
}

export function PeleChart({ spec }: { spec: ChartSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const source = useMemo(() => chartToMermaid(spec), [spec]);
  const pie = useMemo(() => (spec.type === 'pie' ? pieSlices(spec) : null), [spec]);
  const attach = () => {
    const root = ref.current;
    const wrapper = box.current;
    if (!root || !wrapper) return;
    const place = (el: Element, si: number, i: number) => {
      const bounds = wrapper.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2 - bounds.left;
      setHover({ si, i, xp: bounds.width ? (x / bounds.width) * 100 : 50, y: rect.top - bounds.top });
    };
    if (pie) {
      const slices = [...root.querySelectorAll('.pele-slice')];
      for (const slice of slices) {
        const i = pie.labels.indexOf(slice.getAttribute('data-id') ?? '');
        if (i < 0) continue;
        slice.addEventListener('mouseenter', () => {
          dim(slices, slice);
          place(slice, 0, i);
        });
        slice.addEventListener('mouseleave', () => {
          dim(slices, null);
          setHover(null);
        });
      }
      return;
    }
    const groups = seriesGroups(root, spec);
    const points = groups.flatMap((group) => (group ? [...group.querySelectorAll('rect, circle')] : []));
    groups.forEach((group, si) => {
      group?.querySelectorAll('rect, circle').forEach((el, i) => {
        el.addEventListener('mouseenter', () => {
          dim(points, el);
          place(el, si, i);
        });
        el.addEventListener('mouseleave', () => {
          dim(points, null);
          setHover(null);
        });
      });
    });
    // La leyenda sigue el orden de entrada; al pasar sobre una serie se atenúan las demás.
    root.querySelectorAll('.pele-legend-item').forEach((item, si) => {
      const group = groups[si];
      if (!group) return;
      item.addEventListener('mouseenter', () => dim(points, new Set(group.querySelectorAll('rect, circle'))));
      item.addEventListener('mouseleave', () => dim(points, null));
    });
  };
  const error = usePeleMount(ref, source, attach);
  const total = pie ? pie.data.reduce((sum, v) => sum + v, 0) : 0;
  return (
    <div
      ref={box}
      className="relative [&_.pele-zoom]:opacity-0 [&_.pele-zoom]:transition-opacity hover:[&_.pele-zoom]:opacity-100 focus-within:[&_.pele-zoom]:opacity-100"
      data-chart
    >
      {error && (
        <div>
          <p className="mb-1 text-[11.5px] text-[var(--accent-red)]">No se pudo dibujar el gráfico: {error}</p>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-[18px] text-[var(--text-secondary)]">
            {source}
          </pre>
        </div>
      )}
      <div ref={ref} hidden={error !== null} style={PELE_THEME} className="[&_svg]:max-w-full" />
      {hover !== null && !error && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 min-w-[132px] rounded-lg border border-[color:color-mix(in_srgb,var(--text-primary)_12%,transparent)] bg-[var(--bg-input)] px-3 py-2 text-[11.5px] shadow-lg"
          style={{
            left: `${Math.min(Math.max(hover.xp, 14), 86)}%`,
            top: Math.max(hover.y - 8, 0),
            transform: 'translate(-50%, -100%)',
          }}
        >
          {pie ? (
            <>
              <p className="mb-1.5 flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                <Swatch color={PALETTE[hover.i % PALETTE.length]} />
                {pie.labels[hover.i]}
              </p>
              <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <span className="flex-1">Participación</span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {format(pie.data[hover.i])} · {full.format(Math.round((pie.data[hover.i] / total) * 1000) / 10)} %
                </span>
              </p>
            </>
          ) : (
            <>
              <p className="mb-1.5 font-medium text-[var(--text-primary)]">{spec.labels[hover.i]}</p>
              {spec.series.map((s, si) => (
                <p key={si} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <Swatch color={PALETTE[si % PALETTE.length]} />
                  <span className="flex-1">{s.name}</span>
                  <span className="tabular-nums font-medium text-[var(--text-primary)]">{format(s.data[hover.i])}</span>
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function DataTable({ spec }: { spec: ChartSpec }) {
  return (
    <table className="sr-only">
      <caption>{spec.title || 'Datos del gráfico'}</caption>
      <thead>
        <tr>
          <th scope="col">Etiqueta</th>
          {spec.series.map((s, i) => (
            <th key={i} scope="col">
              {s.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {spec.labels.map((label, i) => (
          <tr key={i}>
            <th scope="row">{label}</th>
            {spec.series.map((s, si) => (
              <td key={si}>{format(s.data[i])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
