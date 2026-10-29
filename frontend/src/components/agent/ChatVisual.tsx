import { memo, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { sanitizeHtmlForPreview } from '../../../../shared/html-sanitizer.js';

type Series = { name: string; data: number[] };
export type ChartSpec = { type: 'bar' | 'line' | 'pie'; title: string; labels: string[]; series: Series[] };

const PALETTE = ['#5E6AD2', '#22C7A9', '#F59E0B', '#EF4444', '#3B82F6', '#A855F7', '#22C55E', '#EC4899'];
const W = 560;
const H = 220;
const PAD = { l: 40, r: 8, t: 10, b: 26 };
const MAX_POINTS = 120;
const GRID = { stroke: 'var(--border-subtle)' };
const AXIS = { fill: 'var(--text-muted)' };

export function parseChart(source: string): ChartSpec | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(source); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type ?? 'bar';
  if (type !== 'bar' && type !== 'line' && type !== 'pie') return null;
  const labels = Array.isArray(raw.labels) ? raw.labels.slice(0, MAX_POINTS).map(String) : [];
  const series = (Array.isArray(raw.series) ? raw.series : []).slice(0, PALETTE.length).map((item, i) => {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return { name: String(entry.name ?? `Serie ${i + 1}`), data: (Array.isArray(entry.data) ? entry.data : []).slice(0, MAX_POINTS).map(Number) };
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
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function Swatch({ color }: { color: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[var(--text-secondary)]">
      {items.map((item) => <li key={item.name} className="flex items-center gap-1.5"><Swatch color={item.color} />{item.name}</li>)}
    </ul>
  );
}

function CartesianChart({ spec }: { spec: ChartSpec }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const values = spec.series.flatMap((s) => s.data);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const band = (W - PAD.l - PAD.r) / spec.labels.length;
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b);
  const x = (i: number) => PAD.l + band * (i + 0.5);
  const step = Math.ceil(spec.labels.length / 10);
  const group = Math.min(band * 0.72, 28 * spec.series.length);
  const barWidth = group / spec.series.length;
  const bar = (left: number, v: number) => {
    const top = y(Math.max(v, 0));
    const bottom = y(Math.min(v, 0));
    const r = Math.max(0, Math.min(3, barWidth / 2 - 1, bottom - top));
    const w = Math.max(barWidth - 2, 1);
    return v >= 0
      ? `M${left},${bottom}V${top + r}Q${left},${top} ${left + r},${top}H${left + w - r}Q${left + w},${top} ${left + w},${top + r}V${bottom}Z`
      : `M${left},${top}V${bottom - r}Q${left},${bottom} ${left + r},${bottom}H${left + w - r}Q${left + w},${bottom} ${left + w},${bottom - r}V${top}Z`;
  };
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title || 'Gráfico'} className="block w-full overflow-visible"
        onMouseLeave={() => setHover(null)}>
        <defs>
          {spec.series.map((_, si) => (
            <linearGradient key={si} id={`${id}-${si}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={PALETTE[si]} stopOpacity={0.18} /><stop offset="1" stopColor={PALETTE[si]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} style={GRID} strokeDasharray={v === 0 ? undefined : '2 4'} />
            <text x={PAD.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" style={AXIS} className="tabular-nums">{format(v)}</text>
          </g>
        ))}
        {spec.labels.map((label, i) => (i % step ? null : (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10.5" style={AXIS}>{short(label)}</text>
        )))}
        {hover !== null && spec.type === 'line' && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} style={GRID} />}
        {spec.type === 'bar' && hover !== null && <rect x={x(hover) - band / 2} y={PAD.t} width={band} height={H - PAD.t - PAD.b} rx={4} fill="var(--text-primary)" opacity={0.04} />}
        {spec.series.map((s, si) => (spec.type === 'bar'
          ? s.data.map((v, i) => (
            <path key={`${si}-${i}`} data-bar d={bar(x(i) - group / 2 + barWidth * si + 1, v)} fill={PALETTE[si]}
              opacity={hover === null || hover === i ? 1 : 0.45} className="transition-opacity duration-150" />
          ))
          : (
            <g key={si}>
              <path d={`M${x(0)},${y(lo < 0 ? 0 : lo)}${s.data.map((v, i) => `L${x(i)},${y(v)}`).join('')}L${x(s.data.length - 1)},${y(lo < 0 ? 0 : lo)}Z`}
                fill={`url(#${id}-${si})`} />
              <polyline points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={PALETTE[si]} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />
              {s.data.map((v, i) => (hover === i || (hover === null && i === s.data.length - 1)
                ? <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill={PALETTE[si]} stroke="var(--bg-elevated)" strokeWidth={2} /> : null))}
            </g>
          )))}
        {spec.labels.map((_, i) => (
          <rect key={i} x={x(i) - band / 2} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <div role="tooltip" className="pointer-events-none absolute top-0 z-10 min-w-[120px] -translate-x-1/2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[11.5px] shadow-lg"
          style={{ left: `${Math.min(Math.max((x(hover) / W) * 100, 14), 86)}%` }}>
          <p className="mb-1 font-medium text-[var(--text-primary)]">{spec.labels[hover]}</p>
          {spec.series.map((s, si) => (
            <p key={si} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Swatch color={PALETTE[si]} /><span className="flex-1">{s.name}</span>
              <span className="tabular-nums font-medium text-[var(--text-primary)]">{format(s.data[hover])}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function DonutChart({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = spec.series[0].data;
  const total = data.reduce((sum, v) => sum + v, 0);
  const R = 80;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const share = (v: number) => `${full.format(Math.round((v / total) * 1000) / 10)} %`;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <svg viewBox="0 0 200 200" role="img" aria-label={spec.title || 'Gráfico'} className="h-full w-full -rotate-90" onMouseLeave={() => setHover(null)}>
          <circle cx={100} cy={100} r={R} fill="none" style={GRID} strokeWidth={22} />
          {data.map((v, i) => {
            const length = (v / total) * C;
            const gap = data.filter((n) => n > 0).length > 1 ? Math.min(2, length / 2) : 0;
            const slice = (
              <circle key={i} data-slice cx={100} cy={100} r={R} fill="none" stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={hover === i ? 26 : 22} strokeDasharray={`${Math.max(length - gap, 0)} ${C}`} strokeDashoffset={-offset}
                opacity={hover === null || hover === i ? 1 : 0.4} className="transition-all duration-150" onMouseEnter={() => setHover(i)} />
            );
            offset += length;
            return v > 0 ? slice : null;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[17px] font-semibold tabular-nums text-[var(--text-primary)]">{format(hover === null ? total : data[hover])}</span>
          <span className="max-w-[90px] truncate text-[10.5px] text-[var(--text-muted)]">{hover === null ? 'Total' : spec.labels[hover]}</span>
        </div>
      </div>
      <ul className="min-w-[160px] flex-1 space-y-1.5 text-[12px]">
        {spec.labels.map((label, i) => (
          <li key={i} className="flex items-center gap-2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
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

function Frame({ lang, source }: { lang: 'svg' | 'html'; source: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const [ready, setReady] = useState(false);
  const doc = useMemo(() => {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || 'CanvasText';
    const base = `<style>html,body{margin:0;background:transparent;color:${color};font:13px system-ui,sans-serif}svg{display:block;max-width:100%;height:auto;margin:auto}</style>`;
    return sanitizeHtmlForPreview(lang === 'html' && /<html[\s>]/i.test(source)
      ? source.replace(/<head[^>]*>/i, (head) => head + base)
      : `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${source}</body></html>`);
  }, [lang, source]);
  const measure = () => {
    const content = ref.current?.contentDocument?.documentElement.scrollHeight;
    if (content) setHeight(Math.min(Math.max(content, 40), 640));
    setReady(true);
  };
  // Sin allow-scripts el contenido no ejecuta código; allow-same-origin solo permite medir su altura.
  return <iframe ref={ref} title={lang === 'svg' ? 'Gráfico' : 'Interfaz'} sandbox="allow-same-origin" srcDoc={doc}
    loading="lazy" onLoad={measure} style={{ height }}
    className={`block w-full border-0 transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`} />;
}

function DataTable({ spec }: { spec: ChartSpec }) {
  return (
    <table className="sr-only">
      <caption>{spec.title || 'Datos del gráfico'}</caption>
      <thead><tr><th scope="col">Etiqueta</th>{spec.series.map((s, i) => <th key={i} scope="col">{s.name}</th>)}</tr></thead>
      <tbody>
        {spec.labels.map((label, i) => (
          <tr key={i}><th scope="row">{label}</th>{spec.series.map((s, si) => <td key={si}>{format(s.data[i])}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

const TAB = 'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors';

function ChatVisual({ lang, source, fallback }: { lang: string; source: string; fallback: ReactNode }) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const spec = useMemo(() => (lang === 'chart' ? parseChart(source) : null), [lang, source]);
  if (lang === 'chart' && !spec) return <>{fallback}</>;
  const title = spec?.title || (lang === 'html' ? 'Interfaz' : lang === 'svg' ? 'Ilustración' : 'Gráfico');
  const legend = spec && spec.type !== 'pie' && spec.series.length > 1 ? spec.series.map((s, i) => ({ name: s.name, color: PALETTE[i] })) : [];
  const copy = () => {
    void navigator.clipboard?.writeText(source).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <section aria-label={title} className="w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text-primary)]">{title}</p>
        <div className="flex rounded-lg bg-[color:color-mix(in_srgb,var(--text-primary)_6%,transparent)] p-0.5">
          {(['Vista', 'Código'] as const).map((label) => {
            const active = (label === 'Código') === showCode;
            return (
              <button key={label} type="button" aria-pressed={active} onClick={() => setShowCode(label === 'Código')}
                className={`${TAB} ${active ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                {label}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={copy} aria-label={copied ? 'Copiado' : 'Copiar código'} title={copied ? 'Copiado' : 'Copiar código'}
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_6%,transparent)] hover:text-[var(--text-primary)]">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </header>
      {showCode
        ? <pre className="max-h-[420px] overflow-auto whitespace-pre p-3 font-mono text-[12px] leading-[18px] text-[var(--text-secondary)]">{source}</pre>
        : (
          <div className="space-y-3 p-3">
            {legend.length > 0 && <Legend items={legend} />}
            {spec ? (spec.type === 'pie' ? <DonutChart spec={spec} /> : <CartesianChart spec={spec} />) : <Frame lang={lang as 'svg' | 'html'} source={source} />}
            {spec && <DataTable spec={spec} />}
          </div>
        )}
    </section>
  );
}

export default memo(ChatVisual, (a, b) => a.lang === b.lang && a.source === b.source);
