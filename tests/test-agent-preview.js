'use strict';

const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

// el navegador del agente resuelve el DNS de cada destino: en los tests
// toda resolución es pública
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node:dns') {
    return { promises: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { assert, finish, stubModule, installInertTimers } = require('./helpers/harness');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-preview-'));
process.env.LOCALAPPDATA = root;
const site = path.join(root, 'site');
fs.mkdirSync(path.join(site, 'css'), { recursive: true });
fs.writeFileSync(path.join(site, 'index.html'), '<h1>Hola</h1>');
fs.writeFileSync(path.join(site, 'css', 'app.css'), 'h1{color:red}');
fs.writeFileSync(path.join(root, 'secreto.txt'), 'fuera');

const preview = require('../electron/agent-preview');
const browser = require('../electron/agent-browser');

function get(url, { method = 'GET', host, rawPath } = {}) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: parsed.hostname, port: parsed.port, method, path: rawPath || parsed.pathname,
      headers: host ? { Host: host } : {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function serverTest() {
  let reloads = 0;
  const opened = await preview.open(path.join(site, 'index.html'), { onReload: () => { reloads += 1; } });
  const url = new URL(opened.url);
  assert(opened.server && url.hostname === '127.0.0.1' && /^\/[0-9a-f]{32}\/index\.html$/.test(url.pathname),
    'la vista previa se sirve en loopback con un prefijo aleatorio');
  const page = await get(opened.url);
  assert(page.status === 200 && page.body === '<h1>Hola</h1>' && page.type.startsWith('text/html'),
    'sirve el HTML con su tipo');
  const css = await get(new URL('css/app.css', opened.url).href);
  assert(css.status === 200 && css.type.startsWith('text/css'), 'sirve los recursos relativos de la carpeta');
  const folder = await get(new URL('./', opened.url).href);
  assert(folder.status === 200 && folder.body === '<h1>Hola</h1>', 'una carpeta sirve su index.html');
  const prefix = url.pathname.split('/')[1];
  const escaped = await get(opened.url, { rawPath: `/${prefix}/%2e%2e/secreto.txt` });
  assert(escaped.status === 404, 'no sale de la carpeta servida');
  const guessed = await get(`${url.origin}/${'0'.repeat(32)}/index.html`);
  assert(guessed.status === 404, 'sin el prefijo no sirve nada');
  const rebinding = await get(opened.url, { host: `atacante.example:${url.port}` });
  assert(rebinding.status === 403, 'rechaza un Host ajeno (rebinding)');
  const post = await get(opened.url, { method: 'POST' });
  assert(post.status === 405, 'solo admite lectura');
  assert(preview.owns(opened.url) && !preview.owns(`${url.origin}/otro/index.html`) && !preview.owns('https://example.com'),
    'reconoce solo sus propias direcciones');

  fs.writeFileSync(path.join(site, 'index.html'), '<h1>Adiós</h1>');
  const deadline = Date.now() + 5_000;
  while (!reloads && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert(reloads === 1, 'guardar un archivo de la carpeta recarga la vista previa una vez');
  return opened.url;
}

async function browserTest() {
  const loaded = [];
  const pages = [];
  let beforeRequest = null;
  const makePage = () => {
    const contents = Object.assign(new EventEmitter(), {
      url: '', title: '', reloads: 0,
      isDestroyed() { return false; },
      getURL() { return contents.url; },
      getTitle() { return contents.title; },
      isLoading() { return false; },
      getZoomFactor() { return 1; },
      setZoomFactor() {},
      reload() { contents.reloads += 1; },
      setWindowOpenHandler() {},
      navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} },
      loadURL: async (url) => { loaded.push(url); contents.url = url; contents.title = url; },
      executeJavaScript: async () => ({ url: contents.url, title: contents.title, text: '', elements: [] }),
      executeJavaScriptInIsolatedWorld: async () => ({ url: contents.url, time_origin: 1 }),
      debugger: Object.assign(new EventEmitter(), { isAttached: () => false, attach: () => {}, sendCommand: async () => {} }),
      close() { contents.emit('destroyed'); },
    });
    const view = { webContents: contents, bounds: { width: 1280, height: 860 },
      setBounds(next) { view.bounds = next; }, getBounds() { return view.bounds; } };
    pages.push(view);
    return view;
  };
  const host = { isDestroyed: () => false, on: () => {}, showInactive: () => {}, setIgnoreMouseEvents: () => {}, destroy: () => {},
    contentView: { addChildView: () => {}, removeChildView: () => {} } };
  stubModule('electron/window-manager.js', { getMainWindow: () => null });
  stubModule('electron', {
    BrowserWindow: function () { return host; },
    WebContentsView: function () { return makePage(); },
    session: { fromPartition: () => ({ setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {},
      webRequest: { onBeforeRequest: (_filter, listener) => { beforeRequest = listener; } },
      on: () => {}, getUserAgent: () => 'Mozilla/5.0 Chrome/1 Electron/1', setUserAgent: () => {} }) },
  });
  const statuses = {
    [path.join(site, 'index.html')]: { path: path.join(site, 'index.html'), exists: true, type: 'file' },
    [site]: { path: site, exists: true, type: 'folder' },
  };
  const asked = [];
  const resolvePath = async (target) => {
    asked.push(target);
    const absolute = path.isAbsolute(target) ? target : path.join(site, target);
    if (!statuses[absolute]) throw new Error('La ruta no está autorizada; adjunta el archivo o la carpeta en el mensaje');
    return statuses[absolute];
  };

  const timers = installInertTimers();
  try {
    await browser.run('web_open', { url: 'index.html' }, { sessionId: 's1', resolvePath });
    assert(asked[0] === 'index.html' && asked[1] === site, 'autoriza el archivo y su carpeta como fs_read');
    const target = loaded[loaded.length - 1];
    assert(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/index\.html$/.test(target), 'web_open con un .html abre la vista previa local');
    assert(browser.state().tabs[0].url === target, 'la vista previa se abre en la pestaña del agente');

    let allowed = null;
    beforeRequest({ url: target }, (result) => { allowed = result; });
    assert(allowed && allowed.cancel === false, 'la sesión del navegador deja pasar la vista previa');
    let local = null;
    beforeRequest({ url: 'http://127.0.0.1:1/otro' }, (result) => { local = result; });
    await new Promise((resolve) => setImmediate(resolve));
    assert(local && local.cancel === true, 'el resto de localhost sigue bloqueado');
    let file = null;
    beforeRequest({ url: pathToFileURL(path.join(root, 'secreto.txt')).href }, (result) => { file = result; });
    assert(file && file.cancel === true, 'file:// fuera de la vista previa se bloquea');

    await browser.run('web_open', { url: pathToFileURL(path.join(site, 'index.html')).href }, { sessionId: 's1', resolvePath });
    assert(loaded[loaded.length - 1].startsWith('http://127.0.0.1:'), 'una dirección file:// también se sirve por la vista previa');

    let denied = null;
    try { await browser.run('web_open', { url: 'C:\\otra\\pagina.html' }, { sessionId: 's1', resolvePath }); } catch (err) { denied = err; }
    assert(denied && /no está autorizada/.test(denied.message), 'una ruta sin autorizar no se abre');
    let anonymous = null;
    try { await browser.run('web_open', { url: 'index.html' }, { sessionId: 's1' }); } catch (err) { anonymous = err; }
    assert(anonymous && /requiere una conversación/.test(anonymous.message), 'sin conversación no hay vista previa local');

    await browser.run('web_open', { url: 'example.com/pagina.html' }, { sessionId: 's1', resolvePath });
    assert(loaded[loaded.length - 1] === 'https://example.com/pagina.html', 'un dominio con .html sigue siendo una web');
  } finally { timers.restore(); }

  await browser.run('web_open', { url: 'index.html' }, { sessionId: 's1', resolvePath });
  const tab = pages[pages.length - 1].webContents;
  fs.writeFileSync(path.join(site, 'css', 'app.css'), 'h1{color:blue}');
  const deadline = Date.now() + 5_000;
  while (!tab.reloads && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert(tab.reloads === 1, 'guardar un recurso recarga la pestaña que muestra la vista previa');
  browser.close();
}

async function fallbackTest() {
  const createServer = http.createServer;
  http.createServer = () => Object.assign(new EventEmitter(), {
    listen() { setImmediate(() => this.emit('error', new Error('EACCES'))); },
  });
  try {
    const file = path.join(site, 'index.html');
    const opened = await preview.open(file);
    assert(!opened.server && opened.url === pathToFileURL(file).href, 'sin servidor la vista previa cae a file://');
    assert(preview.owns(pathToFileURL(path.join(site, 'css', 'app.css')).href)
      && !preview.owns(pathToFileURL(path.join(root, 'secreto.txt')).href), 'file:// queda confinado a la carpeta del archivo');
  } finally {
    http.createServer = createServer;
    preview.close();
  }
}

(async () => {
  try {
    const url = await serverTest();
    preview.close();
    assert(!preview.owns(url), 'cerrar detiene la vista previa');
    await browserTest();
    await fallbackTest();
  } finally {
    preview.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  finish();
})().catch((error) => { console.error(error); process.exit(1); });
