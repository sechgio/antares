'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PARTITION = 'persist:antares-agent-browser';
const MAX_TEXT = 3_500;
const MAX_ELEMENTS = 80;
const RESULT_BUDGET = 5_600;
const SHOT_WIDTH = 1280;
const KEEP_SCREENS = 12;
const CONSOLE_KEEP = 200;
const NET_KEEP = 300;
const MAX_PAGE_TEXT = 12_000;
const LOAD_TIMEOUT_MS = 30_000;
const SETTLE_MS = 700;
const KEY_CODES = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', space: 'Space', backspace: 'Backspace',
  delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown',
};
const MODIFIERS = { ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', meta: 'meta', cmd: 'meta' };
const VIRTUAL_KEYS = { Enter: 13, Tab: 9, Escape: 27, Space: 32, Backspace: 8, Delete: 46,
  Up: 38, Down: 40, Left: 37, Right: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '`': 192, '[': 219, '\\': 220, ']': 221, "'": 222 };

const REF = { type: 'string', description: 'Referencia «ref» de un elemento devuelto por web_read' };
const TOOLS = {
  web_open: ['Abrir una página web en el navegador del agente', {
    type: 'object', properties: { url: { type: 'string', description: 'Dirección http(s) o búsqueda' } }, required: ['url'],
  }, false],
  web_read: ['Leer el texto y los elementos interactivos de la página actual', {
    type: 'object', properties: { offset: { type: 'integer', minimum: 0, description: 'Carácter inicial del texto' } },
  }, false],
  web_screenshot: ['Capturar la página actual del navegador del agente', {
    type: 'object',
    properties: { full_page: { type: 'boolean', description: 'Capturar toda la página, incluido lo que no se ve' } },
  }, false],
  web_back: ['Volver a la página anterior', { type: 'object', properties: {} }, false],
  web_forward: ['Avanzar a la página siguiente', { type: 'object', properties: {} }, false],
  web_reload: ['Recargar la página actual', { type: 'object', properties: {} }, false],
  web_handover: ['Ceder el control manual del navegador al usuario hasta que lo devuelva', { type: 'object', properties: {} }, false],
  web_text: ['Leer el texto completo de la página actual, sin la lista de elementos', {
    type: 'object', properties: { offset: { type: 'integer', minimum: 0, description: 'Carácter inicial del texto' } },
  }, false],
  web_console: ['Leer los mensajes recientes de la consola del navegador', { type: 'object', properties: {} }, false],
  web_network: ['Leer las peticiones de red recientes de la página actual', { type: 'object', properties: {} }, false],
  web_click: ['Hacer clic en un elemento de la página', { type: 'object', properties: { ref: REF }, required: ['ref'] }, true],
  web_type: ['Escribir en un campo de la página', {
    type: 'object',
    properties: {
      ref: REF, text: { type: 'string' },
      clear: { type: 'boolean', description: 'Vaciar el campo antes de escribir' },
      submit: { type: 'boolean', description: 'Pulsar Enter al terminar' },
    },
    required: ['ref', 'text'],
  }, true],
  web_key: ['Pulsar teclas en la página (p. ej. «enter», «ctrl+a»)', {
    type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'],
  }, true],
  web_download: ['Descargar un archivo de la web a los borradores de la conversación', {
    type: 'object', properties: { url: { type: 'string', description: 'Dirección http(s) del archivo' } }, required: ['url'],
  }, true],
  web_upload: ['Subir un archivo autorizado de esta conversación a un campo de la página', {
    type: 'object',
    properties: {
      ref: REF,
      path: { type: 'string', description: 'Ruta del archivo autorizado en esta conversación' },
    },
    required: ['ref', 'path'],
  }, true],
};

// La página vive en un WebContentsView. Sin el panel abierto se aloja en una
// ventana anfitriona transparente fuera de pantalla (una ventana oculta no
// pinta); con el panel abierto se monta en la ventana principal
// sobre el hueco que el panel le deja, como el navegador de Claude Desktop.
const HOST_SIZE = { width: 1280, height: 860 };
const USER_CONTROL_ERROR = 'El usuario tiene el control del navegador ahora mismo; espera a que te lo devuelva o pídeselo';
const USER_BUSY_ERROR = 'El usuario está usando el navegador en este momento; espera unos segundos antes de volver a actuar en la página';
const USER_INPUT_GRACE_MS = 5_000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

let host = null;
let view = null;
let docked = null;
let userControl = false;
let lastUserInputAt = 0;
const pendingMouseInputs = new Set();
let consoleLog = [];
const netLog = new Map();
let sessionReady = false;
let downloadSlot = null;

function isWeb(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('Indica la dirección o la búsqueda');
  if (isWeb(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[\w.-]+:\d+/.test(value)) throw new Error('Solo se admiten direcciones http y https');
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(value)) return `https://${value}`;
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(value)}`;
}

// Los sitios ven un Chrome normal: sin «Electron/…» ni el nombre de la app,
// que muchos tratan como tráfico automatizado (igual que Claude Desktop).
function siteUserAgent(agent) {
  return String(agent).replace(/\s(?!(?:Mozilla|AppleWebKit|Chrome|Safari)\/)[^\s/()]+\/[^\s()]+/g, '');
}

function prepareSession(electron) {
  const ses = electron.session.fromPartition(PARTITION);
  if (sessionReady) return ses;
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setUserAgent(siteUserAgent(ses.getUserAgent()));
  // Toda descarga se cancela salvo que web_download la haya pedido: el
  // navegador del agente nunca escribe en el disco por decisión de una página.
  ses.on('will-download', (event, item) => {
    const slot = downloadSlot;
    if (!slot || item.getURLChain()[0] !== slot.url) { event.preventDefault(); item.cancel(); return; }
    downloadSlot = null;
    const name = downloadName(item.getFilename());
    const target = path.join(slot.dir, `${require('node:crypto').randomUUID().slice(0, 8)}-${name}`);
    item.setSavePath(target);
    const tooLarge = () => Math.max(item.getTotalBytes(), item.getReceivedBytes()) > MAX_DOWNLOAD_BYTES;
    item.on('updated', () => { if (tooLarge()) item.cancel(); });
    item.once('done', (_event, state) => {
      const completed = state === 'completed' && !tooLarge();
      slot.settle(completed ? null : new Error(tooLarge()
        ? `El archivo excede el límite de ${Math.round(MAX_DOWNLOAD_BYTES / (1024 * 1024))} MB`
        : 'La descarga no se completó'),
      completed ? { saved_path: target, filename: name, bytes: item.getReceivedBytes() } : null);
    });
  });
  sessionReady = true;
  return ses;
}

function downloadName(value) {
  const name = String(value || '').trim().slice(0, 120).replace(/[<>:"/\\|?*\x00]/g, '_');
  return name && name !== '.' && name !== '..' ? name : 'archivo';
}

function startDownload(url, drafts) {
  if (!drafts) throw new Error('Los borradores requieren una conversación');
  if (!isWeb(url)) throw new Error('Indica la dirección http(s) del archivo');
  const policy = require('./agent-browser-policy');
  if (policy.isBlocked(policy.hostOf(url))) {
    throw new Error('Dominio bloqueado por la política del navegador del agente');
  }
  const requested = new URL(url);
  requested.hash = '';
  const slot = { dir: drafts, url: requested.href };
  slot.wait = new Promise((resolve, reject) => {
    slot.settle = (error, saved) => {
      clearTimeout(slot.timeout);
      if (downloadSlot === slot) downloadSlot = null;
      error ? reject(error) : resolve(saved);
    };
  });
  downloadSlot = slot;
  slot.timeout = setTimeout(() => {
    if (downloadSlot === slot) slot.settle(new Error('La descarga no comenzó; comprueba la dirección'), null);
  }, LOAD_TIMEOUT_MS);
  try {
    require('electron').session.fromPartition(PARTITION).downloadURL(slot.url);
  } catch (error) {
    slot.settle(error, null);
  }
  return slot.wait;
}

function alive(item) {
  return !!item && !item.isDestroyed();
}

function hostWindow(electron) {
  if (alive(host)) return host;
  host = new electron.BrowserWindow({
    ...HOST_SIZE,
    x: -32000,
    y: -32000,
    show: false,
    opacity: 0,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    title: 'Navegador del agente · Antares',
    webPreferences: { backgroundThrottling: false },
  });
  host.on('closed', () => { host = null; });
  host.setIgnoreMouseEvents(true);
  host.showInactive();
  return host;
}

function state() {
  const contents = alive(view && view.webContents) ? view.webContents : null;
  return {
    open: !!contents,
    url: contents ? contents.getURL() : '',
    title: contents ? contents.getTitle() : '',
    loading: contents ? contents.isLoading() : false,
    can_go_back: contents ? contents.navigationHistory.canGoBack() : false,
    can_go_forward: contents ? contents.navigationHistory.canGoForward() : false,
    docked: !!docked,
    user_control: userControl,
  };
}

function notify(reason) {
  try {
    const win = require('./window-manager').getMainWindow();
    if (alive(win)) win.webContents.send('ipc-notify', 'agent.browser', { ...state(), reason });
  } catch { }
}

function browser() {
  if (view && alive(view.webContents)) return view;
  const electron = require('electron');
  const ses = prepareSession(electron);
  view = new electron.WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  const contents = view.webContents;
  consoleLog = [];
  netLog.clear();
  contents.setWindowOpenHandler(({ url }) => {
    if (isWeb(url)) setImmediate(() => contents.loadURL(url).catch(() => {}));
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isWeb(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isWeb(url)) event.preventDefault();
  });
  const userInput = (_event, input) => {
    if (input.type === 'mouseDown') {
      const own = [...pendingMouseInputs].find((pending) => pending.contents === contents
        && Math.round(pending.x) === Math.round(input.x) && Math.round(pending.y) === Math.round(input.y)
        && pending.button === input.button && pending.clickCount === input.clickCount);
      if (own) { pendingMouseInputs.delete(own); return; }
    }
    if (['mouseDown', 'mouseWheel', 'keyDown', 'rawKeyDown'].includes(input.type)) lastUserInputAt = Date.now();
  };
  contents.on('before-input-event', userInput);
  contents.on('before-mouse-event', userInput);
  contents.on('input-event', (event, input) => { if (input.type === 'mouseWheel') userInput(event, input); });
  contents.on('console-message', ({ level, message }) => {
    consoleLog.push({ level: String(level || 'info'), text: String(message || '') });
    if (consoleLog.length > CONSOLE_KEEP) consoleLog.shift();
  });
  // El debugger se adjunta al crear la página para que Network capture las
  // peticiones desde la primera carga, no solo desde la primera interacción.
  contents.debugger.on('message', (_event, method, params) => noteNetwork(method, params));
  ensureDebugger(contents).catch(() => { });
  contents.on('did-navigate', () => fitPage());
  for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) {
    contents.on(event, () => notify('page'));
  }
  contents.once('destroyed', () => {
    view = null;
    docked = null;
    notify('closed');
  });
  mount(electron);
  return view;
}

// Sin cabeceras, cookies ni cuerpos: el registro solo describe el tráfico.
function recordNet(id, entry) {
  netLog.set(id, entry);
  if (netLog.size > NET_KEEP) netLog.delete(netLog.keys().next().value);
}

function noteNetwork(method, params = {}) {
  if (method === 'Network.requestWillBeSent') {
    const request = params.request || {};
    recordNet(params.requestId, { method: request.method || '', url: String(request.url || ''), type: params.type || '', status: null });
  } else if (method === 'Network.responseReceived') {
    const existing = netLog.get(params.requestId);
    const response = params.response || {};
    const entry = existing || { method: '', url: String(response.url || ''), type: params.type || '', status: null };
    entry.status = response.status ?? entry.status;
    if (!existing) recordNet(params.requestId, entry);
  } else if (method === 'Network.loadingFailed') {
    const entry = netLog.get(params.requestId);
    if (entry) entry.error = params.errorText || 'cancelada';
  }
}

function clampBounds(bounds, zoom, size) {
  const scale = Number(zoom) > 0 ? Number(zoom) : 1;
  const x = Math.max(0, Math.round(Number(bounds.x) * scale));
  const y = Math.max(0, Math.round(Number(bounds.y) * scale));
  const width = Math.max(0, Math.min(Math.round(Number(bounds.width) * scale), size.width - x));
  const height = Math.max(0, Math.min(Math.round(Number(bounds.height) * scale), size.height - y));
  return { x, y, width, height };
}

// Coloca la página en el panel de la ventana principal o la devuelve a la
// ventana anfitriona; mover el view conserva la página, su historial y su sesión.
function mount(electron) {
  if (!view) return;
  const main = require('./window-manager').getMainWindow();
  const target = docked && alive(main) ? main : hostWindow(electron);
  const parent = target === main ? host : main;
  if (alive(parent)) parent.contentView.removeChildView(view);
  target.contentView.addChildView(view);
  if (target === main) {
    const [width, height] = main.getContentSize();
    view.setBounds(clampBounds(docked, main.webContents.getZoomFactor(), { width, height }));
  } else {
    view.setBounds({ x: 0, y: 0, ...HOST_SIZE });
  }
  fitPage();
}

// La página siempre se maqueta con el ancho de escritorio de la ventana
// anfitriona y en un panel más estrecho se muestra reducida: el agente ve la
// misma página, con los mismos elementos, sea cual sea el tamaño del panel.
function fitPage() {
  if (!view || !alive(view.webContents)) return;
  const { width } = view.getBounds();
  const zoom = width > 0 && width < HOST_SIZE.width ? width / HOST_SIZE.width : 1;
  if (Math.abs(view.webContents.getZoomFactor() - zoom) > 0.001) view.webContents.setZoomFactor(zoom);
}

function dock(bounds) {
  const valid = bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(bounds[key])))
    && Number(bounds.width) > 0 && Number(bounds.height) > 0;
  docked = valid ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
  if (view) mount(require('electron'));
  return state();
}

function setUserControl(value) {
  userControl = !!value;
  notify('control');
  return state();
}

async function navigate(action, url) {
  if (action === 'open') {
    const contents = browser().webContents;
    await load(contents, normalizeUrl(url));
    return state();
  }
  const contents = current();
  if (action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  else if (action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
  else if (action === 'reload') contents.reload();
  return state();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settle(contents) {
  await delay(SETTLE_MS);
  const started = Date.now();
  while (contents.isLoading() && Date.now() - started < LOAD_TIMEOUT_MS) await delay(150);
}

async function load(contents, url) {
  await Promise.race([
    contents.loadURL(url).catch((err) => {
      if (!/ERR_ABORTED/.test(String(err && err.message))) throw err;
    }),
    delay(LOAD_TIMEOUT_MS),
  ]);
  await settle(contents);
}

const SNAPSHOT = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const selector = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],'
    + '[role=checkbox],[role=option],[contenteditable=true],[onclick]';
  const elements = [];
  for (const el of document.querySelectorAll(selector)) {
    if (elements.length >= ${MAX_ELEMENTS}) break;
    if (!visible(el) || el.closest('[aria-hidden=true]')) continue;
    let ref = el.getAttribute('data-antares-ref');
    if (!ref) {
      window.__antaresRef = (window.__antaresRef || 0) + 1;
      ref = String(window.__antaresRef);
      el.setAttribute('data-antares-ref', ref);
    }
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label') || el.innerText || el.placeholder || el.title || el.name || el.alt || '')
      .trim().replace(/\\s+/g, ' ').slice(0, 80);
    const item = { ref, tag, label };
    if (el.type && tag === 'input') item.type = el.type;
    if (el.href) item.href = String(el.href).slice(0, 200);
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && el.type !== 'password') item.value = String(el.value || '').slice(0, 100);
    elements.push(item);
  }
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n');
  return { url: location.href, title: document.title, text, elements };
})()`;

function fit(result, budget = RESULT_BUDGET) {
  const size = (value) => JSON.stringify(value).length;
  while (size(result) > budget) {
    const keys = Object.keys(result).filter((key) => (typeof result[key] === 'string' || Array.isArray(result[key])) && result[key].length);
    if (!keys.length) break;
    const key = keys.reduce((a, b) => (size(result[a]) >= size(result[b]) ? a : b));
    result[key] = result[key].slice(0, Math.floor(result[key].length / 2));
    result.truncated = true;
  }
  return result;
}

function describe(item) {
  return `${item.ref} ${item.tag}${item.type ? `[${item.type}]` : ''} «${item.label}»`
    + `${item.value ? ` = ${item.value}` : ''}${item.href ? ` → ${item.href.slice(0, 90)}` : ''}`;
}

async function snapshot(contents, offset = 0, budget = RESULT_BUDGET) {
  const page = await contents.executeJavaScript(SNAPSHOT, true);
  const start = Math.max(0, Number(offset) || 0);
  const text = String(page.text || '');
  const result = fit({
    url: page.url,
    title: page.title,
    text: text.slice(start, start + MAX_TEXT),
    elements: page.elements.map(describe),
  }, budget);
  const end = start + result.text.length;
  return { ...result, text_offset: start, text_total: text.length, ...(end < text.length ? { next_offset: end } : {}) };
}

function current() {
  if (!view || !alive(view.webContents)) throw new Error('El navegador del agente no tiene ninguna página abierta; usa web_open');
  return view.webContents;
}

const PAGE_TEXT = `(() => ({
  url: location.href,
  title: document.title,
  text: (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n'),
}))()`;

async function pageText(contents, offset = 0) {
  const page = await contents.executeJavaScript(PAGE_TEXT, true);
  const start = Math.max(0, Number(offset) || 0);
  const text = String(page.text || '');
  const result = fit({ url: page.url, title: page.title, text: text.slice(start, start + MAX_PAGE_TEXT) });
  const end = start + result.text.length;
  return { ...result, text_offset: start, text_total: text.length, ...(end < text.length ? { next_offset: end } : {}) };
}

async function approvalContext(contents = current()) {
  const page = await contents.executeJavaScriptInIsolatedWorld(1001, [{
    code: '({ url: location.href, time_origin: performance.timeOrigin })',
  }], true);
  return { page_url: page.url, page_time_origin: page.time_origin };
}

async function locate(contents, ref) {
  const id = String(ref || '').replace(/[^0-9]/g, '');
  if (!id) throw new Error('Indica la referencia del elemento (web_read)');
  const rect = await contents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-antares-ref="${id}"]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`, true);
  if (!rect) throw new Error('El elemento ya no está en la página; vuelve a leerla con web_read');
  await delay(120);
  return rect;
}

async function assertInteraction(input) {
  let samePage = false;
  try {
    const page = await approvalContext(input.contents);
    samePage = current() === input.contents && page.page_url === input.expected.page_url
      && page.page_time_origin === input.expected.page_time_origin;
  } catch {}
  if (samePage && !userControl && Date.now() - lastUserInputAt >= USER_INPUT_GRACE_MS) return;
  const error = new Error(!samePage
    ? 'La página cambió o ya no se puede comprobar; vuelve a leerla con web_read y solicita una nueva aprobación'
    : userControl ? USER_CONTROL_ERROR : USER_BUSY_ERROR);
  if (input.sent) error.uncertain = true;
  throw error;
}

async function ensureDebugger(contents) {
  if (contents.debugger.isAttached()) return false;
  contents.debugger.attach('1.3');
  await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await contents.debugger.sendCommand('Network.enable', {});
  await contents.debugger.sendCommand('Page.enable', {});
  return true;
}

async function send(input, method, event) {
  const target = input.contents;
  let mouseInput;
  try {
    await assertInteraction(input);
    if (await ensureDebugger(target)) await assertInteraction(input);
    if (method === 'Input.dispatchMouseEvent' && event.type === 'mousePressed') {
      const zoom = target.getZoomFactor();
      mouseInput = { contents: target, x: event.x * zoom, y: event.y * zoom, button: event.button, clickCount: event.clickCount };
      pendingMouseInputs.add(mouseInput);
    }
    input.sent = true;
    await target.debugger.sendCommand(method, event);
  } catch (error) {
    if (mouseInput && !pendingMouseInputs.has(mouseInput)) lastUserInputAt = Date.now();
    if (input.sent) error.uncertain = true;
    throw error;
  } finally {
    pendingMouseInputs.delete(mouseInput);
  }
}

async function clickAt(input, point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send(input, 'Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await delay(30);
  }
}

async function pressCombo(input, combo) {
  const parts = combo.split('+').filter(Boolean);
  const modifiers = parts.slice(0, -1).map((part) => MODIFIERS[part.toLowerCase()]).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const keyCode = KEY_CODES[last.toLowerCase()] || (last.length === 1 ? last : null);
  if (!keyCode || modifiers.length !== parts.length - 1) throw new Error(`Tecla desconocida: ${combo}`);
  const mask = modifiers.reduce((value, modifier) => value | { alt: 1, control: 2, meta: 4, shift: 8 }[modifier], 0);
  const key = keyCode === 'Space' ? ' ' : ['Up', 'Down', 'Left', 'Right'].includes(keyCode) ? `Arrow${keyCode}`
    : keyCode.length === 1 && modifiers.includes('shift') ? keyCode.toUpperCase() : keyCode;
  const event = { key, modifiers: mask, windowsVirtualKeyCode: VIRTUAL_KEYS[keyCode] || keyCode.toUpperCase().charCodeAt(0) };
  const text = keyCode === 'Enter' ? '\r' : (key.length === 1 && !(mask & 7) ? key : '');
  await send(input, 'Input.dispatchKeyEvent', { type: 'keyDown', ...event, ...(text ? { text } : {}) });
  await send(input, 'Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

async function screenshot(contents, dir, fullPage = false) {
  if (!dir) throw new Error('Las capturas requieren una conversación');
  let image;
  if (fullPage) {
    await ensureDebugger(contents);
    const shot = await contents.debugger.sendCommand('Page.captureScreenshot',
      { format: 'jpeg', quality: 70, captureBeyondViewport: true });
    image = require('electron').nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
  } else {
    image = await contents.capturePage();
  }
  const { width } = image.getSize();
  if (width > SHOT_WIDTH) image = image.resize({ width: SHOT_WIDTH, quality: 'good' });
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, `web-${Date.now()}.jpg`);
  await fs.promises.writeFile(target, image.toJPEG(70));
  const old = (await fs.promises.readdir(dir)).filter((name) => name.startsWith('web-')).sort().slice(0, -KEEP_SCREENS);
  await Promise.all(old.map((name) => fs.promises.rm(path.join(dir, name), { force: true })));
  const size = image.getSize();
  return { url: contents.getURL(), title: contents.getTitle(), width: size.width, height: size.height,
    image: { path: target, mime: 'image/jpeg' } };
}

async function observeAfter(contents) {
  await settle(contents);
  return snapshot(contents, 0, RESULT_BUDGET - 400);
}

async function run(name, params = {}, { dir, drafts, approvedContext } = {}) {
  if (userControl) throw new Error(USER_CONTROL_ERROR);
  if (!['web_read', 'web_screenshot', 'web_text', 'web_console', 'web_network'].includes(name)
    && Date.now() - lastUserInputAt < USER_INPUT_GRACE_MS) throw new Error(USER_BUSY_ERROR);
  if (name === 'web_open') {
    const policy = require('./agent-browser-policy');
    const target = normalizeUrl(params.url);
    if (policy.isBlocked(policy.hostOf(target))) {
      throw new Error('Dominio bloqueado por la política del navegador del agente');
    }
    const contents = browser().webContents;
    notify('agent-open');
    await load(contents, target);
    return snapshot(contents);
  }
  if (name === 'web_handover') {
    setUserControl(true);
    return { handed_over: true, ...state() };
  }
  if (name === 'web_download') return startDownload(String(params.url || '').trim(), drafts);
  const contents = current();
  if (name === 'web_read') return snapshot(contents, params.offset);
  if (name === 'web_screenshot') return screenshot(contents, dir, params.full_page === true);
  if (name === 'web_back') {
    if (!contents.navigationHistory.canGoBack()) throw new Error('No hay una página anterior');
    contents.navigationHistory.goBack();
    return observeAfter(contents);
  }
  if (name === 'web_forward') {
    if (!contents.navigationHistory.canGoForward()) throw new Error('No hay una página siguiente');
    contents.navigationHistory.goForward();
    return observeAfter(contents);
  }
  if (name === 'web_reload') {
    contents.reload();
    return observeAfter(contents);
  }
  if (name === 'web_text') return pageText(contents, params.offset);
  if (name === 'web_console') {
    return fit({ url: contents.getURL(), messages: consoleLog.map((item) => `[${item.level}] ${item.text}`) });
  }
  if (name === 'web_network') {
    await ensureDebugger(contents);
    return fit({
      url: contents.getURL(),
      requests: [...netLog.values()].map((item) => `${item.status ?? '·'} ${item.method || '·'}${item.type ? ` ${item.type}` : ''} ${item.url}${item.error ? ` (falló: ${item.error})` : ''}`),
    });
  }
  const input = { contents, expected: approvedContext || await approvalContext(contents), sent: false };
  if (name === 'web_click') {
    await clickAt(input, await locate(contents, params.ref));
    return { clicked: String(params.ref), page: await observeAfter(contents) };
  }
  if (name === 'web_type') {
    const text = String(params.text ?? '');
    if (text.length > 5000) throw new Error('El texto excede 5000 caracteres');
    await clickAt(input, await locate(contents, params.ref));
    if (params.clear === true) {
      await assertInteraction(input);
      await contents.executeJavaScript(`(() => {
        const el = document.querySelector('[data-antares-ref="${String(params.ref).replace(/[^0-9]/g, '')}"]');
        if (el && 'select' in el) el.select(); else document.execCommand('selectAll');
      })()`, true);
    }
    await send(input, 'Input.insertText', { text });
    if (params.submit === true) await pressCombo(input, 'enter');
    return { typed: text.length, page: await observeAfter(contents) };
  }
  if (name === 'web_key') {
    const keys = String(params.keys || '').trim();
    if (!keys) throw new Error('Indica las teclas');
    for (const combo of keys.split(/\s+/)) {
      await pressCombo(input, combo);
      await delay(80);
    }
    return { pressed: keys, page: await observeAfter(contents) };
  }
  if (name === 'web_upload') return uploadFile(input, params.ref, String(params.path || '').trim());
  throw new Error(`Herramienta nativa no disponible: ${name}`);
}

// El archivo ya pasó la verificación de grants del backend; aquí solo se
// comprueba que el elemento siga siendo un campo de archivo de la página
// aprobada y se le asigna el archivo por CDP, como hace Playwright.
async function uploadFile(input, ref, filePath) {
  const id = String(ref || '').replace(/[^0-9]/g, '');
  if (!id) throw new Error('Indica la referencia del campo (web_read)');
  if (!filePath) throw new Error('Indica la ruta del archivo');
  const field = await input.contents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-antares-ref="${id}"]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    return { tag: el.tagName.toLowerCase(), type: el.type || '' };
  })()`, true);
  if (!field) throw new Error('El elemento ya no está en la página; vuelve a leerla con web_read');
  if (field.tag !== 'input' || field.type !== 'file') throw new Error('El elemento no es un campo de archivo');
  await delay(120);
  await assertInteraction(input);
  await ensureDebugger(input.contents);
  const doc = await input.contents.debugger.sendCommand('DOM.getDocument', {});
  const node = await input.contents.debugger.sendCommand('DOM.querySelector',
    { nodeId: doc.root.nodeId, selector: `[data-antares-ref="${id}"]` });
  if (!node.nodeId) throw new Error('El campo de archivo ya no está en la página; vuelve a leerla con web_read');
  await input.contents.debugger.sendCommand('DOM.setFileInputFiles', { files: [filePath], nodeId: node.nodeId });
  return { uploaded: filePath, ref: id, page: await observeAfter(input.contents) };
}

function close() {
  if (view && alive(view.webContents)) view.webContents.close();
  if (alive(host)) host.destroy();
  view = null;
  host = null;
  docked = null;
}

module.exports = { TOOLS, PARTITION, USER_CONTROL_ERROR, USER_BUSY_ERROR, run, close, normalizeUrl, isWeb, state, dock, navigate, setUserControl, clampBounds, siteUserAgent, approvalContext };
