'use strict';

const Module = require('node:module');
const { EventEmitter } = require('node:events');

// el navegador del agente resuelve el DNS de cada destino: en los tests
// toda resolución es pública salvo los nombres «privado»
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node:dns') {
    return { promises: { lookup: async (host) => [{ address: host.includes('privado') ? '10.0.0.5' : '93.184.216.34', family: 4 }] } };
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

async function main() {
  const views = [];
  const mainChildren = new Set();
  const main = {
    isDestroyed: () => false, getContentSize: () => [1000, 700],
    webContents: { getZoomFactor: () => 1, send: () => {} },
    contentView: { addChildView: (child) => mainChildren.add(child), removeChildView: (child) => mainChildren.delete(child) },
  };
  stubModule('electron/window-manager.js', { getMainWindow: () => main });
  stubModule('electron', {
    BrowserWindow: function () {
      return { isDestroyed: () => false, on: () => {}, showInactive: () => {}, setIgnoreMouseEvents: () => {}, destroy: () => {},
        contentView: { addChildView: () => {}, removeChildView: () => {} } };
    },
    WebContentsView: function () {
      const view = { webContents: fakeContents(), setBounds() {}, getBounds: () => ({ width: 1280, height: 860 }) };
      views.push(view);
      return view;
    },
    session: { fromPartition: () => ({ setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {},
      webRequest: { onBeforeRequest: () => {} }, on: () => {}, getUserAgent: () => 'Mozilla/5.0 Chrome/1', setUserAgent: () => {} }) },
  });
  const launches = [];
  const tabs = [];
  let exitHandler = null;
  let linkClosed = 0;
  let sessionAvailable = false;
  stubModule('electron/agent-browser-policy.js', {
    hostOf: (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } },
    isBlocked: (host) => host === 'banco.example',
    isAlwaysAllowed: (host) => host === 'conocido.example',
  });
  stubModule('electron/agent-browser-engines.js', {
    label: (id) => ({ chrome: 'Google Chrome', edge: 'Microsoft Edge', 'chrome-session': 'Mi sesión de Chrome' }[id] || ''),
    isSession: (id) => id === 'chrome-session',
    detect: () => [{ id: 'chrome', label: 'Google Chrome', path: 'C:\\chrome.exe' }, { id: 'edge', label: 'Microsoft Edge', path: 'C:\\msedge.exe' },
      ...(sessionAvailable ? [{ id: 'chrome-session', label: 'Mi sesión de Chrome', session: true, path: 'C:\\User Data' }] : [])],
    launch: async (id) => {
      launches.push(id);
      return {
        id,
        onExit(handler) { exitHandler = handler; },
        async openTab(options) {
          const contents = fakeContents('about:blank');
          tabs.push({ options, contents });
          return contents;
        },
        close() { linkClosed += 1; },
      };
    },
  });
  const browser = require('../electron/agent-browser');
  const timers = installInertTimers();
  try {
    browser.dock({ x: 0, y: 0, width: 400, height: 500 });
    const listed = browser.engines();
    assert(listed.engine === null && listed.available.map((engine) => engine.id).join() === 'chrome,edge'
      && !('path' in listed.available[0]), 'lista los navegadores instalados sin exponer rutas y empieza en el integrado');

    await browser.run('web_open', { url: 'https://antes.example' });
    const builtIn = views[0];
    assert(builtIn && mainChildren.has(builtIn), 'sin navegador externo el agente usa la vista integrada');

    let missing = null;
    try { browser.setEngine('opera'); } catch (error) { missing = error.code; }
    assert(missing === 'ENGINE_MISSING' && browser.state().engine === null, 'no elige un navegador que no está instalado');

    const chosen = browser.setEngine('chrome');
    assert(chosen.engine.id === 'chrome' && chosen.engine.label === 'Google Chrome' && launches.length === 0,
      'elegir Chrome lo indica en el estado sin lanzarlo todavía');
    assert(builtIn.webContents.isDestroyed() && !browser.state().tabs[0].open, 'al cambiar de navegador se cierra la página integrada del agente');

    let previewError = null;
    try { await browser.run('web_open', { url: 'C:\\proyecto\\index.html' }); } catch (error) { previewError = error; }
    assert(previewError && previewError.code === 'PREVIEW_EXTERNAL' && launches.length === 0 && tabs.length === 0,
      'con un navegador externo la vista previa de archivos se rechaza con aviso claro, sin lanzarlo ni abrir pestañas');

    const opened = await browser.run('web_open', { url: 'https://ejemplo.com' });
    const external = tabs[0].contents;
    assert(launches.join() === 'chrome' && views.length === 1 && external.loads.join() === 'https://ejemplo.com'
      && opened.text === 'Hola', 'web_open lanza Chrome, abre su pestaña y lee la página desde allí');
    const state = browser.state();
    assert(state.open && state.url === 'https://ejemplo.com' && state.tabs[0].url === 'https://ejemplo.com',
      'el panel refleja la pestaña externa');
    assert(!mainChildren.has(external), 'la pestaña externa no se monta en la ventana de Antares');

    const { allow } = tabs[0].options;
    assert(allow('file:///C:/secreto.txt', '', true) === false, 'el navegador externo bloquea file:// como el integrado');
    assert(await allow('http://router.privado/admin', '', false) === false && await allow('https://publica.example/', '', true) === true,
      'el navegador externo aplica la misma resolución pública que el integrado');

    tabs[0].options.onPopup('https://emergente.example/');
    tabs[0].options.onPopup('http://192.168.1.1/');
    await Promise.resolve();
    assert(external.loads.join() === 'https://ejemplo.com,https://emergente.example/',
      'una ventana emergente permitida se abre en la pestaña del agente y una privada se descarta');

    await browser.run('web_open', { url: 'https://segunda.example' });
    assert(launches.length === 1 && tabs.length === 1, 'reutiliza el navegador y la pestaña ya abiertos');
    external.close();
    assert(!browser.state().open, 'si el usuario cierra la pestaña externa el panel la da por cerrada');
    await browser.run('web_open', { url: 'https://tercera.example' });
    assert(launches.length === 1 && tabs.length === 2 && tabs[1].contents.loads.join() === 'https://tercera.example',
      'la siguiente apertura crea otra pestaña en el mismo navegador');

    exitHandler();
    tabs[1].contents.close();
    await browser.navigate('open', 'https://cuarta.example', 'agent');
    assert(launches.length === 2 && tabs[2].contents.loads.join() === 'https://cuarta.example',
      'si el usuario cerró el navegador, se vuelve a lanzar al abrir otra página');

    tabs[2].contents.close();
    await Promise.all([browser.run('web_open', { url: 'https://agente.example' }), browser.navigate('open', 'https://usuario.example', 'agent')]);
    assert(tabs.length === 4 && launches.length === 2, 'el agente y la barra de dirección a la vez abren una sola pestaña externa');

    const back = browser.setEngine('integrado');
    await Promise.resolve();
    assert(back.engine === null && tabs[3].contents.isDestroyed() && linkClosed === 1, 'volver al integrado cierra la pestaña y el navegador externos');
    await browser.run('web_open', { url: 'https://despues.example' });
    assert(views.length === 2 && views[1].webContents.loads.join() === 'https://despues.example' && tabs.length === 4,
      'después el agente vuelve a la vista integrada');

    assert(browser.sessionOpenContext({ url: 'nuevo.example' }) === null, 'con el navegador integrado web_open no pide aprobación por dominio');
    browser.setEngine('chrome');
    assert(browser.sessionOpenContext({ url: 'nuevo.example' }) === null, 'con un perfil dedicado tampoco');
    sessionAvailable = true;
    await browser.setEngine('chrome-session');
    const pedido = browser.sessionOpenContext({ url: 'nuevo.example/ruta' });
    assert(pedido && pedido.page_url === 'https://nuevo.example/ruta' && pedido.domain === 'nuevo.example' && pedido.policy_blocked === false,
      'en la sesión de Chrome abrir un dominio nuevo pide aprobación con su dirección y dominio');
    assert(browser.sessionOpenContext({ url: 'https://conocido.example/x' }) === null, 'un dominio permitido siempre se abre sin preguntar');
    assert(browser.sessionOpenContext({ url: 'C:\\proyecto\\index.html' }) === null, 'la vista previa de un archivo local no pide aprobación por dominio');
    assert(browser.sessionOpenContext({ url: 'https://banco.example' }).policy_blocked === true, 'el contexto marca los dominios bloqueados');
    assert(browser.sessionOpenContext({ url: '' }) === null, 'una dirección vacía la rechaza web_open, no la aprobación');
    const { nativeToolContext } = require('../electron/agent-native-tools');
    const context = await nativeToolContext('web_open', 's1', { url: 'nuevo.example' });
    assert(context.page_url === 'https://nuevo.example' && context.domain === 'nuevo.example',
      'la aprobación de web_open guarda la página para «Permitir siempre»');

    // Adjuntar «Mi sesión de Chrome» exige confirmación en el proceso principal (cua-005).
    const electronStub = require('electron');
    browser.setEngine('edge');
    electronStub.dialog = { showMessageBox: async () => ({ response: 1 }) };
    let refused = null;
    try { await browser.setEngine('chrome-session'); } catch (error) { refused = error; }
    assert(refused && refused.code === 'SESSION_CONFIRM_DENIED' && browser.state().engine && browser.state().engine.id === 'edge',
      'cancelar la confirmación deja el navegador del agente como estaba');
    let asked = null;
    electronStub.dialog = { showMessageBox: async (_win, options) => { asked = options; return { response: 0 }; } };
    const accepted = await browser.setEngine('chrome-session');
    assert(accepted.engine.id === 'chrome-session' && asked && asked.cancelId === 1 && /sesión de Chrome/i.test(asked.message),
      'aceptar la confirmación adjunta tu sesión de Chrome con cancelación por defecto');
    delete electronStub.dialog;

    browser.setEngine('edge');
    browser.close();
    assert(browser.state().engine === null, 'cerrar el navegador del agente olvida la elección');
  } finally {
    timers.restore();
    browser.close();
  }
}

main().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
