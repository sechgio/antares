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

let failLoads = false;

function fakeContents(ses) {
  const contents = Object.assign(new EventEmitter(), {
    url: '',
    title: '',
    destroyed: false,
    isDestroyed() {
      return contents.destroyed;
    },
    getURL() {
      return contents.url;
    },
    getTitle() {
      return contents.title;
    },
    isLoading() {
      return false;
    },
    getZoomFactor() {
      return 1;
    },
    setZoomFactor() {},
    navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} },
    setWindowOpenHandler() {},
    loadURL: async (next) => {
      if (failLoads) throw new Error('ERR_CONNECTION_RESET');
      contents.url = next;
      contents.title = next;
      ses.cookies.set(new URL(next).hostname, 'sid=1');
      ses.storage.add(new URL(next).origin);
    },
    reload() {},
    executeJavaScript: async () => ({
      url: contents.url,
      title: contents.title,
      text: 'Hola',
      elements: [],
      time_origin: 1,
    }),
    executeJavaScriptInIsolatedWorld: async () => ({ url: contents.url, time_origin: 1 }),
    debugger: Object.assign(new EventEmitter(), {
      isAttached: () => false,
      attach: () => {},
      sendCommand: async () => ({}),
    }),
    close() {
      if (!contents.destroyed) {
        contents.destroyed = true;
        contents.emit('destroyed');
      }
    },
  });
  return contents;
}

function makeElectronStub() {
  const instances = new Map();
  const views = [];
  const main = {
    isDestroyed: () => false,
    getContentSize: () => [1000, 700],
    destroy: () => {},
    on: () => {},
    showInactive: () => {},
    setIgnoreMouseEvents: () => {},
    webContents: { getZoomFactor: () => 1, send: () => {} },
    contentView: { addChildView: () => {}, removeChildView: () => {} },
  };
  stubModule('electron', {
    BrowserWindow: function () {
      return { ...main, webContents: { ...main.webContents } };
    },
    WebContentsView: function (opts) {
      const ses = opts.webPreferences.session;
      const view = {
        webContents: fakeContents(ses),
        partition: ses.partitionId,
        setBounds() {},
        getBounds: () => ({ width: 1280, height: 860 }),
      };
      views.push(view);
      return view;
    },
    session: {
      fromPartition: (partition) => {
        if (!instances.has(partition)) {
          const created = {
            partitionId: partition,
            cookies: new Map(),
            storage: new Set(),
            cleared: 0,
            cacheCleared: 0,
            setPermissionRequestHandler() {},
            setPermissionCheckHandler() {},
            getUserAgent: () => 'Mozilla/5.0 Chrome/1 Electron/1',
            setUserAgent() {},
            webRequest: { onBeforeRequest() {} },
            on() {},
            clearStorageData: async () => {
              created.cleared += 1;
              created.cookies.clear();
              created.storage.clear();
            },
            clearCache: async () => {
              created.cacheCleared += 1;
            },
          };
          instances.set(partition, created);
        }
        return instances.get(partition);
      },
    },
  });
  stubModule('electron/window-manager.js', { getMainWindow: () => main });
  stubModule('electron/agent-browser-policy.js', {
    hostOf: (url) => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return '';
      }
    },
    isBlocked: (host) => host === 'bloqueado.example',
    isAlwaysAllowed: () => false,
  });
  return { instances, views };
}

async function rejects(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}

async function main() {
  const { instances, views } = makeElectronStub();
  const browser = require('../electron/agent-browser');
  const timers = installInertTimers();
  const realNow = Date.now;
  try {
    const persistentBefore = instances.size;
    await browser.run('web_open', { url: 'https://publico.example' }, { sessionId: 'tarea-1' });
    const first = views[0];
    assert(
      first.partition.startsWith(browser.EPHEMERAL_PREFIX) &&
        !first.partition.startsWith('persist:') &&
        first.partition.includes('tarea-1'),
      'por defecto la tarea navega en una partición efímera en memoria',
    );
    const firstSession = instances.get(first.partition);
    assert(
      firstSession.cookies.size === 1 && firstSession.storage.size === 1,
      'el sitio deja cookies y almacenamiento en la partición',
    );
    assert(
      !instances.has(browser.PARTITION) && instances.size === persistentBefore + 1,
      'una tarea efímera no toca la partición persistente',
    );

    browser.release('tarea-1');
    await Promise.resolve();
    assert(first.webContents.isDestroyed(), 'terminar la tarea cierra la vista efímera');
    assert(
      firstSession.cleared === 1 &&
        firstSession.cacheCleared === 1 &&
        firstSession.cookies.size === 0 &&
        firstSession.storage.size === 0,
      'terminar la tarea borra cookies, almacenamiento y caché de la partición',
    );
    assert(browser.state().tabs[0].open === false, 'tras la tarea no queda página abierta del agente');

    await browser.run('web_open', { url: 'https://publico.example' }, { sessionId: 'tarea-1' });
    const second = views[1];
    assert(
      second.partition !== first.partition &&
        instances.get(second.partition).cookies.size === 1 &&
        firstSession.cookies.size === 0,
      'la siguiente tarea de la misma conversación arranca con otra partición limpia',
    );
    browser.release('tarea-1');

    failLoads = true;
    const loadError = await rejects(
      browser.run('web_open', { url: 'https://falla.example' }, { sessionId: 'tarea-2' }),
    );
    failLoads = false;
    const failed = views[2];
    assert(
      loadError && failed.partition.includes('tarea-2'),
      'un fallo de carga ocurre dentro de la partición efímera',
    );
    browser.release('tarea-2');
    const failedSession = instances.get(failed.partition);
    assert(
      failed.webContents.isDestroyed() && failedSession.cleared === 1 && failedSession.cacheCleared === 1,
      'la partición se limpia y la vista se cierra aunque la tarea terminara con error',
    );

    const blocked = await rejects(
      browser.run('web_open', { url: 'https://bloqueado.example' }, { sessionId: 'tarea-3' }),
    );
    assert(blocked && /bloqueado/.test(blocked.message), 'los dominios bloqueados siguen bloqueados en modo efímero');

    await browser.run('web_open', { url: 'https://cuenta.example', mode: 'persistent' }, { sessionId: 'tarea-4' });
    const persistent = views[views.length - 1];
    assert(persistent.partition === browser.PARTITION, 'mode=persistent usa la partición persistente de siempre');
    browser.release('tarea-4');
    const persistentSession = instances.get(browser.PARTITION);
    assert(
      !persistent.webContents.isDestroyed() && persistentSession.cleared === 0 && persistentSession.cookies.size === 1,
      'terminar una tarea persistente conserva la vista, las cookies y el almacenamiento',
    );

    await browser.run(
      'web_open',
      { url: 'https://cuenta.example' },
      { sessionId: 'tarea-5', browserMode: 'persistent' },
    );
    assert(
      views[views.length - 1].partition === browser.PARTITION && views.length === 4,
      'un perfil persistent conserva el navegador persistente por defecto',
    );
    browser.release('tarea-5');

    const forced = await rejects(
      browser.run(
        'web_open',
        { url: 'https://cuenta.example', mode: 'persistent' },
        { sessionId: 'tarea-6', browserMode: 'ephemeral' },
      ),
    );
    assert(forced && forced.code === 'BROWSER_MODE', 'un perfil ephemeral rechaza pedir el navegador persistente');
    await browser.run(
      'web_open',
      { url: 'https://publico.example' },
      { sessionId: 'tarea-6', browserMode: 'ephemeral' },
    );
    assert(views[views.length - 1].partition.includes('tarea-6'), 'un perfil ephemeral navega en memoria');
    browser.release('tarea-6');

    let now = realNow();
    Date.now = () => now;
    const opened = [];
    for (let index = 0; index < browser.MAX_EPHEMERAL_SESSIONS; index += 1) {
      await browser.run('web_open', { url: `https://sitio${index}.example` }, { sessionId: `simultanea-${index}` });
      opened.push(views[views.length - 1]);
      now += 11 * 60_000;
    }
    assert(
      new Set(opened.map((view) => view.partition)).size === browser.MAX_EPHEMERAL_SESSIONS,
      'cada sesión simultánea tiene su propia partición',
    );
    assert(
      instances.get(opened[1].partition).cookies.has('sitio1.example') &&
        !instances.get(opened[1].partition).cookies.has('sitio0.example'),
      'las sesiones efímeras no comparten cookies entre sí',
    );
    const limited = await rejects(
      browser.run('web_open', { url: 'https://extra.example' }, { sessionId: 'simultanea-extra' }),
    );
    assert(limited && limited.code === 'EPHEMERAL_LIMIT', 'hay un límite de sesiones efímeras simultáneas');
    const foreign = await rejects(browser.run('web_read', {}, { sessionId: 'simultanea-0' }));
    assert(
      foreign && opened[1].webContents.isDestroyed(),
      'otra sesión no lee la página efímera ajena: la vista se cierra antes de leer',
    );
    for (let index = 0; index < browser.MAX_EPHEMERAL_SESSIONS; index += 1) browser.release(`simultanea-${index}`);
    assert(
      opened.every((view) => instances.get(view.partition).cleared === 1),
      'liberar las sesiones limpia cada partición',
    );
    await browser.run('web_open', { url: 'https://extra.example' }, { sessionId: 'simultanea-extra' });
    assert(views[views.length - 1].partition.includes('simultanea-extra'), 'al liberar sesiones vuelve a haber hueco');

    await browser.run('web_handover', {}, { sessionId: 'simultanea-extra' });
    const handed = views[views.length - 1];
    browser.release('simultanea-extra');
    assert(
      !handed.webContents.isDestroyed() && instances.get(handed.partition).cleared === 0,
      'mientras el usuario tiene el control, la sesión efímera sigue abierta',
    );
    browser.close();
    assert(
      handed.webContents.isDestroyed() && instances.get(handed.partition).cleared === 1,
      'cerrar el navegador limpia también las sesiones efímeras pendientes',
    );

    Date.now = realNow;
    await browser.navigate('open', 'https://usuario.example', 'agent');
    assert(
      views[views.length - 1].partition === browser.PARTITION,
      'abrir la pestaña del agente desde la interfaz sigue usando la partición persistente',
    );
  } finally {
    Date.now = realNow;
    timers.restore();
    browser.close();
  }
}

main().then(
  () => finish(),
  (err) => {
    console.error('[FAIL]', err);
    process.exit(1);
  },
);
