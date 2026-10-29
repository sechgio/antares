'use strict';

const { sanitizeHtmlForPreview, PREVIEW_CSP_META } = require('../shared/html-sanitizer');

const CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; "
  + "font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; "
  + "base-uri 'none'; form-action 'none'; sandbox allow-scripts";
const SHELL_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'";

const PAGE_STYLES = `
:root {
  color-scheme: light dark;
  --page-background: Canvas;
  --page-text: CanvasText;
  --page-muted: color-mix(in srgb, CanvasText 58%, Canvas);
  --page-line: color-mix(in srgb, CanvasText 12%, Canvas);
  --page-field: color-mix(in srgb, CanvasText 6%, Canvas);
  --page-accent: AccentColor;
}
* { box-sizing: border-box; }
html { scrollbar-gutter: stable; }
body {
  max-width: 1200px; margin: 0 auto; padding: clamp(24px, 4vw, 56px);
  color: var(--page-text); background: var(--page-background);
  font: 14px/1.6 Inter, ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { color: var(--page-text); text-wrap: balance; }
h1 { margin: 0 0 12px; font-size: clamp(25px, 3vw, 34px); font-weight: 600; line-height: 1.2; letter-spacing: -.035em; }
h2 { margin: 36px 0 18px; font-size: 19px; font-weight: 600; line-height: 1.35; letter-spacing: -.02em; }
h3 { margin: 24px 0 12px; font-size: 14px; font-weight: 600; }
p { margin: 0 0 16px; color: var(--page-muted); }
small { color: var(--page-muted); font-size: 12px; }
label { display: grid; gap: 7px; color: var(--page-muted); font-size: 12px; line-height: 1.4; }
input, select, button, textarea { font: inherit; }
input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea {
  min-width: 0; width: 100%; min-height: 36px; padding: 8px 11px;
  border: 1px solid transparent; border-radius: 8px;
  background: var(--page-field); color: var(--page-text); font-size: 13px; line-height: 1.4;
}
input::placeholder, textarea::placeholder { color: var(--page-muted); opacity: .7; }
input[type="checkbox"], input[type="radio"], input[type="range"] { accent-color: var(--page-accent); }
button {
  min-height: 36px; padding: 8px 14px; border: 1px solid var(--page-line); border-radius: 8px;
  background: transparent; color: var(--page-text); cursor: pointer; font-size: 13px; line-height: 1.4;
}
button:disabled { opacity: .45; cursor: default; }
:is(input, select, textarea, button, a):focus-visible { outline: 2px solid var(--page-accent); outline-offset: 3px; }
table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; font-variant-numeric: tabular-nums; }
th { padding: 11px 14px; color: var(--page-muted); font-size: 11px; font-weight: 500; white-space: nowrap; }
td { padding: 12px 14px; border-top: 1px solid var(--page-line); }
th:first-child, td:first-child { padding-left: 0; }
th:last-child, td:last-child { padding-right: 0; }
img, svg, canvas { max-width: 100%; }
svg text { font-family: inherit; font-variant-numeric: tabular-nums; }
.page-header { margin-bottom: 38px; }
.page-header p { max-width: 76ch; }
.page-section { margin-top: 38px; }
.page-section > :is(h2, h3):first-child { margin-top: 0; }
.page-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 24px; align-items: end; }
.page-filters > button { justify-self: start; }
.page-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 24px; margin: 24px 0 32px; }
.page-metric { display: grid; gap: 5px; padding: 8px 0; }
.page-metric strong { font-size: 28px; font-weight: 550; letter-spacing: -.035em; line-height: 1.2; font-variant-numeric: tabular-nums; }
.page-metric :is(span, small) { color: var(--page-muted); font-size: 12px; }
.page-table { overflow-x: auto; }
.page-chart { min-width: 0; margin-top: 24px; }
@media (hover: hover) and (pointer: fine) {
  button:not(:disabled):hover { background: var(--page-field); }
  tbody tr:hover { background: color-mix(in srgb, CanvasText 3%, Canvas); }
}
@media (max-width: 760px) { .page-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; } }
@media (max-width: 480px) { .page-filters { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: no-preference) {
  button, input, select, textarea { transition: background-color 120ms ease-out, border-color 120ms ease-out; }
}
`;

function encoded(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function documents(page, colorScheme) {
  if (!page || page.version !== 1 || typeof page.html !== 'string' || typeof page.script !== 'string'
    || typeof page.title !== 'string' || !Array.isArray(page.rows) || !Array.isArray(page.columns)
    || !page.data || typeof page.data !== 'object' || Array.isArray(page.data)
    || Buffer.byteLength(JSON.stringify(page)) > 5 * 1024 * 1024) {
    throw new Error('La página interactiva no es válida');
  }
  const html = sanitizeHtmlForPreview(page.html).replace(PREVIEW_CSP_META, '');
  const appearance = colorScheme === 'light' || colorScheme === 'dark' ? ` style="color-scheme:${colorScheme}"` : '';
  const title = page.title.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
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
    shell: `<!doctype html><html lang="es"${appearance}><meta charset="utf-8"><title>${title}</title>`
      + '<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style>'
      + `<iframe title="${title}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="content.html"></iframe></html>`,
    content: `<!doctype html><html lang="es"${appearance}><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`
      + `<style>${PAGE_STYLES}</style></head><body>`
      + html + `<script type="module">${script}</script></body></html>`,
  };
}

// En el chat la página adopta los colores de Antares que envía el padre; solo se aceptan estas variables y valores de color.
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
h1 { font-size: clamp(22px, 2.6vw, 28px); }
h2 { margin: 28px 0 14px; font-size: 17px; }
.page-header { margin-bottom: 24px; }
.page-section { margin-top: 28px; }
.page-filters { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px 16px; }
.page-metrics { gap: 16px 24px; margin: 16px 0 20px; }
.page-metric strong { font-size: 24px; }
</style>`;

function embedded(page, colorScheme) {
  return documents(page, colorScheme).content.replace('</head>', () => `${EMBED_STYLES}</head>`)
    .replace(/<\/body><\/html>$/, () => `${EMBED_SCRIPT}</body></html>`);
}

function preview(page, colorScheme) {
  const html = documents(page, colorScheme).content.replace('</head>', '<style>html{overflow:hidden}</style></head>');
  return sanitizeHtmlForPreview(html);
}

module.exports = { documents, embedded, preview, CSP, SHELL_CSP };
