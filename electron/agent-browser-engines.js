'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createCdpContents } = require('./agent-browser-cdp');

// Navegadores Chromium externos (ADR 0005). Con perfil dedicado se lanzan con
// --remote-debugging-pipe, así que solo Antares puede controlarlos; «Mi sesión
// de Chrome» se conecta al Chrome abierto cuando el usuario lo permite.

const ENGINES = [
  { id: 'chrome', label: 'Google Chrome', roots: ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'], file: 'Google\\Chrome\\Application\\chrome.exe' },
  { id: 'edge', label: 'Microsoft Edge', roots: ['PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'], file: 'Microsoft\\Edge\\Application\\msedge.exe' },
  { id: 'brave', label: 'Brave', roots: ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'], file: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
  { id: 'opera', label: 'Opera', roots: ['LOCALAPPDATA'], file: 'Programs\\Opera\\opera.exe', versioned: true },
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
      if (exe) { out.push({ id: engine.id, label: engine.label, path: exe }); break; }
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

async function launch(id, {
  profileRoot, spawn = require('node:child_process').spawn, engines = detect(),
  readFile = fs.readFileSync, WebSocketImpl = globalThis.WebSocket, acceptMs = SESSION_ACCEPT_MS,
} = {}) {
  const engine = engines.find((item) => item.id === id);
  if (!engine) throw Object.assign(new Error('Ese navegador no está instalado'), { code: 'ENGINE_MISSING' });
  if (engine.session) return connectSession(engine, { readFile, WebSocketImpl, acceptMs });
  return launchDedicated(engine, { profileRoot, spawn });
}

module.exports = { ENGINES, label, isSession, detect, launch, launchArgs, pipeTransport, socketTransport, attachment };
