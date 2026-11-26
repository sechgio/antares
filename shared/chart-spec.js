'use strict';

// Contrato compartido del bloque ```chart: validación del JSON y conversión a
// sintaxis Mermaid (xychart/pie) para renderizar con Pele en el chat y en las páginas.

const MAX_POINTS = 120;
const SERIES_LIMIT = 8;

function clean(text) {
  return String(text)
    .replace(/["\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function number(value) {
  return Number.isFinite(value) ? value : 0;
}

function niceTicks(lo, hi) {
  const raw = (hi - lo || 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

function parseChartSpec(source) {
  let raw;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type ?? 'bar';
  if (type !== 'bar' && type !== 'line' && type !== 'pie') return null;
  const labels = Array.isArray(raw.labels) ? raw.labels.slice(0, MAX_POINTS).map(String) : [];
  const series = (Array.isArray(raw.series) ? raw.series : []).slice(0, SERIES_LIMIT).map((item, i) => {
    const entry = item && typeof item === 'object' ? item : {};
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

function horizontalChart(spec) {
  return (
    spec.type === 'bar' &&
    spec.labels.some((label) => label.length > 11) &&
    spec.series.every((s) => s.data.every((v) => v >= 0))
  );
}

// Pasado el límite de la paleta los colores se repetirían; las porciones más
// pequeñas comparten una porción "Otros".
function pieSlices(spec) {
  const { labels } = spec;
  const data = spec.series[0].data;
  if (labels.length <= SERIES_LIMIT) return { labels, data };
  const order = data.map((_, i) => i).sort((a, b) => data[b] - data[a]);
  const kept = order.slice(0, SERIES_LIMIT - 1).sort((a, b) => a - b);
  const rest = order.slice(SERIES_LIMIT - 1).reduce((sum, i) => sum + data[i], 0);
  return { labels: [...kept.map((i) => labels[i]), 'Otros'], data: [...kept.map((i) => data[i]), rest] };
}

function pieToMermaid(spec) {
  const { labels, data } = pieSlices(spec);
  const title = spec.title ? ` title ${clean(spec.title)}` : '';
  const rows = labels.map((label, i) => `  "${clean(label)}" : ${number(data[i])}`);
  return [`pie showData${title}`, ...rows].join('\n');
}

function xyToMermaid(spec) {
  const values = spec.series.flatMap((s) => s.data);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Las barras necesitan línea base en cero; una línea conserva su rango de datos
  // para que los cambios pequeños sigan visibles.
  const ticks =
    spec.type === 'line' && min !== max ? niceTicks(min, max) : niceTicks(Math.min(0, min), Math.max(0, max));
  const lines = [`xychart-beta${horizontalChart(spec) ? ' horizontal' : ''}`];
  if (spec.title) lines.push(`  title "${clean(spec.title)}"`);
  lines.push(`  x-axis [${spec.labels.map((label) => `"${clean(label)}"`).join(', ')}]`);
  lines.push(`  y-axis ${ticks[0]} --> ${ticks[ticks.length - 1]}`);
  const single = spec.series.length === 1;
  spec.series.forEach((s, i) => {
    const named = !single || s.name !== `Serie ${i + 1}`;
    lines.push(`  ${spec.type} ${named ? `"${clean(s.name)}" ` : ''}[${s.data.map(number).join(', ')}]`);
  });
  return lines.join('\n');
}

function chartToMermaid(spec) {
  return spec.type === 'pie' ? pieToMermaid(spec) : xyToMermaid(spec);
}

module.exports = {
  MAX_POINTS,
  SERIES_LIMIT,
  niceTicks,
  parseChartSpec,
  horizontalChart,
  pieSlices,
  chartToMermaid,
};
