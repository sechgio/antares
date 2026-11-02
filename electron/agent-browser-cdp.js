'use strict';

const { EventEmitter } = require('node:events');

// Adaptador PageContents (ADR 0005): presenta una pestaña de un Chromium externo,
// controlada por CDP, con el subconjunto de WebContents que usan las herramientas web_*.
// El transporte se inyecta: { send(method, params, sessionId) → Promise, on(listener) → unsubscribe }.
// Quien lo abre activa Target.setDiscoverTargets en el navegador: de ahí salen el título y el cierre.

const FORBIDDEN_PAGE = new Set(['Page.setDownloadBehavior']);
const ALLOWED_EXACT = new Set(['Runtime.evaluate', 'Network.enable', 'Emulation.setFocusEmulationEnabled']);
const CONSOLE_LEVELS = { error: 'error', assert: 'error', warning: 'warning', debug: 'debug' };

function allowed(method) {
  const name = String(method || '');
  if (ALLOWED_EXACT.has(name)) return true;
  if (name.startsWith('Page.')) return !FORBIDDEN_PAGE.has(name);
  return name.startsWith('Input.') || name.startsWith('DOM.');
}

function forbidden(method) {
  return Object.assign(new Error(`El navegador del agente no permite la orden CDP ${method}`), { code: 'CDP_FORBIDDEN' });
}

function evaluationError(details) {
  const exception = details.exception || {};
  return new Error(String(exception.description || exception.value || details.text || 'Error al ejecutar el script'));
}

function consoleText(args = []) {
  return args.map((arg) => (arg.value !== undefined ? String(arg.value) : String(arg.description || arg.type || ''))).join(' ');
}

function defaultImage(buffer) {
  return require('electron').nativeImage.createFromBuffer(buffer);
}

async function createCdpContents(transport, { targetId, sessionId, imageFromBuffer = defaultImage }) {
  const contents = new EventEmitter();
  const debuggerEvents = new EventEmitter();
  const page = { url: '', title: '', loading: false, destroyed: false, history: { index: 0, entries: [] }, frameId: null };
  const loads = new Set();
  let attached = false;
  const call = (method, params = {}) => transport.send(method, params, sessionId);
  const browserCall = (method, params = {}) => transport.send(method, params);

  const refreshHistory = async () => {
    try {
      const history = await call('Page.getNavigationHistory');
      page.history = { index: history.currentIndex, entries: history.entries || [] };
    } catch { }
  };
  const settleLoads = (error) => {
    for (const load of [...loads]) { loads.delete(load); if (error) load.reject(error); else load.resolve(); }
  };
  const destroy = () => {
    if (page.destroyed) return;
    page.destroyed = true;
    settleLoads(new Error('La pestaña del navegador externo se cerró'));
    unsubscribe();
    contents.emit('destroyed');
  };

  const onPageEvent = (method, params) => {
    const main = !params.frame?.parentId && (!params.frameId || params.frameId === page.frameId);
    if (method === 'Page.frameStartedLoading' && main) {
      page.loading = true;
      contents.emit('did-start-loading');
    } else if (method === 'Page.frameStoppedLoading' && main) {
      page.loading = false;
      contents.emit('did-stop-loading');
      settleLoads();
    } else if (method === 'Page.domContentEventFired') {
      contents.emit('dom-ready');
    } else if (method === 'Page.loadEventFired') {
      settleLoads();
    } else if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      page.frameId = params.frame.id;
      page.url = String(params.frame.url || '') + String(params.frame.urlFragment || '');
      refreshHistory().then(() => contents.emit('did-navigate', {}, page.url));
    } else if (method === 'Page.navigatedWithinDocument' && params.frameId === page.frameId) {
      page.url = String(params.url || '');
      refreshHistory().then(() => contents.emit('did-navigate-in-page', {}, page.url));
    } else if (method === 'Runtime.consoleAPICalled') {
      contents.emit('console-message', { level: CONSOLE_LEVELS[params.type] || 'info', message: consoleText(params.args) });
    }
  };

  const unsubscribe = transport.on(({ method, params = {}, sessionId: from }) => {
    if (from === sessionId) {
      onPageEvent(method, params);
      debuggerEvents.emit('message', {}, method, params, from);
    } else if (!from && method === 'Target.targetInfoChanged' && params.targetInfo?.targetId === targetId) {
      const titleChanged = params.targetInfo.title !== page.title;
      page.title = String(params.targetInfo.title || '');
      if (params.targetInfo.url) page.url = String(params.targetInfo.url);
      if (titleChanged) contents.emit('page-title-updated', {}, page.title);
    } else if (!from && ((method === 'Target.targetDestroyed' && params.targetId === targetId)
      || (method === 'Target.detachedFromTarget' && params.sessionId === sessionId))) {
      destroy();
    }
  });

  Object.assign(contents, {
    isDestroyed: () => page.destroyed,
    getURL: () => page.url,
    getTitle: () => page.title,
    isLoading: () => page.loading,
    getZoomFactor: () => 1,
    setZoomFactor: () => {},
    async executeJavaScript(code, userGesture = false) {
      const { result = {}, exceptionDetails } = await call('Runtime.evaluate',
        { expression: String(code), returnByValue: true, awaitPromise: true, userGesture: !!userGesture });
      if (exceptionDetails) throw evaluationError(exceptionDetails);
      return result.value;
    },
    // Mundo aislado recién creado en cada llamada: un contexto de una navegación anterior ya no existe.
    async executeJavaScriptInIsolatedWorld(worldId, scripts, userGesture = false) {
      const { executionContextId } = await call('Page.createIsolatedWorld',
        { frameId: page.frameId, worldName: `antares-${worldId}`, grantUniveralAccess: false });
      let value;
      for (const script of scripts) {
        const { result = {}, exceptionDetails } = await call('Runtime.evaluate', { expression: String(script.code),
          contextId: executionContextId, returnByValue: true, awaitPromise: true, userGesture: !!userGesture });
        if (exceptionDetails) throw evaluationError(exceptionDetails);
        value = result.value;
      }
      return value;
    },
    async loadURL(url) {
      const done = new Promise((resolve, reject) => loads.add({ resolve, reject }));
      done.catch(() => { });
      const result = await call('Page.navigate', { url: String(url) });
      if (result.errorText) {
        settleLoads(new Error(`${result.errorText} cargando ${url}`));
        return done;
      }
      if (!result.loaderId) settleLoads();
      return done;
    },
    reload() { call('Page.reload').catch(() => { }); },
    navigationHistory: {
      canGoBack: () => page.history.index > 0,
      canGoForward: () => page.history.index < page.history.entries.length - 1,
      goBack() {
        const entry = page.history.entries[page.history.index - 1];
        if (entry) call('Page.navigateToHistoryEntry', { entryId: entry.id }).catch(() => { });
      },
      goForward() {
        const entry = page.history.entries[page.history.index + 1];
        if (entry) call('Page.navigateToHistoryEntry', { entryId: entry.id }).catch(() => { });
      },
    },
    async capturePage() {
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      return imageFromBuffer(Buffer.from(String(shot.data || ''), 'base64'));
    },
    close() { browserCall('Target.closeTarget', { targetId }).catch(() => { }); },
    debugger: Object.assign(debuggerEvents, {
      isAttached: () => attached,
      attach: () => { attached = true; },
      detach: () => { attached = false; },
      async sendCommand(method, params = {}) {
        if (!allowed(method)) throw forbidden(method);
        return call(method, params);
      },
    }),
  });

  await call('Page.enable');
  await call('Runtime.enable');
  const tree = await call('Page.getFrameTree');
  page.frameId = tree.frameTree.frame.id;
  page.url = String(tree.frameTree.frame.url || '');
  await refreshHistory();
  return contents;
}

module.exports = { createCdpContents, allowed };
