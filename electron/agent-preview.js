'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');

// Vista previa de HTML como la de Claude Code: un servidor estático solo en
// loopback que sirve la carpeta del archivo. La ruta lleva un prefijo aleatorio
// para que ninguna otra página abierta en el navegador pueda adivinarla.
const HOST = '127.0.0.1';
const RELOAD_DEBOUNCE_MS = 150;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.xml': 'application/xml; charset=utf-8',
};

let server = null;
let starting = null;
let origin = '';
let token = '';
let root = '';
let fileRoot = '';
let watcher = null;
let reloadTimer = null;
let onChange = null;
const pages = new Map();

function key(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function inside(target, base) {
  const t = key(target);
  const b = key(base).replace(/[\\/]+$/, '');
  return t === b || t.startsWith(b + path.sep);
}

function hosts() {
  const { port } = server.address();
  return new Set([`${HOST}:${port}`, `localhost:${port}`]);
}

async function handle(req, res) {
  const deny = (status) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(String(status)); };
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405);
  // Un dominio que resuelva a 127.0.0.1 (rebinding) llega con su propio Host.
  if (!hosts().has(String(req.headers.host || '').toLowerCase())) return deny(403);
  const page = pages.get(String(req.url || '').split(/[?#]/)[0]);
  if (page) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': page.csp,
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()' });
    return res.end(req.method === 'HEAD' ? undefined : page.html);
  }
  const prefix = `/${token}/`;
  const pathname = String(req.url || '').split(/[?#]/)[0];
  if (!root || !pathname.startsWith(prefix)) return deny(404);
  let rel;
  try { rel = decodeURIComponent(pathname.slice(prefix.length)); } catch { return deny(400); }
  if (rel.includes('\0')) return deny(400);
  let target = path.resolve(root, rel || '.');
  if (!inside(target, root)) return deny(404);
  try {
    // Un enlace simbólico dentro de la carpeta no puede sacar archivos de ella.
    const realRoot = await fs.promises.realpath(root);
    let real = await fs.promises.realpath(target);
    if (!inside(real, realRoot)) return deny(404);
    let stat = await fs.promises.stat(real);
    if (stat.isDirectory()) {
      target = path.join(real, 'index.html');
      real = await fs.promises.realpath(target);
      if (!inside(real, realRoot)) return deny(404);
      stat = await fs.promises.stat(real);
    }
    if (!stat.isFile()) return deny(404);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
  } catch {
    deny(404);
  }
}

function listen() {
  if (server) return Promise.resolve();
  if (starting) return starting;
  const created = http.createServer((req, res) => { handle(req, res).catch(() => res.destroy()); });
  starting = new Promise((resolve, reject) => {
    created.once('error', reject);
    created.listen(0, HOST, () => {
      created.removeListener('error', reject);
      created.unref();
      server = created;
      origin = `http://${HOST}:${created.address().port}`;
      resolve();
    });
  }).finally(() => { starting = null; });
  return starting;
}

function stopWatching() {
  clearTimeout(reloadTimer);
  reloadTimer = null;
  if (watcher) { try { watcher.close(); } catch { } }
  watcher = null;
}

// Recarga en vivo: cualquier cambio en la carpeta servida avisa una sola vez
// por ráfaga de guardados.
function watch(dir) {
  stopWatching();
  try {
    watcher = fs.watch(dir, { recursive: true }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { reloadTimer = null; if (onChange) onChange(); }, RELOAD_DEBOUNCE_MS);
    });
    watcher.on('error', stopWatching);
  } catch {
    watcher = null;
  }
}

function setRoot(dir) {
  if (root && key(root) === key(dir)) return;
  // Cada carpeta tiene su propio prefijo: una URL vieja no abre otra carpeta.
  token = crypto.randomBytes(16).toString('hex');
  root = dir;
  fileRoot = '';
  watch(dir);
}

// Devuelve la URL de vista previa del archivo; sin servidor (no pudo escuchar)
// cae a file:// confinado a la misma carpeta.
async function open(file, { onReload } = {}) {
  const dir = path.dirname(file);
  onChange = onReload || null;
  try {
    await listen();
  } catch {
    if (!fileRoot || key(fileRoot) !== key(dir)) {
      root = '';
      fileRoot = dir;
      watch(dir);
    }
    return { url: pathToFileURL(file).href, root: dir, server: false };
  }
  setRoot(dir);
  const rel = path.relative(dir, file).split(path.sep).map(encodeURIComponent).join('/');
  return { url: `${origin}/${token}/${rel}`, root: dir, server: true };
}

function owns(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === 'file:') {
    if (!fileRoot) return false;
    try { return inside(fileURLToPath(parsed), fileRoot); } catch { return false; }
  }
  return isPage(url) || (!!server && !!root && parsed.origin === origin && parsed.pathname.startsWith(`/${token}/`));
}

async function openPage(page, colorScheme) {
  const { documents, CSP, SHELL_CSP } = require('./agent-pages');
  const rendered = documents(page, colorScheme);
  await listen();
  const prefix = `/page/${crypto.randomBytes(16).toString('hex')}/`;
  pages.set(`${prefix}index.html`, { html: rendered.shell, csp: SHELL_CSP });
  pages.set(`${prefix}content.html`, { html: rendered.content, csp: CSP });
  while (pages.size > 16) pages.delete(pages.keys().next().value);
  return `${origin}${prefix}index.html`;
}

async function embedPage(page, colorScheme) {
  const { embedded, CSP } = require('./agent-pages');
  const html = embedded(page, colorScheme);
  await listen();
  const pathname = `/page/${crypto.randomBytes(16).toString('hex')}/content.html`;
  pages.set(pathname, { html, csp: CSP });
  while (pages.size > 16) pages.delete(pages.keys().next().value);
  return `${origin}${pathname}`;
}

function isPage(url) {
  try {
    const parsed = new URL(url);
    return !!server && parsed.origin === origin && pages.has(parsed.pathname);
  } catch { return false; }
}

function releasePage(url) {
  if (!isPage(url)) return;
  const prefix = new URL(url).pathname.replace(/[^/]+$/, '');
  pages.delete(`${prefix}index.html`);
  pages.delete(`${prefix}content.html`);
}

function close() {
  stopWatching();
  if (server) server.close();
  server = null;
  origin = '';
  token = '';
  root = '';
  fileRoot = '';
  onChange = null;
  pages.clear();
}

module.exports = { open, owns, openPage, embedPage, isPage, releasePage, close };
