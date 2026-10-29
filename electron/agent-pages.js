'use strict';

const { sanitizeHtmlForPreview, PREVIEW_CSP_META } = require('../shared/html-sanitizer');

const CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; "
  + "font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; "
  + "base-uri 'none'; form-action 'none'; sandbox allow-scripts";
const SHELL_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'";

function encoded(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function documents(page) {
  if (!page || page.version !== 1 || typeof page.html !== 'string' || typeof page.script !== 'string'
    || typeof page.title !== 'string' || !Array.isArray(page.rows) || !Array.isArray(page.columns)
    || !page.data || typeof page.data !== 'object' || Array.isArray(page.data)
    || Buffer.byteLength(JSON.stringify(page)) > 5 * 1024 * 1024) {
    throw new Error('La página interactiva no es válida');
  }
  const html = sanitizeHtmlForPreview(page.html).replace(PREVIEW_CSP_META, '');
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
    shell: `<!doctype html><html lang="es"><meta charset="utf-8"><title>${title}</title>`
      + '<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style>'
      + `<iframe title="${title}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="content.html"></iframe></html>`,
    content: '<!doctype html><html lang="es"><head><meta charset="utf-8">'
      + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`
      + '<style>:root{color-scheme:light dark}body{margin:0;padding:24px;font:14px/1.5 system-ui;color:CanvasText;background:Canvas}'
      + '*{box-sizing:border-box}input,select,button{font:inherit}img,svg,canvas{max-width:100%}</style></head><body>'
      + html + `<script type="module">${script}</script></body></html>`,
  };
}

module.exports = { documents, CSP, SHELL_CSP };
