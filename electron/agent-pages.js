'use strict';

const { sanitizeHtmlForPreview, PREVIEW_CSP_META } = require('../shared/html-sanitizer');

const CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; " +
  "font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; " +
  "base-uri 'none'; form-action 'none'; sandbox allow-scripts";
const SHELL_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'";

const PAGE_STYLES = `
:root {
  color-scheme: light dark;
  --page-background: Canvas;
  --page-text: CanvasText;
  --page-muted: color-mix(in srgb, CanvasText 58%, Canvas);
  --page-line: color-mix(in srgb, CanvasText 12%, Canvas);
  --page-field: color-mix(in srgb, CanvasText 6%, Canvas);
  --page-accent: AccentColor;
  --page-accent-soft: color-mix(in srgb, var(--page-accent) 16%, transparent);
  --page-series-1: var(--page-accent);
  --page-series-2: color-mix(in srgb, var(--page-accent) 62%, var(--page-background));
  --page-series-3: color-mix(in srgb, var(--page-accent) 36%, var(--page-background));
  --page-series-4: color-mix(in srgb, var(--page-text) 40%, var(--page-background));
  --page-series-5: color-mix(in srgb, var(--page-text) 18%, var(--page-background));
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scrollbar-gutter: stable; }
body {
  max-width: 1120px; margin: 0 auto; padding: clamp(24px, 4vw, 56px);
  color: var(--page-text); background: var(--page-background);
  font: 14px/1.6 Inter, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { color: var(--page-text); text-wrap: balance; }
h1 { margin: 0 0 8px; font-size: clamp(24px, 3vw, 32px); font-weight: 600; line-height: 1.2; letter-spacing: -.03em; }
h2 { margin: 0 0 4px; font-size: 16px; font-weight: 600; line-height: 1.4; letter-spacing: -.01em; }
h3 { margin: 20px 0 10px; font-size: 13.5px; font-weight: 600; }
p { margin: 0 0 14px; color: var(--page-muted); text-wrap: pretty; }
small { color: var(--page-muted); font-size: 12px; }
label { display: grid; gap: 6px; color: var(--page-muted); font-size: 12px; line-height: 1.4; }
input, select, button, textarea { font: inherit; }
input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea {
  min-width: 0; width: 100%; min-height: 34px; padding: 7px 11px;
  border: 1px solid transparent; border-radius: 8px;
  background: var(--page-field); color: var(--page-text); font-size: 13px; line-height: 1.4;
}
input::placeholder, textarea::placeholder { color: var(--page-muted); opacity: .7; }
input[type="checkbox"], input[type="radio"], input[type="range"] { accent-color: var(--page-accent); }
button {
  min-height: 32px; padding: 6px 13px; border: 1px solid var(--page-line); border-radius: 8px;
  background: transparent; color: var(--page-text); cursor: pointer; font-size: 13px; line-height: 1.4;
}
button[aria-pressed="true"] { border-color: transparent; background: var(--page-accent-soft); }
button:disabled { opacity: .45; cursor: default; }
:is(input, select, textarea, button, a):focus-visible { outline: 2px solid var(--page-accent); outline-offset: 2px; }
table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; font-variant-numeric: tabular-nums; }
th { padding: 0 14px 10px; border-bottom: 1px solid var(--page-line); color: var(--page-muted); font-size: 12px; font-weight: 500; white-space: nowrap; }
td { padding: 11px 14px; border-bottom: 1px solid var(--page-line); }
tbody tr:last-child td { border-bottom: 0; }
th:first-child, td:first-child { padding-left: 0; }
th:last-child, td:last-child { padding-right: 0; }
:is(th, td).num { text-align: right; }
img, svg, canvas { max-width: 100%; }
svg text { font-family: inherit; font-size: 11px; font-variant-numeric: tabular-nums; fill: var(--page-muted); }
.page-eyebrow { margin: 0 0 10px; color: var(--page-muted); font-size: 11.5px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; }
.page-header { margin-bottom: 32px; }
.page-header p { max-width: 72ch; }
.page-header > :last-child { margin-bottom: 0; }
.page-section { margin-top: 36px; padding-top: 28px; border-top: 1px solid var(--page-line); }
.page-section-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 24px; margin-bottom: 20px; }
.page-section-head p { margin: 0; font-size: 12.5px; }
.page-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 20px; align-items: end; }
.page-filters > button { justify-self: start; }
.page-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.page-chips button { min-height: 30px; padding: 4px 12px; border-radius: 999px; color: var(--page-muted); font-size: 12.5px; }
.page-chips button[aria-pressed="true"] { color: var(--page-text); }
.page-segmented { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--page-field); }
.page-segmented button { min-height: 26px; padding: 3px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--page-muted); font-size: 12.5px; }
.page-segmented button[aria-pressed="true"] { background: var(--page-background); color: var(--page-text); box-shadow: 0 1px 2px rgb(0 0 0 / .14), 0 0 0 1px var(--page-line); }
.page-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 20px 24px; }
.page-metric { display: grid; gap: 2px; min-width: 0; }
.page-metric strong { order: -1; color: var(--page-text); font-size: 28px; font-weight: 600; letter-spacing: -.03em; line-height: 1.2; font-variant-numeric: tabular-nums; }
.page-metric :is(span, small) { color: var(--page-muted); font-size: 12.5px; }
.page-table { overflow-x: auto; }
.page-chart { min-width: 0; color: var(--page-accent); }
.page-chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.page-chart svg .grid { stroke: var(--page-line); }
.page-bars { display: grid; gap: 4px; }
.page-bar { display: grid; grid-template-columns: minmax(90px, 168px) minmax(0, 1fr) minmax(48px, auto); align-items: center; gap: 16px; min-height: 34px; font-size: 13px; }
button.page-bar { width: calc(100% + 16px); margin: 0 -8px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; }
.page-bar > :first-child { overflow: hidden; color: var(--page-text); text-overflow: ellipsis; white-space: nowrap; }
.page-bar-track { height: 8px; overflow: hidden; border-radius: 999px; background: var(--page-field); }
.page-bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--page-accent); }
.page-bar-value { color: var(--page-text); text-align: right; font-variant-numeric: tabular-nums; }
.page-bars:has(.page-bar[aria-pressed="true"]) .page-bar:not([aria-pressed="true"]) { opacity: .42; }
.page-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--page-muted); font-size: 12px; }
.page-legend i { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 2px; background: currentColor; }
.page-badge { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; background: var(--page-field); color: var(--page-muted); font-size: 11.5px; line-height: 1.6; white-space: nowrap; }
.page-footnote { margin: 40px 0 0; padding-top: 14px; border-top: 1px solid var(--page-line); color: var(--page-muted); font-size: 12px; }
@media (hover: hover) and (pointer: fine) {
  button:not(:disabled):not([aria-pressed="true"]):hover { background: var(--page-field); }
  .page-segmented button:not([aria-pressed="true"]):hover { background: transparent; color: var(--page-text); }
  tbody tr:hover { background: color-mix(in srgb, CanvasText 3%, transparent); }
}
@media (max-width: 760px) { .page-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; } }
@media (max-width: 480px) {
  .page-filters { grid-template-columns: 1fr; }
  .page-bar { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; }
  .page-bar-track { grid-column: 1 / -1; grid-row: 2; }
}
@media (prefers-reduced-motion: no-preference) {
  button, input, select, textarea { transition: background-color 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out; }
  .page-bar { transition: opacity 160ms ease-out; }
  .page-bar-fill { transition: width 240ms cubic-bezier(.2, 0, 0, 1); }
}
`;

function encoded(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function documents(page, colorScheme) {
  if (
    !page ||
    page.version !== 1 ||
    typeof page.html !== 'string' ||
    typeof page.script !== 'string' ||
    typeof page.title !== 'string' ||
    !Array.isArray(page.rows) ||
    !Array.isArray(page.columns) ||
    !page.data ||
    typeof page.data !== 'object' ||
    Array.isArray(page.data) ||
    Buffer.byteLength(JSON.stringify(page)) > 5 * 1024 * 1024
  ) {
    throw new Error('La página interactiva no es válida');
  }
  const html = sanitizeHtmlForPreview(page.html).replace(PREVIEW_CSP_META, '');
  const appearance = colorScheme === 'light' || colorScheme === 'dark' ? ` style="color-scheme:${colorScheme}"` : '';
  const title = page.title.replace(
    /[&<>"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character],
  );
  const context = encoded(JSON.stringify({ data: page.data, rows: page.rows, columns: page.columns }));
  const script = `window.AntaresPage = Object.freeze(JSON.parse(${context}));
window.addEventListener('error', () => { document.documentElement.dataset.pageError = 'true'; });
window.addEventListener('unhandledrejection', () => { document.documentElement.dataset.pageError = 'true'; });
const source = URL.createObjectURL(new Blob([${encoded(page.script)}], {type: 'text/javascript'}));
import(source).catch(() => {
  document.documentElement.dataset.pageError = 'true';
  const error = document.createElement('p'); error.role = 'alert';
  error.textContent = 'No se pudo ejecutar la página. Pide al agente que la corrija.';
  document.body.append(error);
}).finally(() => URL.revokeObjectURL(source));`;
  return {
    shell:
      `<!doctype html><html lang="es"${appearance}><meta charset="utf-8"><title>${title}</title>` +
      '<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style>' +
      `<iframe title="${title}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="content.html"></iframe></html>`,
    content:
      `<!doctype html><html lang="es"${appearance}><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
      `<style>${PAGE_STYLES}</style></head><body>` +
      html +
      `<script type="module">${script}</script></body></html>`,
  };
}

const EMBED_SCRIPT = `<script>(() => {
  const report = () => parent.postMessage({ type: 'antares-page-height', height: document.body.getBoundingClientRect().height }, '*');
  new ResizeObserver(report).observe(document.body);
  report();
  const allowed = ['--page-text', '--page-muted', '--page-line', '--page-field', '--page-accent'];
  window.addEventListener('message', (event) => {
    if (event.source !== parent || !event.data || event.data.type !== 'antares-page-theme' || typeof event.data.vars !== 'object') return;
    for (const name of allowed) {
      const value = event.data.vars[name];
      if (typeof value === 'string' && /^[#a-z0-9(),.%\\s-]{1,80}$/i.test(value)) document.documentElement.style.setProperty(name, value);
    }
  });
})();</script>`;

const EMBED_STYLES = `<style>
html, body { background: transparent; }
html { overflow: hidden; }
:root {
  --page-muted: color-mix(in srgb, CanvasText 62%, transparent);
  --page-line: color-mix(in srgb, CanvasText 12%, transparent);
  --page-field: color-mix(in srgb, CanvasText 7%, transparent);
}
body { display: flow-root; max-width: none; padding: 0; }
h1 { font-size: clamp(21px, 2.6vw, 26px); }
.page-header { margin-bottom: 24px; }
.page-section { margin-top: 28px; padding-top: 22px; }
.page-filters { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px 16px; }
.page-metrics { gap: 16px 24px; }
.page-metric strong { font-size: 24px; }
.page-footnote { margin-top: 28px; }
</style>`;

function embedded(page, colorScheme) {
  return documents(page, colorScheme)
    .content.replace('</head>', () => `${EMBED_STYLES}</head>`)
    .replace(/<\/body><\/html>$/, () => `${EMBED_SCRIPT}</body></html>`);
}

function preview(page, colorScheme) {
  const html = documents(page, colorScheme).content.replace('</head>', '<style>html{overflow:hidden}</style></head>');
  return sanitizeHtmlForPreview(html);
}

function scriptSyntaxError(source) {
  if (typeof source !== 'string') return null;
  try {
    new (require('node:vm').Script)(`(async () => {"use strict";\n${source}\n})`, { filename: 'script.js', lineOffset: -1 });
    return null;
  } catch (error) {
    const line = /^script\.js:(\d+)/.exec(String(error.stack))?.[1];
    return `${error.message}${line ? ` (línea ${line})` : ''}`;
  }
}

module.exports = { documents, embedded, preview, scriptSyntaxError, CSP, SHELL_CSP };
