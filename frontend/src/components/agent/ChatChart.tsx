import { useEffect, useId, useRef, useState } from 'react';

type Series = { name: string; data: number[] };
export type ChartSpec = { type: 'bar' | 'line' | 'pie'; title: string; labels: string[]; series: Series[] };

export const PALETTE = ['#5E6AD2', '#22C7A9', '#F59E0B', '#EF4444', '#3B82F6', '#A855F7', '#22C55E', '#EC4899'];
const CHART_WIDTH = 560;
const H = 220;
const PAD = { t: 12, b: 28 };
const CHAR = 6.2;
const INSET = 14;
const MAX_POINTS = 120;
const GRID = { stroke: 'color-mix(in srgb, var(--text-primary) 8%, transparent)' };
const BASELINE = { stroke: 'color-mix(in srgb, var(--text-primary) 22%, transparent)' };
const AXIS = { fill: 'var(--text-muted)' };

export function parseChart(source: string): ChartSpec | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type ?? 'bar';
  if (type !== 'bar' && type !== 'line' && type !== 'pie') return null;
  const labels = Array.isArray(raw.labels) ? raw.labels.slice(0, MAX_POINTS).map(String) : [];
  const series = (Array.isArray(raw.series) ? raw.series : []).slice(0, PALETTE.length).map((item, i) => {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      name: String(entry.name ?? `Serie ${i + 1}`),
      data: (Array.isArray(entry.data) ? entry.data : []).slice(0, MAX_POINTS).map(Number),
    };
  });
  if (!labels.length || !series.length) return null;
  if (series.some((s) => s.data.length !== labels.length || s.data.some((v) => !Number.isFinite(v)))) return null;
  if (type === 'pie' && (series[0].data.some((v) => v < 0) || !series[0].data.some((v) => v > 0))) return null;
  return { type, title: raw.title ? String(raw.title) : '', labels, series };
}

const compact = new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
const format = (n: number) => (Math.abs(n) >= 10000 ? compact.format(n) : full.format(n));
const short = (label: string) => (label.length > 11 ? `${label.slice(0, 10)}…` : label);

export function niceTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo || 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step)
    ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function Swatch({ color }: { color: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[var(--text-secondary)]">
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-1.5">
          <Swatch color={item.color} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

export function CartesianChart({ spec }: { spec: ChartSpec }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Drawn at the real width so axis text keeps its size in a narrow chat.
  const [W, setWidth] = useState(CHART_WIDTH);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width > 0) setWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const values = spec.series.flatMap((s) => s.data);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Bars need a zero baseline; a line keeps its data range so small changes stay visible.
  const ticks =
    spec.type === 'line' && min !== max ? niceTicks(min, max) : niceTicks(Math.min(0, min), Math.max(0, max));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const count = spec.labels.length;
  const line = spec.type === 'line';
  const last = count - 1;
  // A single line is labeled at its end, so the plot leaves room for that value.
  const endLabel = line && spec.series.length === 1 ? format(spec.series[0].data[last]) : null;
  const left = Math.ceil(Math.max(...ticks.map((v) => format(v).length)) * CHAR) + 12;
  const right = endLabel ? Math.ceil(endLabel.length * CHAR) + 12 : 4;
  const plot = W - left - right;
  // Bars sit in equal bands; a line runs edge to edge with a small inset.
  const band = line ? (count > 1 ? (plot - 2 * INSET) / last : plot) : plot / count;
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b);
  const x = (i: number) => (line ? (count > 1 ? left + INSET + band * i : left + plot / 2) : left + band * (i + 0.5));
  const labelWidth = Math.max(...spec.labels.map((label) => short(label).length)) * CHAR + 14;
  const step = Math.max(1, Math.ceil(labelWidth / band));
  const barWidth = Math.min((band * 0.72) / spec.series.length, 24);
  const group = barWidth * spec.series.length;
  const bar = (start: number, v: number) => {
    const top = y(Math.max(v, 0));
    const bottom = y(Math.min(v, 0));
    const r = Math.max(0, Math.min(4, barWidth / 2 - 1, bottom - top));
    const w = Math.max(barWidth - 2, 1);
    return v >= 0
      ? `M${start},${bottom}V${top + r}Q${start},${top} ${start + r},${top}H${start + w - r}Q${start + w},${top} ${start + w},${top + r}V${bottom}Z`
      : `M${start},${top}V${bottom - r}Q${start},${bottom} ${start + r},${bottom}H${start + w - r}Q${start + w},${bottom} ${start + w},${bottom - r}V${top}Z`;
  };
  return (
    <div ref={box} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={spec.title || 'Gráfico'}
        className="block w-full overflow-visible"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {spec.series.map((_, si) => (
            <linearGradient key={si} id={`${id}-${si}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={PALETTE[si]} stopOpacity={0.18} />
              <stop offset="1" stopColor={PALETTE[si]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={W - right}
              y1={y(v)}
              y2={y(v)}
              style={v === 0 || (v === lo && lo > 0) ? BASELINE : GRID}
              shapeRendering="crispEdges"
            />
            <text x={left - 10} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" style={AXIS} className="tabular-nums">
              {format(v)}
            </text>
          </g>
        ))}
        {spec.labels.map((label, i) =>
          (last - i) % step ? null : (
            <text key={i} x={x(i)} y={H - 9} textAnchor="middle" fontSize="10.5" style={AXIS}>
              {short(label)}
            </text>
          ),
        )}
        {hover !== null && spec.type === 'line' && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} style={BASELINE} strokeDasharray="3 3" />
        )}
        {spec.type === 'bar' && hover !== null && (
          <rect
            x={x(hover) - band / 2}
            y={PAD.t}
            width={band}
            height={H - PAD.t - PAD.b}
            rx={4}
            fill="var(--text-primary)"
            opacity={0.04}
          />
        )}
        {spec.series.map((s, si) =>
          spec.type === 'bar' ? (
            s.data.map((v, i) => (
              <path
                key={`${si}-${i}`}
                data-bar
                d={bar(x(i) - group / 2 + barWidth * si + 1, v)}
                fill={PALETTE[si]}
                opacity={hover === null || hover === i ? 1 : 0.45}
                className="transition-opacity duration-150"
              />
            ))
          ) : (
            <g key={si}>
              <path
                d={`M${x(0)},${y(lo)}${s.data.map((v, i) => `L${x(i)},${y(v)}`).join('')}L${x(s.data.length - 1)},${y(lo)}Z`}
                fill={`url(#${id}-${si})`}
              />
              <polyline
                points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                fill="none"
                stroke={PALETTE[si]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.data.map((v, i) =>
                hover === i || (hover === null && i === s.data.length - 1) ? (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(v)}
                    r={4}
                    fill={PALETTE[si]}
                    stroke="var(--bg-elevated)"
                    strokeWidth={2}
                  />
                ) : null,
              )}
              {endLabel && (
                <text
                  x={x(last) + 10}
                  y={y(s.data[last]) + 3.5}
                  fontSize="11"
                  fontWeight={600}
                  fill="var(--text-primary)"
                  className="tabular-nums"
                >
                  {endLabel}
                </text>
              )}
            </g>
          ),
        )}
        {spec.labels.map((_, i) => (
          <rect
            key={i}
            x={x(i) - band / 2}
            y={PAD.t}
            width={band}
            height={H - PAD.t - PAD.b}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 min-w-[132px] -translate-x-1/2 rounded-lg border border-[color:color-mix(in_srgb,var(--text-primary)_12%,transparent)] bg-[var(--bg-input)] px-3 py-2 text-[11.5px] shadow-lg"
          style={{ left: `${Math.min(Math.max((x(hover) / W) * 100, 14), 86)}%` }}
        >
          <p className="mb-1.5 font-medium text-[var(--text-primary)]">{spec.labels[hover]}</p>
          {spec.series.map((s, si) => (
            <p key={si} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Swatch color={PALETTE[si]} />
              <span className="flex-1">{s.name}</span>
              <span className="tabular-nums font-medium text-[var(--text-primary)]">{format(s.data[hover])}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function horizontal(spec: ChartSpec): boolean {
  return (
    spec.type === 'bar' &&
    spec.labels.some((label) => label.length > 11) &&
    spec.series.every((s) => s.data.every((v) => v >= 0))
  );
}

export function HorizontalBars({ spec }: { spec: ChartSpec }) {
  const max = Math.max(...spec.series.flatMap((s) => s.data)) || 1;
  // Every row shares the longest label's width, capped so the bars keep most of the space.
  const columns = `min(${Math.max(...spec.labels.map((label) => label.length)) + 1}ch, 40%) 1fr`;
  return (
    <ul role="img" aria-label={spec.title || 'Gráfico'} className="flex flex-col gap-2.5">
      {spec.labels.map((label, i) => (
        <li key={i} className="grid items-center gap-4 text-[11.5px]" style={{ gridTemplateColumns: columns }}>
          <span className="truncate text-[var(--text-secondary)]" title={label}>
            {label}
          </span>
          <span className="space-y-1">
            {spec.series.map((s, si) => (
              <span key={si} className="flex items-center gap-2" title={`${s.name}: ${format(s.data[i])}`}>
                <span className="min-w-0 flex-1">
                  <span
                    data-bar
                    className="block h-2.5 rounded-r"
                    style={{
                      width: `${(s.data[i] / max) * 100}%`,
                      minWidth: s.data[i] > 0 ? 2 : 0,
                      background: PALETTE[si],
                    }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right tabular-nums text-[var(--text-primary)]">
                  {format(s.data[i])}
                </span>
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function donutSlices(spec: ChartSpec): { labels: string[]; data: number[] } {
  const { labels } = spec;
  const data = spec.series[0].data;
  if (labels.length <= PALETTE.length) return { labels, data };
  // Past the palette, colors would repeat; the smallest slices share one "Otros" slice.
  const order = data.map((_, i) => i).sort((a, b) => data[b] - data[a]);
  const kept = order.slice(0, PALETTE.length - 1).sort((a, b) => a - b);
  const rest = order.slice(PALETTE.length - 1).reduce((sum, i) => sum + data[i], 0);
  return { labels: [...kept.map((i) => labels[i]), 'Otros'], data: [...kept.map((i) => data[i]), rest] };
}

export function DonutChart({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = useState<number | null>(null);
  const { labels, data } = donutSlices(spec);
  const total = data.reduce((sum, v) => sum + v, 0);
  const R = 80;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const share = (v: number) => `${full.format(Math.round((v / total) * 1000) / 10)} %`;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={spec.title || 'Gráfico'}
          className="h-full w-full -rotate-90"
          onMouseLeave={() => setHover(null)}
        >
          <circle cx={100} cy={100} r={R} fill="none" style={GRID} strokeWidth={22} />
          {data.map((v, i) => {
            const length = (v / total) * C;
            const gap = data.filter((n) => n > 0).length > 1 ? Math.min(2, length / 2) : 0;
            const slice = (
              <circle
                key={i}
                data-slice
                cx={100}
                cy={100}
                r={R}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={hover === i ? 26 : 22}
                strokeDasharray={`${Math.max(length - gap, 0)} ${C}`}
                strokeDashoffset={-offset}
                opacity={hover === null || hover === i ? 1 : 0.4}
                className="transition-[stroke-width,opacity] duration-150"
                onMouseEnter={() => setHover(i)}
              />
            );
            offset += length;
            return v > 0 ? slice : null;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[17px] font-semibold tabular-nums text-[var(--text-primary)]">
            {format(hover === null ? total : data[hover])}
          </span>
          <span className="max-w-[90px] truncate text-[10.5px] text-[var(--text-muted)]">
            {hover === null ? 'Total' : labels[hover]}
          </span>
        </div>
      </div>
      <ul className="flex min-w-[160px] flex-1 flex-col gap-1.5 text-[12px]">
        {labels.map((label, i) => (
          <li
            key={i}
            className="flex items-center gap-2"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <Swatch color={PALETTE[i % PALETTE.length]} />
            <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{label}</span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">{format(data[i])}</span>
            <span className="w-12 text-right tabular-nums text-[var(--text-muted)]">{share(data[i])}</span>
          </li>
        ))}
      </ul>
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
