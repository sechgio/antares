'use strict';

const { EventEmitter } = require('node:events');

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node:dns') {
    return { promises: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { assert, finish, stubModule, installInertTimers } = require('./helpers/harness');

function fakeContents(url = '') {
  const contents = Object.assign(new EventEmitter(), {
    url, title: '', destroyed: false, loads: [],
    isDestroyed() { return contents.destroyed; },
    getURL() { return contents.url; },
    getTitle() { return contents.title; },
    isLoading() { return false; },
    getZoomFactor() { return 1; },
    setZoomFactor() {},
    navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} },
    setWindowOpenHandler() {},
    loadURL: async (next) => { contents.loads.push(next); contents.url = next; contents.title = next; },
    reload() {},
    executeJavaScript: async () => ({ url: contents.url, title: contents.title, text: 'Hola', elements: [], time_origin: 1 }),
    executeJavaScriptInIsolatedWorld: async () => ({ url: contents.url, time_origin: 1 }),
    debugger: Object.assign(new EventEmitter(), { isAttached: () => false, attach: () => {}, sendCommand: async () => ({}) }),
    close() { if (!contents.destroyed) { contents.destroyed = true; contents.emit('destroyed'); } },
  });
  return contents;
}

function makeElectronStub() {
  const instances = new Map();
  const views = [];
  const main = {
    isDestroyed: () => false, getContentSize: () => [1000, 700], destroy: () => {}, on: () => {},
    showInactive: () => {}, setIgnoreMouseEvents: () => {},
    webContents: { getZoomFactor: () => 1, send: () => {} },
    contentView: { addChildView: () => {}, removeChildView: () => {} },
  };
  const electronStub = {
    BrowserWindow: function () { return main; },
    WebContentsView: function (opts) {
      const view = { webContents: fakeContents(), partition: opts?.webPreferences?.session?.partitionId ?? null,
        setBounds() {}, getBounds: () => ({ width: 1280, height: 860 }) };
      views.push(view);
      return view;
    },
    session: {
      fromPartition: (partition) => {
        if (!instances.has(partition)) {
          const created = {
            permissionRequests: 0, checks: 0, beforeRequest: null, events: [], partitionId: partition,
            setPermissionRequestHandler() { this.permissionRequests += 1; },
            setPermissionCheckHandler() { this.checks += 1; },
            getUserAgent: () => 'Mozilla/5.0 Chrome/1 Electron/1',
            setUserAgent() {},
          };
          created.webRequest = { onBeforeRequest: (_filter, listener) => { created.beforeRequest = listener; } };
          created.on = (event, handler) => {
            created.events.push(event);
            if (event === 'will-download') created.downloadHandler = handler;
          };
          instances.set(partition, created);
        }
        return instances.get(partition);
      },
    },
  };
  stubModule('electron', electronStub);
  stubModule('electron/window-manager.js', { getMainWindow: () => main });
  stubModule('electron/agent-browser-policy.js', {
    hostOf: (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } },
    isBlocked: () => false,
    isAlwaysAllowed: () => false,
  });
  return { electronStub, instances, views };
}

async function main() {
  const { instances, views } = makeElectronStub();
  const browser = require('../electron/agent-browser');
  const timers = installInertTimers();
  try {
    browser.dock({ x: 0, y: 0, width: 400, height: 500 });

    await browser.navigate('open', 'https://agente.example', 'agent');
    const agentPartition = instances.get('persist:antares-agent-browser');
    assert(agentPartition, 'la pestaña del agente vive en su partición persistente');
    assert(views[0].partition === 'persist:antares-agent-browser', 'la vista del agente se crea tras resolver su partición');
    assert(agentPartition.permissionRequests === 1 && agentPartition.checks === 1 && typeof agentPartition.beforeRequest === 'function'
      && agentPartition.events.includes('will-download'),
      'la partición del agente instala permisos, red y descargas una sola vez');

    browser.newTab();
    browser.setUserControl(true, 'tab-1');
    await browser.navigate('open', 'https://usuario.example', 'tab-1');
    const userPartition = instances.get('persist:antares-agent-user');
    assert(userPartition && views[1].partition === 'persist:antares-agent-user',
      'la pestaña del usuario vive en una partición separada');
    assert(userPartition !== agentPartition && userPartition.permissionRequests === 1 && typeof userPartition.beforeRequest === 'function'
      && userPartition.events.includes('will-download'),
      'la partición del usuario también recibe sus propias barreras');
    assert(views.length === 2, 'cada pestaña construye su propia vista');

    const agentView = views[0];
    browser.setUserControl(true, 'agent');
    assert(!agentView.webContents.isDestroyed() && views.length === 2
      && agentView.partition === 'persist:antares-agent-browser',
      'tomar el control del agente no recrea su vista ni la saca de su sesión');
    browser.allowAgent('agent');
    assert(!agentView.webContents.isDestroyed() && browser.state().tabs[0].url === 'https://agente.example',
      'devolver el control conserva la vista y su página');
    browser.setUserControl(true, 'agent');
    browser.setUserControl(false, 'agent');
    assert(views.length === 2 && !views.some((view) => view !== agentView && view !== views[1]),
      'alternar el control no crea vistas nuevas');

    const userSession = instances.get('persist:antares-agent-user');
    let cancelled = false;
    let savedPath = null;
    userSession.downloadHandler({ preventDefault() { } }, {
      getURLChain: () => ['https://usuario.example/archivo'],
      getFilename: () => 'archivo',
      setSavePath: (value) => { savedPath = value; },
      getTotalBytes: () => 10,
      getReceivedBytes: () => 0,
      on: () => { },
      once: () => { },
      cancel: () => { cancelled = true; },
    });
    assert(cancelled && savedPath === null, 'una descarga que no pidió la herramienta se cancela');
  } finally {
    timers.restore();
    browser.close();
  }
}

main().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
