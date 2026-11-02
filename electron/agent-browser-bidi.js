'use strict';

const { EventEmitter } = require('node:events');
const { allowed } = require('./agent-browser-cdp');

// Adaptador PageContents para Firefox (ADR 0005, fase 4): WebDriver BiDi en lugar
// de CDP. Traduce las órdenes CDP que usan las herramientas web_* y emite los
// eventos de red con forma CDP para que web_network y page_reported no cambien.

const CONSOLE_LEVELS = { error: 'error', warn: 'warning', debug: 'debug' };
const SPECIAL_KEYS = {
  Enter: '', Tab: '', Escape: '', Backspace: '', Delete: '', Home: '', End: '',
  PageUp: '', PageDown: '', ArrowUp: '', ArrowDown: '', ArrowLeft: '', ArrowRight: '',
};
const MODIFIER_KEYS = [[1, ''], [2, ''], [4, ''], [8, '']];
const BUTTONS = { left: 0, middle: 1, right: 2 };

// Respuestas por id y eventos con el formato de WebDriver BiDi sobre WebSocket.
function bidiTransport(socket) {
  const pending = new Map();
  const listeners = new Set();
  let seq = 0;
  let closed = null;
  const emit = (message) => { for (const listener of [...listeners]) listener(message); };
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const call = message.id !== undefined ? pending.get(message.id) : null;
    if (call) {
      pending.delete(message.id);
      if (message.type === 'error') {
        call.reject(Object.assign(new Error(`${message.error}: ${message.message || ''}`.trim()), { code: 'BIDI_ERROR', bidi: message.error }));
      } else {
        call.resolve(message.result || {});
      }
    } else if (message.type === 'event') {
      emit({ method: message.method, params: message.params || {} });
    }
  });
  return {
    send(method, params = {}) {
      if (closed) return Promise.reject(closed);
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
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

function header(headers = [], name) {
  const found = headers.find((item) => String(item.name).toLowerCase() === name);
  return found ? String(found.value && typeof found.value === 'object' ? found.value.value : found.value || '') : '';
}

// Las expresiones de las herramientas son llamadas (() => …)(): se devuelven como JSON, igual que executeJavaScript.
function wrap(code) {
  return `(async () => JSON.stringify(await (${String(code).trim().replace(/;+$/, '')}\n)))()`;
}

function unwrap(response) {
  if (response.type === 'exception') {
    const details = response.exceptionDetails || {};
    throw new Error(String(details.text || 'Error al ejecutar el script'));
  }
  const result = response.result || {};
  return result.type === 'string' ? JSON.parse(result.value) : undefined;
}

function keyValue(key) {
  if (SPECIAL_KEYS[key]) return SPECIAL_KEYS[key];
  return key === 'Space' ? ' ' : String(key || '');
}

function textKeys(text) {
  return [...String(text)].flatMap((char) => [{ type: 'keyDown', value: char }, { type: 'keyUp', value: char }]);
}

async function createBidiContents(transport, { context, imageFromBuffer = (buffer) => require('electron').nativeImage.createFromBuffer(buffer) }) {
  const contents = new EventEmitter();
  const debuggerEvents = new EventEmitter();
  const page = { url: 'about:blank', title: '', loading: false, destroyed: false, history: ['about:blank'], index: 0, traversing: 0 };
  const loads = new Set();
  const nodes = new Map();
  let attached = false;
  let nodeSeq = 0;
  const call = (method, params) => transport.send(method, params);
  const settleLoads = (error) => {
    for (const load of [...loads]) { loads.delete(load); if (error) load.reject(error); else load.resolve(); }
  };
  const evaluate = async (code, { sandbox, gesture } = {}) => unwrap(await call('script.evaluate', {
    expression: wrap(code), target: { context, ...(sandbox ? { sandbox } : {}) }, awaitPromise: true,
    resultOwnership: 'none', userActivation: !!gesture,
  }));
  const refreshTitle = () => evaluate('document.title').then((title) => {
    if (typeof title === 'string' && title !== page.title) {
      page.title = title;
      contents.emit('page-title-updated', {}, title);
    }
  }).catch(() => { });
  // BiDi no expone el historial: se lleva aquí, como lo vería el usuario con atrás y adelante.
  const recordNavigation = (url) => {
    if (page.traversing > 0) { page.traversing -= 1; return; }
    if (page.history[page.index] === url) return;
    page.history = [...page.history.slice(0, page.index + 1), url];
    page.index = page.history.length - 1;
  };
  const destroy = () => {
    if (page.destroyed) return;
    page.destroyed = true;
    settleLoads(new Error('La pestaña de Firefox se cerró'));
    unsubscribe();
    contents.emit('destroyed');
  };
  const network = (method, params) => debuggerEvents.emit('message', {}, method, params);

  // Los iframes son contextos hijos: su red y su consola cuentan; su carga, no.
  const frames = new Set();
  const unsubscribe = transport.on(({ method, params = {} }) => {
    const from = params.context ?? (params.source && params.source.context);
    if (method === 'browsingContext.contextCreated' && params.parent && (params.parent === context || frames.has(params.parent))) {
      frames.add(params.context);
      return;
    }
    if (method === 'browsingContext.contextDestroyed' && frames.delete(from)) return;
    if (from !== context && !(frames.has(from) && /^(?:network|log)\./.test(method))) return;
    if (method === 'browsingContext.navigationStarted') {
      page.loading = true;
      contents.emit('did-start-loading');
    } else if (method === 'browsingContext.domContentLoaded') {
      page.url = String(params.url || page.url);
      recordNavigation(page.url);
      contents.emit('dom-ready');
      contents.emit('did-navigate', {}, page.url);
    } else if (method === 'browsingContext.load') {
      page.url = String(params.url || page.url);
      page.loading = false;
      contents.emit('did-stop-loading');
      settleLoads();
      refreshTitle();
    } else if (method === 'browsingContext.fragmentNavigated') {
      page.url = String(params.url || page.url);
      recordNavigation(page.url);
      contents.emit('did-navigate-in-page', {}, page.url);
    } else if (method === 'browsingContext.contextDestroyed') {
      destroy();
    } else if (method === 'log.entryAdded') {
      contents.emit('console-message', { level: CONSOLE_LEVELS[params.level] || 'info', message: String(params.text || '') });
    } else if (method === 'network.beforeRequestSent') {
      const request = params.request || {};
      network('Network.requestWillBeSent', { requestId: request.request, request: { method: request.method, url: request.url },
        type: params.navigation ? 'Document' : '' });
    } else if (method === 'network.responseCompleted') {
      const request = params.request || {};
      network('Network.responseReceived', { requestId: request.request, response: { status: (params.response || {}).status, url: request.url } });
    } else if (method === 'network.fetchError') {
      network('Network.loadingFailed', { requestId: (params.request || {}).request, errorText: String(params.errorText || 'falló') });
    }
  });

  const pointer = (actions) => call('input.performActions', {
    context, actions: [{ type: 'pointer', id: 'raton', parameters: { pointerType: 'mouse' }, actions }],
  });
  const keys = (actions) => call('input.performActions', { context, actions: [{ type: 'key', id: 'teclado', actions }] });

  // Traducción de las órdenes CDP permitidas que usan las herramientas web_*.
  const translate = async (method, params = {}) => {
    if (['Emulation.setFocusEmulationEnabled', 'Network.enable', 'Page.enable'].includes(method)) return {};
    if (method === 'Input.dispatchMouseEvent') {
      const move = { type: 'pointerMove', x: Math.round(params.x), y: Math.round(params.y), duration: 0 };
      const button = BUTTONS[params.button] ?? 0;
      if (params.type === 'mouseMoved') await pointer([move]);
      else if (params.type === 'mousePressed') await pointer([move, { type: 'pointerDown', button }]);
      else if (params.type === 'mouseReleased') await pointer([move, { type: 'pointerUp', button }]);
      return {};
    }
    if (method === 'Input.dispatchKeyEvent') {
      const mask = Number(params.modifiers) || 0;
      const held = MODIFIER_KEYS.filter(([bit]) => mask & bit).map(([, value]) => value);
      const value = keyValue(params.key);
      if (params.type === 'keyDown') await keys([...held.map((key) => ({ type: 'keyDown', value: key })), { type: 'keyDown', value }]);
      else await keys([{ type: 'keyUp', value }, ...held.reverse().map((key) => ({ type: 'keyUp', value: key }))]);
      return {};
    }
    if (method === 'Input.insertText') {
      await keys(textKeys(params.text));
      return {};
    }
    if (method === 'Page.captureScreenshot') {
      const format = params.format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: (Number(params.quality) || 80) / 100 };
      return call('browsingContext.captureScreenshot', { context, origin: params.captureBeyondViewport ? 'document' : 'viewport', format });
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 0 } };
    if (method === 'DOM.querySelector') {
      const response = await call('script.evaluate', { expression: `document.querySelector(${JSON.stringify(String(params.selector))})`,
        target: { context }, awaitPromise: false, resultOwnership: 'root' });
      const node = response.result || {};
      if (response.type === 'exception' || node.type !== 'node' || !node.sharedId) return { nodeId: 0 };
      nodes.set(++nodeSeq, node.sharedId);
      return { nodeId: nodeSeq };
    }
    if (method === 'DOM.setFileInputFiles') {
      const sharedId = nodes.get(params.nodeId);
      if (!sharedId) throw new Error('El campo de archivo ya no está en la página');
      await call('input.setFiles', { context, element: { sharedId }, files: (params.files || []).map(String) });
      return {};
    }
    throw Object.assign(new Error(`La orden ${method} no está disponible en Firefox`), { code: 'BIDI_UNSUPPORTED' });
  };

  Object.assign(contents, {
    isDestroyed: () => page.destroyed,
    getURL: () => page.url,
    getTitle: () => page.title,
    isLoading: () => page.loading,
    getZoomFactor: () => 1,
    setZoomFactor: () => {},
    executeJavaScript: (code, userGesture = false) => evaluate(code, { gesture: userGesture }),
    async executeJavaScriptInIsolatedWorld(worldId, scripts, userGesture = false) {
      let value;
      for (const script of scripts) value = await evaluate(script.code, { sandbox: `antares-${worldId}`, gesture: userGesture });
      return value;
    },
    async loadURL(url) {
      const done = new Promise((resolve, reject) => loads.add({ resolve, reject }));
      done.catch(() => { });
      try {
        await call('browsingContext.navigate', { context, url: String(url), wait: 'none' });
      } catch (error) {
        settleLoads(new Error(`${error.message} cargando ${url}`));
      }
      return done;
    },
    reload() { call('browsingContext.reload', { context }).catch(() => { }); },
    navigationHistory: {
      canGoBack: () => page.index > 0,
      canGoForward: () => page.index < page.history.length - 1,
      goBack() {
        if (page.index <= 0) return;
        page.index -= 1;
        page.traversing += 1;
        call('browsingContext.traverseHistory', { context, delta: -1 }).catch(() => { });
      },
      goForward() {
        if (page.index >= page.history.length - 1) return;
        page.index += 1;
        page.traversing += 1;
        call('browsingContext.traverseHistory', { context, delta: 1 }).catch(() => { });
      },
    },
    async capturePage() {
      const shot = await call('browsingContext.captureScreenshot', { context, origin: 'viewport', format: { type: 'image/png' } });
      return imageFromBuffer(Buffer.from(String(shot.data || ''), 'base64'));
    },
    close() { call('browsingContext.close', { context }).catch(() => { }); },
    debugger: Object.assign(debuggerEvents, {
      isAttached: () => attached,
      attach: () => { attached = true; },
      detach: () => { attached = false; },
      async sendCommand(method, params = {}) {
        if (!allowed(method)) throw Object.assign(new Error(`El navegador del agente no permite la orden CDP ${method}`), { code: 'CDP_FORBIDDEN' });
        return translate(method, params);
      },
    }),
  });
  return contents;
}

module.exports = { createBidiContents, bidiTransport, wrap, keyValue, header };
