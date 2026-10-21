'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PARTITION = 'persist:antares-agent-browser';
const MAX_TEXT = 3_500;
const MAX_ELEMENTS = 80;
const RESULT_BUDGET = 5_600;
const SHOT_WIDTH = 1280;
const KEEP_SCREENS = 12;
const LOAD_TIMEOUT_MS = 30_000;
const SETTLE_MS = 700;
const KEY_CODES = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', space: 'Space', backspace: 'Backspace',
  delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown',
};
const MODIFIERS = { ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', meta: 'meta', cmd: 'meta' };

const REF = { type: 'string', description: 'Referencia «ref» de un elemento devuelto por web_read' };
const TOOLS = {
  web_open: ['Abrir una página web en el navegador del agente', {
    type: 'object', properties: { url: { type: 'string', description: 'Dirección http(s) o búsqueda' } }, required: ['url'],
  }, false],
  web_read: ['Leer el texto y los elementos interactivos de la página actual', {
    type: 'object', properties: { offset: { type: 'integer', minimum: 0, description: 'Carácter inicial del texto' } },
  }, false],
  web_screenshot: ['Capturar la página actual del navegador del agente', { type: 'object', properties: {} }, false],
  web_back: ['Volver a la página anterior', { type: 'object', properties: {} }, false],
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
};

let win = null;
let sessionReady = false;

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

function prepareSession(electron) {
  const ses = electron.session.fromPartition(PARTITION);
  if (sessionReady) return ses;
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event, item) => {
    event.preventDefault();
    item.cancel();
  });
  sessionReady = true;
  return ses;
}

function browser() {
  if (win && !win.isDestroyed()) return win;
  const electron = require('electron');
  prepareSession(electron);
  win = new electron.BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    title: 'Navegador del agente · Antares',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  const contents = win.webContents;
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
  win.on('page-title-updated', (event) => event.preventDefault());
  win.on('closed', () => { win = null; });
  win.showInactive();
  return win;
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
  document.querySelectorAll('[data-antares-ref]').forEach((el) => el.removeAttribute('data-antares-ref'));
  const selector = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],'
    + '[role=checkbox],[role=option],[contenteditable=true],[onclick]';
  const elements = [];
  for (const el of document.querySelectorAll(selector)) {
    if (elements.length >= ${MAX_ELEMENTS}) break;
    if (!visible(el) || el.closest('[aria-hidden=true]')) continue;
    const ref = String(elements.length + 1);
    el.setAttribute('data-antares-ref', ref);
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
  if (!win || win.isDestroyed()) throw new Error('El navegador del agente no tiene ninguna página abierta; usa web_open');
  return win.webContents;
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

async function clickAt(contents, { x, y }) {
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    await delay(30);
  }
}

function pressCombo(contents, combo) {
  const parts = combo.split('+').filter(Boolean);
  const modifiers = parts.slice(0, -1).map((part) => MODIFIERS[part.toLowerCase()]).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const keyCode = KEY_CODES[last.toLowerCase()] || (last.length === 1 ? last : null);
  if (!keyCode || modifiers.length !== parts.length - 1) throw new Error(`Tecla desconocida: ${combo}`);
  contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 && !modifiers.some((m) => m !== 'shift')) contents.sendInputEvent({ type: 'char', keyCode, modifiers });
  if (keyCode === 'Enter') contents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
  contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

async function screenshot(contents, dir) {
  if (!dir) throw new Error('Las capturas requieren una conversación');
  let image = await contents.capturePage();
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

async function run(name, params = {}, { dir } = {}) {
  if (name === 'web_open') {
    const contents = browser().webContents;
    await load(contents, normalizeUrl(params.url));
    return snapshot(contents);
  }
  const contents = current();
  if (name === 'web_read') return snapshot(contents, params.offset);
  if (name === 'web_screenshot') return screenshot(contents, dir);
  if (name === 'web_back') {
    if (!contents.navigationHistory.canGoBack()) throw new Error('No hay una página anterior');
    contents.navigationHistory.goBack();
    return observeAfter(contents);
  }
  if (name === 'web_click') {
    await clickAt(contents, await locate(contents, params.ref));
    return { clicked: String(params.ref), page: await observeAfter(contents) };
  }
  if (name === 'web_type') {
    const text = String(params.text ?? '');
    if (text.length > 5000) throw new Error('El texto excede 5000 caracteres');
    await clickAt(contents, await locate(contents, params.ref));
    if (params.clear === true) {
      await contents.executeJavaScript(`(() => {
        const el = document.querySelector('[data-antares-ref="${String(params.ref).replace(/[^0-9]/g, '')}"]');
        if (el && 'select' in el) el.select(); else document.execCommand('selectAll');
      })()`, true);
    }
    await contents.insertText(text);
    if (params.submit === true) pressCombo(contents, 'enter');
    return { typed: text.length, page: await observeAfter(contents) };
  }
  if (name === 'web_key') {
    const keys = String(params.keys || '').trim();
    if (!keys) throw new Error('Indica las teclas');
    for (const combo of keys.split(/\s+/)) {
      pressCombo(contents, combo);
      await delay(80);
    }
    return { pressed: keys, page: await observeAfter(contents) };
  }
  throw new Error(`Herramienta nativa no disponible: ${name}`);
}

function close() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { TOOLS, PARTITION, run, close, normalizeUrl, isWeb };
