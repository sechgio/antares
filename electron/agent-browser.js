'use strict';

const fs = require('node:fs');
const dns = require('node:dns');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const preview = require('./agent-preview');

const PARTITION = 'persist:antares-agent-browser';
const MAX_TEXT = 3_500;
const MAX_ELEMENTS = 80;
const MAX_CANDIDATES = 400;
const POINTER_SCAN = 3_000;
const MAX_FILL_FIELDS = 16;
const MAX_FILL_TEXT = 16_000;
const WAIT_DEFAULT_MS = 8_000;
const WAIT_MAX_MS = 15_000;
const WAIT_STEP_MS = 250;
const HEALTH_KEEP = 5;
const RESULT_BUDGET = 5_600;
const SHOT_WIDTH = 1280;
const KEEP_SCREENS = 12;
const CONSOLE_KEEP = 200;
const NET_KEEP = 300;
const MAX_PAGE_TEXT = 12_000;
const LOAD_TIMEOUT_MS = 30_000;
const SETTLE_MS = 700;
// Tras el DOM listo no se espera a que acaben imágenes, anuncios ni medidores.
const READY_GRACE_MS = 1_500;
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
    type: 'object', properties: { url: { type: 'string', description: 'Dirección http(s), búsqueda o ruta de un .html del espacio de trabajo '
      + '(o file://) para verlo en vista previa con recarga en vivo; para leer otro archivo local usa fs_read' } }, required: ['url'],
  }, false],
  web_read: ['Leer el texto y los elementos interactivos de la página actual: primero los visibles, con su estado; '
    + 'incluye marcos del mismo sitio y componentes con shadow DOM', {
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
  web_scroll: ['Desplazar la página, o un contenedor con desplazamiento propio, y leer lo que aparece', {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['down', 'up'], description: 'Hacia dónde desplazar (por defecto down)' },
      pages: { type: 'number', minimum: 0.25, maximum: 10, description: 'Pantallas a desplazar (por defecto 1)' },
      ref: { ...REF, description: 'Contenedor con desplazamiento propio; sin ref se desplaza la página' },
    },
  }, false],
  web_hover: ['Pasar el puntero sobre un elemento para abrir su menú o su ayuda', {
    type: 'object', properties: { ref: REF }, required: ['ref'],
  }, false],
  web_wait: ['Esperar a que la página muestre un texto, deje de mostrarlo o cambie de dirección, y leerla', {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Texto que debe aparecer' },
      gone: { type: 'string', description: 'Texto que debe desaparecer, p. ej. «Cargando»' },
      url: { type: 'string', description: 'Fragmento que debe contener la dirección' },
      timeout_ms: { type: 'integer', minimum: WAIT_STEP_MS, maximum: WAIT_MAX_MS, description: 'Espera máxima (por defecto 8000)' },
    },
  }, false],
  web_click: ['Hacer clic en un elemento de la página', { type: 'object', properties: { ref: REF }, required: ['ref'] }, true],
  web_select: ['Elegir opciones de un desplegable nativo (select) por su valor o su texto', {
    type: 'object',
    properties: {
      ref: REF,
      values: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50, description: 'Valores o textos de las opciones' },
    },
    required: ['ref', 'values'],
  }, true],
  web_check: ['Marcar o desmarcar una casilla, un interruptor o una opción de radio', {
    type: 'object', properties: { ref: REF, checked: { type: 'boolean' } }, required: ['ref', 'checked'],
  }, true],
  web_fill: ['Rellenar de una vez varios campos de texto leídos en el mismo web_read; no envía el formulario', {
    type: 'object',
    properties: {
      fields: {
        type: 'array', minItems: 1, maxItems: MAX_FILL_FIELDS,
        items: { type: 'object', properties: { ref: REF, text: { type: 'string' } }, required: ['ref', 'text'] },
      },
    },
    required: ['fields'],
  }, true],
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

const HOST_SIZE = { width: 1280, height: 860 };
const USER_CONTROL_ERROR = 'El usuario tiene el control del navegador ahora mismo; espera a que te lo devuelva o pídeselo';
const USER_BUSY_ERROR = 'El usuario está usando el navegador en este momento; espera unos segundos antes de volver a actuar en la página';
const SECRET_FIELD_ERROR = 'El campo pide una contraseña, un código o datos de tarjeta: el agente no escribe en él. '
  + 'Cede el control con web_handover para que lo complete el usuario';
// Documento (performance.timeOrigin) cuyo snapshot numeró las refs de cada pestaña:
// el contador se reinicia en cada carga y la misma ref señalaría otro elemento.
const refDocuments = new WeakMap();
const SECRET_FIELD_JS = `(el) => el.type === 'password' || String(el.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/)
  .some((token) => ['one-time-code', 'current-password', 'new-password'].includes(token) || token.startsWith('cc-'))`;
const USER_INPUT_GRACE_MS = 5_000;
const USER_WAIT_MAX_MS = 10_000;
const READ_TOOLS = new Set(['web_read', 'web_screenshot', 'web_text', 'web_console', 'web_network', 'web_wait']);
const NAVIGATION_TOOLS = new Set(['web_open', 'web_back', 'web_forward', 'web_reload']);
const AGENT_TAB = 'agent';
const USER_TAB = 'user';
const MAX_USER_TABS = 8;
const AGENT_LEASE_MS = 10 * 60_000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const LOCAL_DOCUMENT = /^(?![a-z][a-z0-9+.-]*:)[^\s/\\]+\.(?:md|markdown|txt|pdf|docx?|csv|xlsx?|json)$/i;

let host = null;
let docked = null;
let activeTab = AGENT_TAB;
let order = [AGENT_TAB, USER_TAB];
let tabSeq = 0;
let agentOwner = null;
const tabs = new Map();
const pendingMouseInputs = new Set();
let consoleLog = [];
const netLog = new Map();
let consoleSeq = 0;
let netSeq = 0;
let sessionReady = false;
let downloadSlot = null;

function browserError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function userControlError() {
  return browserError(USER_CONTROL_ERROR, 'USER_CONTROL', { retryable: false, recoverable: true });
}

function userBusyError(retryAfterMs) {
  return browserError(USER_BUSY_ERROR, 'USER_BUSY', {
    retryable: true,
    recoverable: true,
    retryAfterMs: Math.max(0, Math.round(Number(retryAfterMs) || 0)),
  });
}

function busyRemaining(tab) {
  return tab ? Math.max(0, tab.lastUserInputAt + USER_INPUT_GRACE_MS - Date.now()) : 0;
}

function acquireAgent(sessionId) {
  if (!sessionId) return;
  const now = Date.now();
  if (!agentOwner || agentOwner.sessionId === sessionId || now - agentOwner.at >= AGENT_LEASE_MS) {
    agentOwner = { sessionId, at: now };
    return;
  }
  throw browserError('Otra conversación está usando el navegador del agente; espera a que termine o pide al usuario que cierre esa tarea',
    'BROWSER_BUSY', {
      retryable: false,
      recoverable: true,
      retryAfterMs: Math.max(0, AGENT_LEASE_MS - (now - agentOwner.at)),
    });
}

function release(sessionId) {
  if (!agentOwner || !sessionId || agentOwner.sessionId !== sessionId) return;
  agentOwner = null;
}

function assertAgentTarget(raw) {
  const value = String(raw || '').trim();
  if (!LOCAL_DOCUMENT.test(value)) return;
  throw browserError(`«${value}» parece un archivo local; usa fs_read con la ruta o escribe https:// si querías abrir una web`,
    'LOCAL_FILE', { recoverable: false });
}

function isWeb(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !(n >= 0 && n <= 255))) return true;
  if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  return parts[0] >= 224;
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.includes(':')) {
    if (host === '::' || host === '::1' || host.startsWith('::ffff:')) return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    return false;
  }
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ? isPrivateIpv4(host) : false;
}

function isAllowedWebUrl(url) {
  if (!isWeb(url)) return false;
  try {
    return !isPrivateHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

function publicWebUrl(url) {
  if (isPrivateHostname(new URL(url).hostname)) {
    throw new Error('El navegador de Agent no accede a direcciones locales ni de la red privada');
  }
  return url;
}

// Un nombre público puede resolver a una IP privada (DNS del atacante o
// rebinding): antes de salir se resuelve el host y se comprueba cada
// dirección; sin resolución verificable no hay navegación.
async function isPublicResolution(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return false; }
  if (isPrivateHostname(host)) return false;
  if (host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    return false;
  }
  return addresses.length > 0 && !addresses.some((entry) => isPrivateHostname(entry.address));
}

// Una ruta a un .html (o file://) es vista previa local; «dominio.com/x.html» sigue siendo web.
function localTarget(raw) {
  const value = String(raw || '').trim();
  if (/^file:/i.test(value)) {
    try { return fileURLToPath(value); } catch { throw new Error('La dirección file:// no es válida'); }
  }
  if (isWeb(value) || !/^[^?#]+\.html?$/i.test(value)) return null;
  const first = value.split(/[\\/]/)[0];
  return /^[a-z]:[\\/]/i.test(value) || value.includes('\\') || value.startsWith('.') || !value.includes('/') || !first.includes('.')
    ? value : null;
}

function permitted(url) {
  return isAllowedWebUrl(url) || preview.owns(url);
}

function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('Indica la dirección o la búsqueda');
  if (isWeb(value)) return publicWebUrl(value);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[\w.-]+:\d+/.test(value)) throw new Error('Solo se admiten direcciones http y https');
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(value)) return publicWebUrl(`https://${value}`);
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
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
  // Última barrera contra el rebinding: ni las redirecciones ni los
  // subrecursos de una página limpia pueden apuntar a una IP privada.
  // La única excepción es la vista previa local, por su origen y prefijo exactos.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file:///*'] }, (details, callback) => {
    if (preview.owns(details.url)) return callback({ cancel: false });
    if (details.url.startsWith('file:')) return callback({ cancel: true });
    isPublicResolution(details.url)
      .then((allowed) => callback({ cancel: !allowed }))
      .catch(() => callback({ cancel: true }));
  });
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

async function startDownload(url, drafts) {
  if (!drafts) throw new Error('Los borradores requieren una conversación');
  if (!isWeb(url)) throw new Error('Indica la dirección http(s) del archivo');
  publicWebUrl(url);
  const policy = require('./agent-browser-policy');
  if (policy.isBlocked(policy.hostOf(url))) {
    throw new Error('Dominio bloqueado por la política del navegador del agente');
  }
  if (!(await isPublicResolution(url))) {
    throw new Error('El navegador de Agent no accede a direcciones locales ni de la red privada');
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
  const created = new electron.BrowserWindow({
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
  host = created;
  created.on('closed', () => {
    for (const tab of tabs.values()) if (tab.parent === created) tab.parent = null;
    if (host === created) host = null;
  });
  created.setIgnoreMouseEvents(true);
  created.showInactive();
  return created;
}

function tabContents(tab) {
  return tab && tab.view && alive(tab.view.webContents) ? tab.view.webContents : null;
}

function tabState(id) {
  const tab = tabs.get(id);
  const contents = tabContents(tab);
  const remaining = tab && !tab.userControl ? busyRemaining(tab) : 0;
  return {
    id,
    label: id === AGENT_TAB ? 'Agente' : 'Nueva pestaña',
    open: !!contents,
    url: contents ? contents.getURL() : '',
    title: contents ? contents.getTitle() : '',
    loading: contents ? contents.isLoading() : false,
    can_go_back: contents ? contents.navigationHistory.canGoBack() : false,
    can_go_forward: contents ? contents.navigationHistory.canGoForward() : false,
    user_control: !!(tab && tab.userControl),
    busy_until: remaining > 0 ? Date.now() + remaining : 0,
    busy_reason: tab && tab.userControl ? 'control' : remaining > 0 ? 'user_input' : '',
    active: id === activeTab,
  };
}

function state() {
  const current = tabState(activeTab);
  return {
    open: current.open,
    url: current.url,
    title: current.title,
    loading: current.loading,
    can_go_back: current.can_go_back,
    can_go_forward: current.can_go_forward,
    docked: !!docked,
    user_control: current.user_control,
    busy_until: current.busy_until,
    busy_reason: current.busy_reason,
    active_tab: activeTab,
    tabs: order.map((id) => tabState(id)),
  };
}

function notify(reason) {
  try {
    const win = require('./window-manager').getMainWindow();
    if (alive(win)) win.webContents.send('ipc-notify', 'agent.browser', { ...state(), reason });
  } catch { }
}

function noteUserInput(tab) {
  if (!tab || tab.userControl) return;
  tab.lastUserInputAt = Date.now();
  if (tab.lastUserInputAt - tab.lastBusyNotifyAt < 500) return;
  tab.lastBusyNotifyAt = tab.lastUserInputAt;
  notify('busy');
}

function ensureTab(id) {
  let tab = tabs.get(id);
  if (!tab) {
    tab = { id, view: null, parent: null, userControl: false, lastUserInputAt: 0, lastBusyNotifyAt: 0 };
    tabs.set(id, tab);
  }
  if (tab.view && alive(tab.view.webContents)) return tab;
  const electron = require('electron');
  const ses = prepareSession(electron);
  tab.view = new electron.WebContentsView({
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
  const ownedView = tab.view;
  tab.parent = null;
  const contents = tab.view.webContents;
  if (id === AGENT_TAB) {
    consoleLog = [];
    netLog.clear();
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (permitted(url)) setImmediate(() => contents.loadURL(url).catch(() => {}));
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!permitted(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!permitted(url)) event.preventDefault();
  });
  const userInput = (_event, input) => {
    if (input.type === 'mouseDown') {
      const own = [...pendingMouseInputs].find((pending) => pending.contents === contents
        && Math.round(pending.x) === Math.round(input.x) && Math.round(pending.y) === Math.round(input.y)
        && pending.button === input.button && pending.clickCount === input.clickCount);
      if (own) { pendingMouseInputs.delete(own); return; }
    }
    if (['mouseDown', 'mouseWheel', 'keyDown', 'rawKeyDown'].includes(input.type)) noteUserInput(tab);
  };
  contents.on('before-input-event', userInput);
  contents.on('before-mouse-event', userInput);
  contents.on('input-event', (event, input) => { if (input.type === 'mouseWheel') userInput(event, input); });
  if (id === AGENT_TAB) {
    contents.on('console-message', ({ level, message }) => {
      consoleLog.push({ level: String(level || 'info'), text: String(message || ''), seq: ++consoleSeq });
      if (consoleLog.length > CONSOLE_KEEP) consoleLog.shift();
    });
    // El debugger se adjunta al crear la página para que Network capture las
    // peticiones desde la primera carga, no solo desde la primera interacción.
    contents.debugger.on('message', (_event, method, params) => noteNetwork(method, params));
    ensureDebugger(contents).catch(() => { });
  }
  contents.on('did-start-loading', () => domReadyAt.delete(contents));
  contents.on('dom-ready', () => domReadyAt.set(contents, Date.now()));
  for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) {
    contents.on(event, () => notify('page'));
  }
  contents.once('destroyed', () => {
    for (const pending of [...pendingMouseInputs]) {
      if (pending.contents === contents) pendingMouseInputs.delete(pending);
    }
    const current = tabs.get(id);
    if (current && current.view === ownedView) {
      current.view = null;
      current.parent = null;
      current.userControl = false;
      current.lastUserInputAt = 0;
      current.lastBusyNotifyAt = 0;
    }
    notify(order.some((tabId) => tabContents(tabs.get(tabId))) ? 'page' : 'closed');
  });
  mount(electron);
  return tab;
}

function recordNet(id, entry) {
  netLog.set(id, entry);
  if (netLog.size > NET_KEEP) netLog.delete(netLog.keys().next().value);
}

function noteNetwork(method, params = {}) {
  if (method === 'Network.requestWillBeSent') {
    const request = params.request || {};
    recordNet(params.requestId, { method: request.method || '', url: String(request.url || ''), type: params.type || '', status: null,
      seq: ++netSeq });
  } else if (method === 'Network.responseReceived') {
    const existing = netLog.get(params.requestId);
    const response = params.response || {};
    const entry = existing || { method: '', url: String(response.url || ''), type: params.type || '', status: null, seq: ++netSeq };
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

function mount(electron) {
  const main = require('./window-manager').getMainWindow();
  for (const tab of tabs.values()) {
    if (!tabContents(tab)) continue;
    if (tab.parent && !alive(tab.parent)) tab.parent = null;
    const target = docked && alive(main) && tab.id === activeTab ? main : hostWindow(electron);
    if (tab.parent && tab.parent !== target && alive(tab.parent)) tab.parent.contentView.removeChildView(tab.view);
    if (tab.parent !== target) {
      target.contentView.addChildView(tab.view);
      tab.parent = target;
    }
    if (target === main) {
      const [width, height] = main.getContentSize();
      tab.view.setBounds(clampBounds(docked, main.webContents.getZoomFactor(), { width, height }));
    } else {
      tab.view.setBounds({ x: 0, y: 0, ...HOST_SIZE });
    }
  }
}

function dock(bounds) {
  const valid = bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(bounds[key])))
    && Number(bounds.width) > 0 && Number(bounds.height) > 0;
  docked = valid ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
  mount(require('electron'));
  return state();
}

function setUserControl(value, id = activeTab) {
  if (!order.includes(id)) throw new Error(`Pestaña no válida: ${id}`);
  let tab = tabs.get(id);
  if (!tab) {
    if (!value) return state();
    tab = { id, view: null, parent: null, userControl: true, lastUserInputAt: 0, lastBusyNotifyAt: 0 };
    tabs.set(id, tab);
    notify('control');
    return state();
  }
  const returning = tab.userControl && !value;
  tab.userControl = !!value;
  if (returning) {
    tab.lastUserInputAt = 0;
    tab.lastBusyNotifyAt = 0;
  }
  notify('control');
  return state();
}

function allowAgent(id = activeTab) {
  if (!order.includes(id)) throw new Error(`Pestaña no válida: ${id}`);
  const tab = tabs.get(id);
  if (tab) {
    tab.userControl = false;
    tab.lastUserInputAt = 0;
    tab.lastBusyNotifyAt = 0;
  }
  notify('control');
  return state();
}

function resetUserActivity(id = AGENT_TAB) {
  if (!order.includes(id)) throw new Error(`Pestaña no válida: ${id}`);
  const tab = tabs.get(id);
  if (!tab) return;
  tab.lastUserInputAt = 0;
  tab.lastBusyNotifyAt = 0;
  notify('page');
}

function activateTab(id) {
  if (!order.includes(id)) throw new Error(`Pestaña no válida: ${id}`);
  activeTab = id;
  mount(require('electron'));
  notify('page');
  return state();
}

function newTab() {
  if (order.length - 1 >= MAX_USER_TABS) {
    throw new Error(`Puedes tener hasta ${MAX_USER_TABS} pestañas abiertas; cierra una antes de abrir otra`);
  }
  const id = `tab-${++tabSeq}`;
  order = [...order, id];
  return activateTab(id);
}

function closeTab(id) {
  if (id === AGENT_TAB || !order.includes(id)) throw new Error(`Pestaña no válida: ${id}`);
  const index = order.indexOf(id);
  order = order.filter((tabId) => tabId !== id);
  if (activeTab === id) activeTab = order[index] || order[index - 1];
  const tab = tabs.get(id);
  tabs.delete(id);
  if (tab && tab.view) {
    if (alive(tab.parent)) tab.parent.contentView.removeChildView(tab.view);
    if (alive(tab.view.webContents)) tab.view.webContents.close();
  }
  mount(require('electron'));
  notify('page');
  return state();
}

async function navigate(action, url, id = activeTab) {
  if (action === 'open') {
    const tab = ensureTab(id);
    await load(tab.view.webContents, normalizeUrl(url));
    return state();
  }
  const contents = current(id);
  if (action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  else if (action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
  else if (action === 'reload') contents.reload();
  return state();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Abrir o volver atrás espera a que el usuario deje la página; el clic o la
// escritura no, porque ya podrían haber enviado entrada. La espera ocurre antes
// de navegar, así que no repite ningún efecto.
async function waitForHumanIdle(name, tab) {
  if (tab && tab.userControl) throw userControlError();
  if (READ_TOOLS.has(name)) return;
  if (!NAVIGATION_TOOLS.has(name)) {
    const remaining = busyRemaining(tab);
    if (remaining > 0) throw userBusyError(remaining);
    return;
  }
  const deadline = Date.now() + USER_WAIT_MAX_MS;
  let remaining = busyRemaining(tab);
  while (remaining > 0) {
    if (tab && tab.userControl) throw userControlError();
    if (Date.now() + remaining > deadline) throw userBusyError(remaining);
    await delay(Math.min(remaining, 200));
    remaining = busyRemaining(tab);
  }
  if (tab && tab.userControl) throw userControlError();
}

const domReadyAt = new WeakMap();

async function settle(contents) {
  await delay(SETTLE_MS);
  const started = Date.now();
  while (contents.isLoading() && Date.now() - started < LOAD_TIMEOUT_MS) {
    const ready = domReadyAt.get(contents);
    if (ready && Date.now() - ready >= READY_GRACE_MS) return;
    await delay(150);
  }
}

async function load(contents, url) {
  const loading = contents.loadURL(url).catch((err) => {
    if (!/ERR_ABORTED/.test(String(err && err.message))) throw err;
  });
  const settled = settle(contents);
  loading.catch(() => { });
  await Promise.race([loading, settled]);
  await settled;
}

// Raíces donde buscar elementos: el documento, los shadow roots abiertos y los
// marcos del mismo origen, con el desplazamiento de cada marco respecto a la página.
const DEEP_JS = `
  const roots = (start) => {
    const out = [];
    const queue = [{ root: start, dx: 0, dy: 0 }];
    while (queue.length && out.length < 60) {
      const item = queue.shift();
      out.push(item);
      const all = item.root.querySelectorAll('*');
      for (let i = 0; i < all.length && i < 20000; i += 1) {
        const node = all[i];
        if (node.shadowRoot) queue.push({ root: node.shadowRoot, dx: item.dx, dy: item.dy });
        if (node.localName === 'iframe' || node.localName === 'frame') {
          let doc = null;
          try { doc = node.contentDocument; } catch {}
          if (doc) {
            const r = node.getBoundingClientRect();
            queue.push({ root: doc, dx: item.dx + r.left + node.clientLeft, dy: item.dy + r.top + node.clientTop });
          }
        }
      }
    }
    return out;
  };
  const byRef = (id) => {
    for (const item of roots(document)) {
      const el = item.root.querySelector('[data-antares-ref="' + id + '"]');
      if (el) return { el, root: item.root, dx: item.dx, dy: item.dy };
    }
    return null;
  };
`;

const SNAPSHOT = `(() => {
  ${DEEP_JS}
  const secret = ${SECRET_FIELD_JS};
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const selector = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],'
    + '[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],'
    + '[role=textbox],[role=searchbox],[role=slider],[role=spinbutton],[role=treeitem],[contenteditable=true],[onclick],'
    + '[tabindex]:not([tabindex="-1"])';
  const clean = (value) => String(value || '').trim().replace(/\\s+/g, ' ');
  const labelOf = (el, root) => {
    const byIds = clean((el.getAttribute('aria-labelledby') || '').split(/\\s+/)
      .map((id) => (id && root.getElementById ? root.getElementById(id) : null)).filter(Boolean).map((node) => node.innerText).join(' '));
    const labels = el.labels && el.labels.length ? clean([...el.labels].map((node) => node.innerText).join(' ')) : '';
    const button = el.localName === 'input' && ['submit', 'button', 'reset'].includes(el.type) ? el.value : '';
    const image = el.querySelector ? el.querySelector('img[alt]') : null;
    const inner = el.localName === 'select' ? '' : el.innerText;
    return clean(el.getAttribute('aria-label') || byIds || labels || inner || button || el.placeholder || el.title
      || el.name || el.alt || (image && image.alt) || '').slice(0, 80);
  };
  const states = (el) => {
    const out = [];
    const role = el.getAttribute('role');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') out.push('deshabilitado');
    if (el.type === 'checkbox' || el.type === 'radio') out.push(el.checked ? 'marcado' : 'sin marcar');
    else if (['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'].includes(role)) {
      out.push(el.getAttribute('aria-checked') === 'true' ? 'marcado' : 'sin marcar');
    }
    const expanded = el.getAttribute('aria-expanded');
    if (expanded) out.push(expanded === 'true' ? 'desplegado' : 'plegado');
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current')) out.push('seleccionado');
    if (el.required || el.getAttribute('aria-required') === 'true') out.push('obligatorio');
    if (el.readOnly) out.push('solo lectura');
    return out;
  };
  const all = roots(document);
  const candidates = [];
  const seen = new Set();
  let pointerScan = ${POINTER_SCAN};
  for (const item of all) {
    const nodes = [...item.root.querySelectorAll(selector)];
    // Controles sin rol que solo delata el cursor, como las tarjetas con onClick de React.
    for (const node of item.root.querySelectorAll('div,span,li,img,svg,td,p')) {
      if (pointerScan-- <= 0) break;
      if (node.closest(selector)) continue;
      const parent = node.parentElement;
      if (getComputedStyle(node).cursor === 'pointer' && !(parent && getComputedStyle(parent).cursor === 'pointer')) nodes.push(node);
    }
    for (const el of nodes) {
      if (candidates.length >= ${MAX_CANDIDATES}) break;
      if (seen.has(el)) continue;
      seen.add(el);
      if (!visible(el) || el.closest('[aria-hidden=true]')) continue;
      const r = el.getBoundingClientRect();
      const top = item.dy + r.top;
      const left = item.dx + r.left;
      candidates.push({ el, root: item.root, frame: item.root !== document && item.root.nodeType === 9,
        inView: top < innerHeight && top + r.height > 0 && left < innerWidth && left + r.width > 0 });
    }
  }
  candidates.sort((a, b) => Number(b.inView) - Number(a.inView));
  const elements = [];
  for (const { el, root, frame, inView } of candidates.slice(0, ${MAX_ELEMENTS})) {
    let ref = el.getAttribute('data-antares-ref');
    if (!ref) {
      window.__antaresRef = (window.__antaresRef || 0) + 1;
      ref = String(window.__antaresRef);
      el.setAttribute('data-antares-ref', ref);
    }
    const tag = el.localName;
    const item = { ref, tag, label: labelOf(el, root) };
    if (el.type && tag === 'input') item.type = el.type;
    else if (el.getAttribute('role')) item.type = el.getAttribute('role');
    if (el.href) item.href = String(el.href).slice(0, 200);
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && !secret(el) && el.type !== 'checkbox' && el.type !== 'radio') {
      item.value = String(el.value || '').slice(0, 100);
    }
    if (tag === 'select') item.options = [...el.options].slice(0, 12).map((option) => (option.selected ? '*' : '') + clean(option.text).slice(0, 40));
    const current = states(el);
    if (current.length) item.states = current;
    if (!inView) item.off = true;
    if (frame) item.frame = true;
    elements.push(item);
  }
  let text = document.body ? document.body.innerText : '';
  for (const item of all) {
    if (item.root !== document && item.root.nodeType === 9 && item.root.body) text += '\\n\\n[marco]\\n' + item.root.body.innerText;
  }
  text = text.replace(/\\n{3,}/g, '\\n\\n');
  return { url: location.href, title: document.title, text, elements, elements_total: candidates.length,
    time_origin: performance.timeOrigin };
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
    + `${item.states && item.states.length ? ` (${item.states.join(', ')})` : ''}`
    + `${item.value ? ` = ${item.value}` : ''}${item.href ? ` → ${item.href.slice(0, 90)}` : ''}`
    + `${item.options && item.options.length ? ` opciones: ${item.options.join(' | ')}` : ''}`
    + `${item.frame ? ' [marco]' : ''}${item.off ? ' [fuera de vista]' : ''}`;
}

async function snapshot(contents, offset = 0, budget = RESULT_BUDGET) {
  const page = await contents.executeJavaScript(SNAPSHOT, true);
  refDocuments.set(contents, page.time_origin);
  const start = Math.max(0, Number(offset) || 0);
  const text = String(page.text || '');
  const result = fit({
    url: page.url,
    title: page.title,
    text: text.slice(start, start + MAX_TEXT),
    elements: page.elements.map(describe),
  }, budget);
  const end = start + result.text.length;
  const more = Number(page.elements_total || 0) - result.elements.length;
  return { ...result, text_offset: start, text_total: text.length, ...(end < text.length ? { next_offset: end } : {}),
    ...(more > 0 ? { elements_more: more, elements_note: 'Hay más elementos interactivos: desplázate con web_scroll y vuelve a leer' } : {}) };
}

function pageReported(mark) {
  const errors = consoleLog.filter((entry) => entry.seq > mark.console && entry.level === 'error')
    .slice(-HEALTH_KEEP).map((entry) => entry.text.slice(0, 200));
  const failed = [...netLog.values()]
    .filter((entry) => entry.seq > mark.net && ((entry.status ?? 0) >= 400 || (entry.error && !/ERR_ABORTED/.test(entry.error))))
    .slice(-HEALTH_KEEP)
    .map((entry) => `${entry.error ? 'falló' : entry.status} ${entry.method || '·'} ${entry.url.slice(0, 160)}${entry.error ? ` (${entry.error})` : ''}`);
  if (!errors.length && !failed.length) return {};
  return { page_reported: { ...(errors.length ? { console_errors: errors } : {}), ...(failed.length ? { failed_requests: failed } : {}) } };
}

function refId(ref) {
  return String(ref || '').replace(/[^0-9]/g, '');
}

function current(id = AGENT_TAB) {
  const contents = tabContents(tabs.get(id));
  if (!contents) throw new Error(id === AGENT_TAB
    ? 'El navegador del agente no tiene ninguna página abierta; usa web_open'
    : 'Esta pestaña no tiene ninguna página abierta');
  return contents;
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

function refGuard(contents) {
  return `if (performance.timeOrigin !== ${JSON.stringify(refDocuments.get(contents) ?? null)}) return { stale: true };`;
}

function assertSameDocument(result) {
  if (result && result.stale) {
    throw browserError('La página cambió desde que la leíste; vuelve a leerla con web_read para obtener referencias nuevas',
      'PAGE_CHANGED', { recoverable: true });
  }
}

async function locate(contents, ref) {
  const id = String(ref || '').replace(/[^0-9]/g, '');
  if (!id) throw new Error('Indica la referencia del elemento (web_read)');
  const rect = await contents.executeJavaScript(`(() => {
    ${refGuard(contents)}
    ${DEEP_JS}
    let found = byRef('${id}');
    if (!found) return null;
    found.el.scrollIntoView({ block: 'center', inline: 'center' });
    found = byRef('${id}') || found;
    const el = found.el;
    const r = el.getBoundingClientRect();
    const lx = r.left + r.width / 2;
    const ly = r.top + r.height / 2;
    // El clic va a lo que esté encima del centro: un aviso o un diálogo lo taparían.
    const toggle = el.type === 'checkbox' || el.type === 'radio';
    let surface = el, root = found.root, x = lx, y = ly, covered = null;
    for (;;) {
      const hit = root.elementFromPoint ? root.elementFromPoint(x, y) : null;
      const label = hit && hit.closest ? hit.closest('label') : null;
      const reaches = !hit || hit === surface || surface.contains(hit) || hit.contains(surface)
        || (label && surface.labels && [...surface.labels].includes(label))
        || (surface === el && toggle && hit.parentElement === el.parentElement);
      if (!reaches) { covered = hit; break; }
      if (root.host) surface = root.host;
      else {
        surface = root.defaultView && root.defaultView.frameElement;
        if (!surface) break;
        const frame = surface.getBoundingClientRect();
        x += frame.left + surface.clientLeft;
        y += frame.top + surface.clientTop;
      }
      root = surface.getRootNode();
    }
    const role = el.getAttribute('role');
    const checked = toggle ? el.checked
      : ['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'].includes(role) ? el.getAttribute('aria-checked') === 'true' : null;
    return { x: Math.round(found.dx + lx), y: Math.round(found.dy + ly), secret: (${SECRET_FIELD_JS})(el), checked,
      ...(!covered ? {} : { covered: covered.localName + ' «' + String(covered.innerText || covered.getAttribute('aria-label') || '')
        .trim().replace(/\\s+/g, ' ').slice(0, 60) + '»' }) };
  })()`, true);
  assertSameDocument(rect);
  if (!rect) throw new Error('El elemento ya no está en la página; vuelve a leerla con web_read');
  if (rect.covered) {
    throw browserError(`Otro elemento tapa la referencia ${id}: ${rect.covered}. Ciérralo (un aviso de cookies, un diálogo o `
      + 'un menú) o desplaza la página con web_scroll y vuelve a leerla', 'COVERED');
  }
  await delay(120);
  return rect;
}

async function assertInteraction(input) {
  const agent = tabs.get(AGENT_TAB);
  let samePage = false;
  try {
    const page = await approvalContext(input.contents);
    samePage = tabContents(agent) === input.contents && page.page_url === input.expected.page_url
      && page.page_time_origin === input.expected.page_time_origin;
  } catch {}
  const control = !!(agent && agent.userControl);
  const remaining = control ? 0 : busyRemaining(agent);
  if (samePage && !control && remaining === 0) return;
  const error = !samePage
    ? browserError('La página cambió o ya no se puede comprobar; vuelve a leerla con web_read y solicita una nueva aprobación',
      'PAGE_CHANGED', { recoverable: true })
    : control ? userControlError() : userBusyError(remaining);
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
    if (mouseInput && !pendingMouseInputs.has(mouseInput)) noteUserInput(tabs.get(AGENT_TAB));
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

async function capture(id = activeTab) {
  const contents = tabContents(tabs.get(id));
  if (!contents) throw browserError('No hay ninguna página abierta para anotar', 'NO_PAGE');
  const image = await contents.capturePage();
  const { width, height } = image.getSize();
  return { png_base64: image.toPNG().toString('base64'), width, height, url: contents.getURL(), title: contents.getTitle() };
}

const INSPECT = (x, y) => `(() => {
  const el = document.elementFromPoint(${x} * innerWidth, ${y} * innerHeight);
  if (!el || el === document.documentElement || el === document.body) return null;
  const part = (node) => {
    if (node.id) return '#' + CSS.escape(node.id);
    const tag = node.tagName.toLowerCase();
    const same = node.parentElement ? [...node.parentElement.children].filter((child) => child.tagName === node.tagName) : [];
    return same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(node) + 1) + ')' : tag;
  };
  const path = [];
  for (let node = el; node && node.nodeType === 1 && path.length < 5; node = node.parentElement) {
    path.unshift(part(node));
    if (node.id) break;
  }
  const link = el.closest('a[href]');
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: String(el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 6),
    selector: path.join(' > '),
    role: el.getAttribute('role') || '',
    label: String(el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '').slice(0, 120),
    text: String(el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 200),
    href: link ? String(link.href).slice(0, 300) : '',
    box: { x: r.left / innerWidth, y: r.top / innerHeight, width: r.width / innerWidth, height: r.height / innerHeight },
  };
})()`;

async function inspect(x, y, id = activeTab) {
  const contents = tabContents(tabs.get(id));
  if (!contents) throw browserError('No hay ninguna página abierta para inspeccionar', 'NO_PAGE');
  const point = [Number(x), Number(y)];
  if (!point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Punto no válido');
  return contents.executeJavaScriptInIsolatedWorld(1002, [{ code: INSPECT(...point) }], true);
}

function reloadPreview() {
  for (const tab of tabs.values()) {
    const contents = tabContents(tab);
    if (contents && preview.owns(contents.getURL())) contents.reload();
  }
}

// La ruta se autoriza como en fs_read (espacio de trabajo o carpeta adjunta) y
// se sirve su carpeta, que también debe estar autorizada.
async function previewUrl(file, resolvePath) {
  if (!resolvePath) throw new Error('La vista previa de archivos locales requiere una conversación');
  const status = await resolvePath(file);
  if (!status || !status.exists || status.type !== 'file') {
    throw new Error(`No existe el archivo ${file}; créalo con fs_write antes de abrirlo en vista previa`);
  }
  const folder = await resolvePath(path.dirname(status.path));
  if (!folder || folder.type !== 'folder') throw new Error('La carpeta del archivo no está autorizada; adjúntala en el mensaje');
  return (await preview.open(status.path, { onReload: reloadPreview })).url;
}

async function observeAfter(contents) {
  await settle(contents);
  return snapshot(contents, 0, RESULT_BUDGET - 400);
}

async function run(name, params = {}, { dir, drafts, approvedContext, sessionId, resolvePath } = {}) {
  const file = name === 'web_open' ? localTarget(params.url) : null;
  if (name === 'web_open' && file === null) {
    assertAgentTarget(params.url);
    const policy = require('./agent-browser-policy');
    if (policy.isBlocked(policy.hostOf(normalizeUrl(params.url)))) {
      throw new Error('Dominio bloqueado por la política del navegador del agente');
    }
  }
  acquireAgent(sessionId);
  const mark = { console: consoleSeq, net: netSeq };
  let tab = tabs.get(AGENT_TAB);
  if (tab && tab.userControl) throw userControlError();
  await waitForHumanIdle(name, tab);
  if (name === 'web_handover') {
    setUserControl(true, AGENT_TAB);
    return { handed_over: true, ...state() };
  }
  if (name === 'web_download') return startDownload(String(params.url || '').trim(), drafts);
  if (name === 'web_open') {
    if (!docked) activeTab = AGENT_TAB;
    const target = file !== null ? await previewUrl(file, resolvePath) : normalizeUrl(params.url);
    tab = ensureTab(AGENT_TAB);
    notify('agent-open');
    const contents = tab.view.webContents;
    if (file === null && !(await isPublicResolution(target))) {
      throw new Error('El navegador de Agent no accede a direcciones locales ni de la red privada');
    }
    await load(contents, target);
    return snapshot(contents);
  }
  const contents = current(AGENT_TAB);
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
  if (name === 'web_wait') return waitFor(contents, params);
  if (name === 'web_scroll') return scrollPage(contents, params);
  const input = { contents, expected: approvedContext || await approvalContext(contents), sent: false };
  if (name === 'web_hover') {
    const point = await locate(contents, params.ref);
    await send(input, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(point.x), y: Math.round(point.y) });
    return { hovered: String(params.ref), page: await observeAfter(contents) };
  }
  if (name === 'web_click') {
    await clickAt(input, await locate(contents, params.ref));
    return { clicked: String(params.ref), page: await observeAfter(contents), ...pageReported(mark) };
  }
  if (name === 'web_select') return { ...await selectOptions(input, params), ...pageReported(mark) };
  if (name === 'web_check') return { ...await setChecked(input, params), ...pageReported(mark) };
  if (name === 'web_fill') return { ...await fillFields(input, params), ...pageReported(mark) };
  if (name === 'web_type') {
    const text = String(params.text ?? '');
    if (text.length > 5000) throw new Error('El texto excede 5000 caracteres');
    const target = await locate(contents, params.ref);
    if (target.secret) throw browserError(SECRET_FIELD_ERROR, 'SECRET_FIELD');
    await clickAt(input, target);
    if (params.clear === true) {
      await assertInteraction(input);
      await contents.executeJavaScript(selectAllScript(refId(params.ref)), true);
    }
    await send(input, 'Input.insertText', { text });
    if (params.submit === true) await pressCombo(input, 'enter');
    return { typed: text.length, page: await observeAfter(contents), ...pageReported(mark) };
  }
  if (name === 'web_key') {
    const keys = String(params.keys || '').trim();
    if (!keys) throw new Error('Indica las teclas');
    const writes = keys.split(/\s+/).some((combo) => {
      const parts = combo.split('+').filter(Boolean);
      const last = parts[parts.length - 1] || '';
      return (last.length === 1 || last.toLowerCase() === 'space')
        && !parts.slice(0, -1).some((part) => ['ctrl', 'control', 'alt', 'meta', 'cmd'].includes(part.toLowerCase()));
    });
    if (writes && await contents.executeJavaScript(
      `(() => { const el = document.activeElement; return !!el && (${SECRET_FIELD_JS})(el); })()`, true)) {
      throw browserError(SECRET_FIELD_ERROR, 'SECRET_FIELD');
    }
    for (const combo of keys.split(/\s+/)) {
      await pressCombo(input, combo);
      await delay(80);
    }
    return { pressed: keys, page: await observeAfter(contents), ...pageReported(mark) };
  }
  if (name === 'web_upload') return { ...await uploadFile(input, params.ref, String(params.path || '').trim()), ...pageReported(mark) };
  throw new Error(`Herramienta nativa no disponible: ${name}`);
}

function selectAllScript(id) {
  return `(() => {
    ${DEEP_JS}
    const found = byRef('${id}');
    const el = found && found.el;
    if (el && 'select' in el) el.select();
    else ((found && found.root.execCommand ? found.root : document)).execCommand('selectAll');
  })()`;
}

async function waitFor(contents, params) {
  const text = String(params.text || '').toLowerCase();
  const gone = String(params.gone || '').toLowerCase();
  const url = String(params.url || '');
  if (!text && !gone && !url) throw new Error('Indica text, gone o url');
  const timeout = Math.min(WAIT_MAX_MS, Math.max(WAIT_STEP_MS, Number(params.timeout_ms) || WAIT_DEFAULT_MS));
  const check = `(() => {
    const body = (document.body ? document.body.innerText : '').toLowerCase();
    return { text: !${JSON.stringify(text)} || body.includes(${JSON.stringify(text)}),
      gone: !${JSON.stringify(gone)} || !body.includes(${JSON.stringify(gone)}),
      url: !${JSON.stringify(url)} || location.href.includes(${JSON.stringify(url)}) };
  })()`;
  let met = false;
  let waited = 0;
  for (;;) {
    // Una navegación en curso rechaza el script: cuenta como condición aún no cumplida.
    const state = await contents.executeJavaScript(check, true).catch(() => null);
    met = !!(state && state.text && state.gone && state.url);
    if (met || waited >= timeout) break;
    await delay(WAIT_STEP_MS);
    waited += WAIT_STEP_MS;
  }
  return { met, waited_ms: waited, ...(met ? {} : { note: `La condición no se cumplió en ${timeout} ms; no la des por hecha` }),
    page: await observeAfter(contents) };
}

async function scrollPage(contents, params) {
  const id = refId(params.ref);
  const pages = Math.min(10, Math.max(0.25, Number(params.pages) || 1)) * (params.direction === 'up' ? -1 : 1);
  const moved = await contents.executeJavaScript(`(() => {
    ${id ? refGuard(contents) : ''}
    ${DEEP_JS}
    const found = ${id ? `byRef('${id}')` : 'null'};
    if (${JSON.stringify(!!id)} && !found) return null;
    const box = found ? found.el : (document.scrollingElement || document.documentElement);
    const before = box.scrollTop;
    box.scrollBy({ top: Math.round((found ? box.clientHeight : innerHeight) * ${pages}), behavior: 'instant' });
    return { moved: Math.round(box.scrollTop - before), at_end: Math.ceil(box.scrollTop + box.clientHeight) >= box.scrollHeight,
      at_start: box.scrollTop <= 0 };
  })()`, true);
  assertSameDocument(moved);
  if (!moved) throw new Error('El elemento ya no está en la página; vuelve a leerla con web_read');
  return { scrolled: moved.moved, at_end: moved.at_end, at_start: moved.at_start,
    ...(moved.moved === 0 ? { note: 'No se desplazó: ya estás en el borde o el contenedor no tiene desplazamiento propio' } : {}),
    page: await observeAfter(contents) };
}

async function selectOptions(input, params) {
  const values = Array.isArray(params.values) ? params.values.map((value) => String(value)).slice(0, 50) : [];
  if (!values.length) throw new Error('Indica las opciones a elegir');
  const id = refId(params.ref);
  await locate(input.contents, params.ref);
  await assertInteraction(input);
  input.sent = true;
  const picked = await input.contents.executeJavaScript(`(() => {
    ${refGuard(input.contents)}
    ${DEEP_JS}
    const found = byRef('${id}');
    if (!found) return null;
    const el = found.el;
    if (el.localName !== 'select') return { error: 'not_select' };
    const wanted = ${JSON.stringify(values)}.map((value) => value.trim().toLowerCase());
    const options = [...el.options];
    const chosen = options.filter((option) => wanted.includes(option.value.trim().toLowerCase())
      || wanted.includes(option.text.trim().toLowerCase()));
    const available = options.slice(0, 30).map((option) => option.text.trim());
    if (!chosen.length) return { error: 'missing', available };
    if (!el.multiple && wanted.length > 1) return { error: 'single', available };
    if (el.disabled) return { error: 'disabled', available };
    options.forEach((option) => { option.selected = chosen.includes(option) && (el.multiple || option === chosen[0]); });
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { selected: options.filter((option) => option.selected).map((option) => option.text.trim()) };
  })()`, true);
  assertSameDocument(picked);
  if (!picked) throw new Error('El elemento ya no está en la página; vuelve a leerla con web_read');
  if (picked.error === 'not_select') throw new Error('El elemento no es un desplegable nativo; ábrelo con web_click y elige la opción');
  if (picked.error === 'disabled') throw new Error('El desplegable está deshabilitado');
  if (picked.error) {
    throw new Error(`${picked.error === 'single' ? 'El desplegable admite una sola opción' : 'Ninguna opción coincide'}; `
      + `opciones disponibles: ${picked.available.join(' | ')}`);
  }
  return { ref: id, selected: picked.selected, page: await observeAfter(input.contents) };
}

async function setChecked(input, params) {
  const want = params.checked === true;
  const target = await locate(input.contents, params.ref);
  if (target.checked === null || target.checked === undefined) {
    throw new Error('El elemento no es una casilla, un interruptor ni una opción de radio');
  }
  if (target.checked !== want) await clickAt(input, target);
  await settle(input.contents);
  let after = null;
  try { after = await locate(input.contents, params.ref); } catch {}
  const checked = after ? after.checked : null;
  return { ref: refId(params.ref), checked, changed: checked !== null && checked !== target.checked,
    ...(checked === want ? {} : { note: 'El estado no quedó como pediste; vuelve a leer la página antes de seguir' }),
    page: await snapshot(input.contents, 0, RESULT_BUDGET - 400) };
}

async function fillFields(input, params) {
  const fields = Array.isArray(params.fields) ? params.fields : [];
  if (!fields.length || fields.length > MAX_FILL_FIELDS) throw new Error(`Indica entre 1 y ${MAX_FILL_FIELDS} campos`);
  const ids = fields.map((field) => refId(field && field.ref));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error('Cada campo necesita una ref distinta de web_read');
  const texts = fields.map((field) => String(field.text ?? ''));
  if (texts.reduce((total, text) => total + text.length, 0) > MAX_FILL_TEXT) {
    throw new Error(`El texto de los campos excede ${MAX_FILL_TEXT} caracteres`);
  }
  const kinds = await input.contents.executeJavaScript(`(() => {
    ${refGuard(input.contents)}
    ${DEEP_JS}
    const secret = ${SECRET_FIELD_JS};
    return ${JSON.stringify(ids)}.map((id) => {
      const found = byRef(id);
      if (!found) return 'missing';
      const el = found.el;
      if (secret(el)) return 'secret';
      if (el.disabled || el.readOnly) return 'readonly';
      const text = el.localName === 'textarea' || el.isContentEditable
        || (el.localName === 'input' && ['text', 'search', 'email', 'tel', 'url', 'number', ''].includes(el.type));
      return text ? 'text' : 'other';
    });
  })()`, true);
  assertSameDocument(kinds);
  const problem = kinds.findIndex((kind) => kind !== 'text');
  if (problem >= 0) {
    const ref = ids[problem];
    if (kinds[problem] === 'secret') throw browserError(SECRET_FIELD_ERROR, 'SECRET_FIELD');
    throw new Error(kinds[problem] === 'missing' ? `El campo ${ref} ya no está en la página; vuelve a leerla con web_read`
      : kinds[problem] === 'readonly' ? `El campo ${ref} está deshabilitado o es de solo lectura`
        : `La referencia ${ref} no es un campo de texto; usa web_select o web_check`);
  }
  let written = 0;
  try {
    for (let index = 0; index < ids.length; index += 1) {
      await clickAt(input, await locate(input.contents, ids[index]));
      await assertInteraction(input);
      await input.contents.executeJavaScript(selectAllScript(ids[index]), true);
      await send(input, 'Input.insertText', { text: texts[index] });
      written += 1;
    }
  } catch (error) {
    if (written) error.message += ` (ya se escribieron ${written} de ${ids.length} campos; vuelve a leer la página antes de seguir)`;
    throw error;
  }
  const filledValues = await input.contents.executeJavaScript(`(() => {
    ${DEEP_JS}
    return ${JSON.stringify(ids)}.map((id) => {
      const found = byRef(id);
      if (!found) return null;
      return found.el.isContentEditable ? found.el.innerText : found.el.value;
    });
  })()`, true);
  const confirmed = [];
  const unconfirmed = [];
  ids.forEach((id, index) => {
    const value = Array.isArray(filledValues) ? filledValues[index] : null;
    (typeof value === 'string' && value.trim() === texts[index].trim() ? confirmed : unconfirmed).push(id);
  });
  return { filled: written, confirmed, ...(unconfirmed.length ? { unconfirmed,
    note: 'Estos campos no muestran el texto escrito (la página pudo darle formato o rechazarlo); revísalos con web_read' } : {}),
  page: await observeAfter(input.contents) };
}

async function uploadFile(input, ref, filePath) {
  const id = String(ref || '').replace(/[^0-9]/g, '');
  if (!id) throw new Error('Indica la referencia del campo (web_read)');
  if (!filePath) throw new Error('Indica la ruta del archivo');
  const field = await input.contents.executeJavaScript(`(() => {
    ${refGuard(input.contents)}
    const el = document.querySelector('[data-antares-ref="${id}"]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    return { tag: el.tagName.toLowerCase(), type: el.type || '' };
  })()`, true);
  assertSameDocument(field);
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
  for (const tab of tabs.values()) {
    if (tab.view && alive(tab.view.webContents)) tab.view.webContents.close();
  }
  if (alive(host)) host.destroy();
  tabs.clear();
  host = null;
  docked = null;
  activeTab = AGENT_TAB;
  order = [AGENT_TAB, USER_TAB];
  tabSeq = 0;
  agentOwner = null;
  pendingMouseInputs.clear();
  preview.close();
}

module.exports = { TOOLS, PARTITION, USER_CONTROL_ERROR, USER_BUSY_ERROR, AGENT_TAB, USER_TAB, run, close, release, normalizeUrl, isWeb, isPrivateHostname, isAllowedWebUrl, isPublicResolution, state, dock, capture, inspect, navigate, setUserControl, allowAgent, resetUserActivity, activateTab, newTab, closeTab, clampBounds, siteUserAgent, approvalContext };
