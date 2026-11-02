'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createCdpContents } = require('./agent-browser-cdp');
const { createBidiContents, bidiTransport } = require('./agent-browser-bidi');

// Navegadores Chromium externos (ADR 0005). Con perfil dedicado se lanzan con
// --remote-debugging-pipe, así que solo Antares puede controlarlos; «Mi sesión
// de Chrome» se conecta al Chrome abierto cuando el usuario lo permite.

const ENGINES = [
  { id: 'chrome', label: 'Google Chrome', roots: ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'], file: 'Google\\Chrome\\Application\\chrome.exe' },
  { id: 'edge', label: 'Microsoft Edge', roots: ['PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'], file: 'Microsoft\\Edge\\Application\\msedge.exe' },
  { id: 'brave', label: 'Brave', roots: ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'], file: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
  { id: 'opera', label: 'Opera', roots: ['LOCALAPPDATA'], file: 'Programs\\Opera\\opera.exe', versioned: true },
  { id: 'firefox', label: 'Mozilla Firefox', roots: ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'], file: 'Mozilla Firefox\\firefox.exe', protocol: 'bidi' },
];
const SESSION_ENGINE = { id: 'chrome-session', label: 'Mi sesión de Chrome', session: true };
const DENIED_PERMISSIONS = ['geolocation', 'notifications', 'camera', 'microphone', 'midi', 'clipboard-read'];
const CLOSE_GRACE_MS = 3_000;
const SESSION_ACCEPT_MS = 60_000;
const ENABLE_HINT = 'Activa la depuración remota de Chrome en chrome://inspect/#remote-debugging y vuelve a intentarlo';
const DOWNLOAD_TYPES = /^application\/(?:octet-stream|zip|x-zip-compressed|x-msdownload|x-msi|x-7z-compressed|x-rar-compressed|vnd\.microsoft\.portable-executable)\b/i;

function label(id) {
  if (id === SESSION_ENGINE.id) return SESSION_ENGINE.label;
  const engine = ENGINES.find((item) => item.id === id);
  return engine ? engine.label : '';
}

function isSession(id) {
  return id === SESSION_ENGINE.id;
}

// El opera.exe de la raíz es un lanzador que reabre el binario versionado y perdería la tubería.
function versionedOpera(file, { exists, readdir }) {
  const dir = path.win32.dirname(file);
  let versions = [];
  try { versions = readdir(dir).filter((name) => /^\d+(\.\d+)+$/.test(name)); } catch { }
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const found = versions.map((version) => path.win32.join(dir, version, 'opera.exe')).find((candidate) => exists(candidate));
  return found || null;
}

function detect({ env = process.env, exists = fs.existsSync, readdir = fs.readdirSync } = {}) {
  const out = [];
  for (const engine of ENGINES) {
    for (const root of engine.roots) {
      if (!env[root]) continue;
      const file = path.win32.join(env[root], engine.file);
      const exe = engine.versioned ? versionedOpera(file, { exists, readdir }) : (exists(file) ? file : null);
      if (exe) { out.push({ id: engine.id, label: engine.label, path: exe, ...(engine.protocol ? { protocol: engine.protocol } : {}) }); break; }
    }
  }
  if (out.some((engine) => engine.id === 'chrome') && env.LOCALAPPDATA) {
    out.push({ ...SESSION_ENGINE, path: path.win32.join(env.LOCALAPPDATA, 'Google\\Chrome\\User Data') });
  }
  return out;
}

// Respuestas por id y eventos a los oyentes; el formato de cada mensaje lo pone el transporte.
function transportCore(write) {
  const pending = new Map();
  const listeners = new Set();
  let seq = 0;
  let closed = null;
  const emit = (message) => { for (const listener of [...listeners]) listener(message); };
  return {
    receive(raw) {
      let message;
      try { message = JSON.parse(raw); } catch { return; }
      const call = message.id !== undefined ? pending.get(message.id) : null;
      if (call) {
        pending.delete(message.id);
        if (message.error) call.reject(Object.assign(new Error(String(message.error.message || 'Error de CDP')), { code: 'CDP_ERROR' }));
        else call.resolve(message.result || {});
      } else if (message.method) {
        emit(message);
      }
    },
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(closed);
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit,
    close(error) {
      if (closed) return;
      closed = error;
      for (const call of pending.values()) call.reject(error);
      pending.clear();
    },
  };
}

// Mensajes JSON terminados en \0: fd 3 para órdenes y fd 4 para respuestas y eventos.
function pipeTransport(writable, readable) {
  const core = transportCore((text) => writable.write(`${text}\0`));
  let buffer = '';
  readable.setEncoding('utf8');
  readable.on('data', (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
      core.receive(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
  });
  return core;
}

function socketTransport(socket) {
  const core = transportCore((text) => socket.send(text));
  socket.addEventListener('message', (event) => core.receive(String(event.data)));
  return core;
}

function launchArgs(profileDir) {
  return ['--remote-debugging-pipe', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'];
}

function defaultProfileRoot() {
  return path.join(require('electron').app.getPath('userData'), 'agent-browsers');
}

function attachment(headers = []) {
  const header = (name) => String((headers.find((item) => String(item.name).toLowerCase() === name) || {}).value || '');
  return /^\s*attachment/i.test(header('content-disposition')) || DOWNLOAD_TYPES.test(header('content-type'));
}

// Pestañas del agente sobre un transporte CDP ya abierto, con la política de red en cada sesión.
// En la sesión del usuario no se toca nada global del navegador: las descargas se cortan por pestaña.
function controller(transport, engine, { session, shutdown }) {
  const targets = new Set();
  const exitHandlers = new Set();
  const guarded = new Map();
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    transport.close(Object.assign(new Error(`${engine.label} se cerró o cortó la conexión`), { code: 'ENGINE_CLOSED' }));
    for (const targetId of targets) transport.emit({ method: 'Target.targetDestroyed', params: { targetId } });
    for (const handler of exitHandlers) handler();
  };
  const patterns = [{ urlPattern: '*', requestStage: 'Request' },
    ...(session ? ['Document', 'Other'].map((resourceType) => ({ urlPattern: '*', resourceType, requestStage: 'Response' })) : [])];
  // Cada pestaña protegida guarda su política; las sesiones hijas (iframes, workers) heredan la de su pestaña.
  const guard = async (sessionId, tab) => {
    guarded.set(sessionId, tab);
    await transport.send('Fetch.enable', { patterns }, sessionId);
    await transport.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  };
  const decide = (params, tab) => {
    if (params.responseStatusCode !== undefined || params.responseErrorReason !== undefined) return !attachment(params.responseHeaders);
    const mainFrame = params.resourceType === 'Document' && params.frameId === tab.targetId;
    return Promise.resolve(tab.allow(String((params.request || {}).url || ''), tab.pageUrl(), mainFrame)).catch(() => false);
  };
  transport.on(({ method, params = {}, sessionId }) => {
    const tab = guarded.get(sessionId);
    if (!tab) return;
    if (method === 'Fetch.requestPaused') {
      const response = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;
      Promise.resolve(decide(params, tab))
        .then((allowed) => transport.send(!allowed ? 'Fetch.failRequest' : response ? 'Fetch.continueResponse' : 'Fetch.continueRequest',
          allowed ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId))
        .catch(() => { });
    } else if (method === 'Target.attachedToTarget') {
      const info = params.targetInfo || {};
      const child = params.sessionId;
      if (info.type === 'page') {
        // Una ventana emergente no se carga fuera de la pestaña del agente: se cierra y su dirección se abre en ella.
        transport.send('Target.closeTarget', { targetId: info.targetId }).catch(() => { });
        if (info.url && info.url !== 'about:blank') tab.onPopup(info.url);
        return;
      }
      guard(child, tab).catch(() => { })
        .finally(() => transport.send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => { }));
    } else if (method === 'Target.detachedFromTarget') {
      guarded.delete(params.sessionId);
    }
  });
  return {
    end,
    link: {
      id: engine.id,
      label: engine.label,
      session: !!session,
      onExit(handler) { exitHandlers.add(handler); },
      // allow(url, pageUrl, mainFrame) decide cada petición; onPopup(url) recibe las ventanas emergentes cerradas.
      async openTab({ allow, onPopup }) {
        const { targetId } = await transport.send('Target.createTarget', { url: 'about:blank' });
        targets.add(targetId);
        const { sessionId } = await transport.send('Target.attachToTarget', { targetId, flatten: true });
        let contents = null;
        const tab = { targetId, allow, onPopup, pageUrl: () => (contents ? contents.getURL() : '') };
        await guard(sessionId, tab);
        await transport.send('Network.enable', {}, sessionId);
        await transport.send('Network.setBypassServiceWorker', { bypass: true }, sessionId);
        contents = await createCdpContents(transport, { targetId, sessionId });
        contents.once('destroyed', () => targets.delete(targetId));
        return contents;
      },
      close() {
        if (ended) return;
        shutdown([...targets]);
      },
    },
  };
}

async function launchDedicated(engine, { profileRoot, spawn }) {
  const profileDir = path.join(profileRoot || defaultProfileRoot(), engine.id);
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(engine.path, launchArgs(profileDir), { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: false });
  const transport = pipeTransport(child.stdio[3], child.stdio[4]);
  let exited = false;
  const { end, link } = controller(transport, engine, {
    session: false,
    shutdown() {
      transport.send('Browser.close').catch(() => { });
      const timer = setTimeout(() => { if (!exited) child.kill(); }, CLOSE_GRACE_MS);
      if (timer.unref) timer.unref();
    },
  });
  const onExit = () => { exited = true; end(); };
  child.on('exit', onExit);
  child.on('error', onExit);
  child.stdio[3].on('error', () => { });
  try {
    await transport.send('Target.setDiscoverTargets', { discover: true });
    await transport.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    for (const name of DENIED_PERMISSIONS) {
      await transport.send('Browser.setPermission', { permission: { name }, setting: 'denied' }).catch(() => { });
    }
  } catch (error) {
    child.kill();
    throw Object.assign(new Error(`No se pudo abrir ${engine.label}; si ya está abierto con el perfil del agente, ciérralo y vuelve a intentarlo`),
      { code: 'ENGINE_START', cause: error });
  }
  return link;
}

// Chrome 144+ publica el puerto del Chrome abierto en DevToolsActivePort cuando el usuario
// activa la depuración remota, y pide permiso en su propia ventana en cada conexión.
function sessionEndpoint(userDataDir, readFile) {
  let text;
  try { text = readFile(path.win32.join(userDataDir, 'DevToolsActivePort'), 'utf8'); } catch { text = ''; }
  const [port, wsPath] = String(text).split(/\r?\n/).map((line) => line.trim());
  if (!/^\d+$/.test(port || '') || !String(wsPath || '').startsWith('/devtools/browser/')) {
    throw Object.assign(new Error(`Chrome no tiene activa la depuración remota. ${ENABLE_HINT}`), { code: 'ENGINE_NOT_ENABLED' });
  }
  return `ws://127.0.0.1:${port}${wsPath}`;
}

function openSocket(url, WebSocketImpl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { }
      reject(Object.assign(new Error(`Chrome no aceptó la conexión. Acepta el aviso de Chrome o ${ENABLE_HINT.charAt(0).toLowerCase()}${ENABLE_HINT.slice(1)}`),
        { code: 'ENGINE_DENIED' }));
    };
    const timer = setTimeout(fail, timeoutMs);
    socket.addEventListener('open', () => { if (settled) return; settled = true; clearTimeout(timer); resolve(socket); });
    socket.addEventListener('error', fail);
    socket.addEventListener('close', fail);
  });
}

async function connectSession(engine, { readFile, WebSocketImpl, acceptMs }) {
  const socket = await openSocket(sessionEndpoint(engine.path, readFile), WebSocketImpl, acceptMs);
  const transport = socketTransport(socket);
  const { end, link } = controller(transport, engine, {
    session: true,
    // Solo cierra lo que abrió el agente: el Chrome del usuario sigue abierto.
    shutdown(targets) {
      Promise.allSettled(targets.map((targetId) => transport.send('Target.closeTarget', { targetId })))
        .finally(() => { try { socket.close(); } catch { } });
    },
  });
  socket.addEventListener('close', end);
  socket.addEventListener('error', end);
  try {
    await transport.send('Target.setDiscoverTargets', { discover: true });
  } catch (error) {
    socket.close();
    throw Object.assign(new Error(`No se pudo usar tu sesión de Chrome. ${ENABLE_HINT}`), { code: 'ENGINE_START', cause: error });
  }
  return link;
}

// Firefox no admite CDP desde la versión 141: se controla por WebDriver BiDi. Solo escucha en
// 127.0.0.1 con un puerto aleatorio y acepta una sola sesión, la que abre Antares al arrancar.
const FIREFOX_START_MS = 30_000;
const FIREFOX_PREFS = {
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.page': 0,
  'browser.startup.homepage_override.mstone': 'ignore',
  'browser.aboutwelcome.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'permissions.default.geo': 2,
  'permissions.default.desktop-notification': 2,
  'permissions.default.camera': 2,
  'permissions.default.microphone': 2,
  'browser.download.always_ask_before_handling_new_types': true,
  'network.dns.disablePrefetch': true,
  'network.prefetch-next': false,
  'network.http.speculative-parallel-limit': 0,
  'network.predictor.enabled': false,
};

function firefoxArgs(profileDir) {
  return ['--remote-debugging-port=0', '--profile', profileDir, '--no-remote', '--new-instance', 'about:blank'];
}

function writeFirefoxPrefs(profileDir) {
  const lines = Object.entries(FIREFOX_PREFS).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`);
  fs.writeFileSync(path.join(profileDir, 'user.js'), `${lines.join('\n')}\n`);
}

function bidiEndpoint(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(Object.assign(new Error(error), { code: 'ENGINE_START' }));
      else resolve(value);
    };
    const timer = setTimeout(() => finish('Firefox no abrió WebDriver BiDi a tiempo; ciérralo si ya estaba abierto con el perfil del agente'), timeoutMs);
    const read = (chunk) => {
      output = `${output}${chunk}`.slice(-4_000);
      const found = output.match(/WebDriver BiDi listening on (ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+)/);
      if (found) finish(null, found[1]);
    };
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      stream.setEncoding('utf8');
      stream.on('data', read);
    }
    child.once('exit', () => finish('Firefox se cerró al arrancar; si ya está abierto con el perfil del agente, ciérralo y vuelve a intentarlo'));
  });
}

async function launchFirefox(engine, { profileRoot, spawn, WebSocketImpl, startMs }) {
  const profileDir = path.join(profileRoot || defaultProfileRoot(), engine.id);
  fs.mkdirSync(profileDir, { recursive: true });
  writeFirefoxPrefs(profileDir);
  const child = spawn(engine.path, firefoxArgs(profileDir), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  let transport = null;
  let socket = null;
  try {
    const endpoint = await bidiEndpoint(child, startMs);
    socket = await openSocket(`${endpoint}/session`, WebSocketImpl, startMs);
    transport = bidiTransport(socket);
    await transport.send('session.new', { capabilities: {} });
    await transport.send('session.subscribe', { events: ['browsingContext', 'log.entryAdded', 'network'] });
    await transport.send('network.addIntercept', { phases: ['beforeRequestSent', 'responseStarted'] });
  } catch (error) {
    try { if (socket) socket.close(); } catch { }
    child.kill();
    throw error.code === 'ENGINE_START' ? error
      : Object.assign(new Error('No se pudo controlar Firefox; ciérralo si ya está abierto con el perfil del agente y vuelve a intentarlo'),
        { code: 'ENGINE_START', cause: error });
  }

  const exitHandlers = new Set();
  const owners = new Map();
  const popups = new Map();
  const opened = new Set();
  let policy = null;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    transport.close(Object.assign(new Error(`${engine.label} se cerró`), { code: 'ENGINE_CLOSED' }));
    for (const context of opened) transport.emit({ method: 'browsingContext.contextDestroyed', params: { context } });
    for (const handler of exitHandlers) handler();
  };
  child.on('exit', end);
  child.on('error', end);
  socket.addEventListener('close', end);
  const answer = (method, request) => transport.send(method, { request }).catch(() => { });
  // La intercepción es de todo el navegador: es un perfil dedicado, así que todo lo que carga pasa por la política.
  transport.on(({ method, params = {} }) => {
    if (method === 'browsingContext.contextCreated') {
      const owner = owners.get(params.parent || params.originalOpener);
      if (owner && params.parent) owners.set(params.context, owner);
      else if (owner) popups.set(params.context, owner);
    } else if (method === 'browsingContext.contextDestroyed') {
      if (!opened.has(params.context)) owners.delete(params.context);
      popups.delete(params.context);
    } else if (method === 'network.beforeRequestSent' && params.isBlocked) {
      const request = params.request || {};
      const popup = popups.get(params.context);
      if (popup && params.navigation) {
        // Una ventana emergente no carga: se cierra y su dirección se abre en la pestaña del agente.
        popups.delete(params.context);
        answer('network.failRequest', request.request);
        transport.send('browsingContext.close', { context: params.context }).catch(() => { });
        popup.onPopup(String(request.url || ''));
        return;
      }
      const tab = owners.get(params.context);
      const allow = tab ? tab.allow : policy;
      const mainFrame = !!tab && !!params.navigation && params.context === tab.context;
      Promise.resolve(allow ? allow(String(request.url || ''), tab ? tab.pageUrl() : '', mainFrame) : true).catch(() => false)
        .then((ok) => answer(ok ? 'network.continueRequest' : 'network.failRequest', request.request));
    } else if (method === 'network.responseStarted' && params.isBlocked) {
      const headers = ((params.response || {}).headers || [])
        .map((item) => ({ name: item.name, value: item.value && typeof item.value === 'object' ? item.value.value : item.value }));
      answer(attachment(headers) ? 'network.failRequest' : 'network.continueResponse', (params.request || {}).request);
    }
  });

  return {
    id: engine.id,
    label: engine.label,
    session: false,
    onExit(handler) { exitHandlers.add(handler); },
    async openTab({ allow, onPopup }) {
      policy = policy || allow;
      const { context } = await transport.send('browsingContext.create', { type: 'tab' });
      opened.add(context);
      let contents = null;
      const tab = { context, allow, onPopup, pageUrl: () => (contents ? contents.getURL() : '') };
      owners.set(context, tab);
      contents = await createBidiContents(transport, { context });
      contents.once('destroyed', () => { opened.delete(context); owners.delete(context); });
      return contents;
    },
    close() {
      if (ended) return;
      transport.send('browser.close').catch(() => { });
      const timer = setTimeout(() => { if (!ended) child.kill(); }, CLOSE_GRACE_MS);
      if (timer.unref) timer.unref();
    },
  };
}

async function launch(id, {
  profileRoot, spawn = require('node:child_process').spawn, engines = detect(),
  readFile = fs.readFileSync, WebSocketImpl = globalThis.WebSocket, acceptMs = SESSION_ACCEPT_MS, startMs = FIREFOX_START_MS,
} = {}) {
  const engine = engines.find((item) => item.id === id);
  if (!engine) throw Object.assign(new Error('Ese navegador no está instalado'), { code: 'ENGINE_MISSING' });
  if (engine.session) return connectSession(engine, { readFile, WebSocketImpl, acceptMs });
  if (engine.protocol === 'bidi') return launchFirefox(engine, { profileRoot, spawn, WebSocketImpl, startMs });
  return launchDedicated(engine, { profileRoot, spawn });
}

module.exports = { ENGINES, FIREFOX_PREFS, label, isSession, detect, launch, launchArgs, firefoxArgs, pipeTransport, socketTransport, attachment };
