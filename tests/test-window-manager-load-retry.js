// El reintento manual de la página de fallo de carga se captura con before-input-event
// en el proceso principal: la CSP de producción no permite script en una página data:
// y renderer-trust rechaza ese frame, así que no puede ser un botón.

const { EventEmitter } = require('events');
const { assert, finish, stubModule, evictModule, installInertTimers } = require('./helpers/harness');

function makeHarness() {
  const state = { loadFileCalls: 0, loadURLCalls: [], logEvents: [], currentURL: 'file:///app/dist/index.html' };

  const webContents = new EventEmitter();
  webContents.session = { webRequest: { onHeadersReceived: () => {} } };
  webContents.setBackgroundThrottling = () => {};
  webContents.setWindowOpenHandler = () => {};
  webContents.isLoadingMainFrame = () => false;
  webContents.openDevTools = () => {};
  webContents.getURL = () => state.currentURL;

  const win = new EventEmitter();
  win.webContents = webContents;
  win.isDestroyed = () => false;
  win.show = () => {};
  win.maximize = () => {};
  win.isVisible = () => true;
  win.loadFile = () => {
    state.loadFileCalls += 1;
    return state.loadFileRejects ? Promise.reject(new Error('load_file fallo')) : Promise.resolve();
  };
  win.loadURL = (url) => {
    state.loadURLCalls.push(url);
    state.currentURL = url;
    return Promise.resolve();
  };

  state.win = win;
  stubModule('electron', {
    BrowserWindow: function FakeBrowserWindow() { return win; },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1280, height: 800 } }) },
    app: { isPackaged: true },
    shell: { openExternal: () => Promise.resolve() },
  });
  stubModule('electron/app-log.js', {
    appendLogEvent: (...args) => state.logEvents.push(args),
  });

  evictModule('electron/window-manager.js');
  return state;
}

function fireReload(webContents, { key = 'r', control = true, meta = false, type = 'keyDown' } = {}) {
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  webContents.emit('before-input-event', event, { type, key, control, meta });
  return event;
}

async function main() {
  const timers = installInertTimers({ isInert: (delay) => delay === 20_000 });
  try {
    const state = makeHarness();
    const { createWindow } = require('../electron/window-manager.js');
    createWindow(false);

    assert(state.loadFileCalls === 1, 'createWindow carga el renderer empaquetado con loadFile');

    // Fallo de carga -> reintento automático -> segundo fallo -> página de fallo.
    state.loadFileRejects = true;
    state.win.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', true);
    await new Promise((resolve) => timers.original.setTimeout(resolve, 25));

    assert(state.loadURLCalls.length === 1, 'el segundo fallo muestra la página de recuperación');
    const page = decodeURIComponent(state.loadURLCalls[0].replace('data:text/html;charset=utf-8,', ''));
    assert(page.includes('Ctrl+R'), 'la página de fallo anuncia la tecla de reintento');
    assert(!page.includes('Ver → Recargar'), 'la página ya no promete un menú inalcanzable');

    // Ctrl+R sobre la página data: reintenta la carga real.
    const beforeManual = state.loadFileCalls;
    let event = fireReload(state.win.webContents);
    assert(event.prevented === true, 'Ctrl+R en la página de fallo consume el evento');
    assert(state.loadFileCalls === beforeManual + 1, 'Ctrl+R en la página de fallo vuelve a cargar el renderer');

    // Ctrl+R con el renderer sano no cambia de comportamiento (antes no había acelerador).
    state.loadFileRejects = false;
    state.currentURL = 'file:///app/dist/index.html';
    const before = state.loadFileCalls;
    event = fireReload(state.win.webContents);
    assert(event.prevented === false, 'Ctrl+R fuera de la página de fallo no se intercepta');
    assert(state.loadFileCalls === before, 'Ctrl+R con el renderer cargado no recarga');

    // Sin modificador y con otra tecla, no dispara.
    state.currentURL = 'data:text/html;charset=utf-8,x';
    const unmodified = fireReload(state.win.webContents, { control: false });
    assert(unmodified.prevented === false, 'la tecla R sin Control no dispara el reintento');
    const otherKey = fireReload(state.win.webContents, { key: 'w' });
    assert(otherKey.prevented === false, 'Control+W no dispara el reintento');
    const keyUp = fireReload(state.win.webContents, { type: 'keyUp' });
    assert(keyUp.prevented === false, 'keyUp no dispara el reintento');

    state.win.emit('ready-to-show');
    const readyEvent = state.logEvents.find(([, event, fields]) =>
      event === 'renderer.lifecycle' && fields.reason === 'ready_to_show',
    );
    assert(readyEvent !== undefined, 'ready-to-show records the desktop startup duration');
    assert(Number.isFinite(readyEvent[2].duration_ms), 'ready-to-show duration is finite');
  } finally {
    timers.restore();
    evictModule('electron/window-manager.js');
  }
}

main().then(finish).catch((err) => {
  console.error(err);
  process.exit(1);
});
