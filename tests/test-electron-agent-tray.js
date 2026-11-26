'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function instance(owner = true) {
  const state = {
    started: 0,
    killed: 0,
    hidden: 0,
    shown: 0,
    restored: 0,
    destroyed: 0,
    notifications: [],
    activity: [],
  };
  const wc = Object.assign(new EventEmitter(), {
    send: (...args) => {
      state.lastSend = args;
    },
  });
  const win = Object.assign(new EventEmitter(), {
    webContents: wc,
    isDestroyed: () => false,
    isMinimized: () => true,
    isVisible: () => state.visible,
    hide: () => {
      state.hidden++;
      state.visible = false;
    },
    restore: () => state.restored++,
    show: () => {
      state.shown++;
      state.visible = true;
    },
    focus: () => {},
    destroy: () => state.destroyed++,
  });
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    requestSingleInstanceLock: () => owner,
    getVersion: () => 'test',
    whenReady: () => Promise.resolve(),
    quit: () => {
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      app.emit('before-quit', event);
      if (!event.prevented) {
        state.quit = true;
        app.emit('will-quit');
      }
    },
  });
  const intervals = new Map();
  const timeouts = new Map();
  const handlers = new Map();
  class Tray extends EventEmitter {
    constructor() {
      super();
      state.tray = this;
    }
    setToolTip() {}
    setContextMenu(menu) {
      this.menu = menu;
    }
    destroy() {
      state.trayDestroyed = true;
    }
  }
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options) {
      super();
      this.options = options;
    }
    show() {
      state.notifications.push(this);
    }
  }
  const noop = () => {};
  const deps = {
    electron: {
      app,
      Tray,
      Notification,
      ipcMain: { handle: (id, fn) => handlers.set(id, fn), on: noop },
      Menu: { setApplicationMenu: noop, buildFromTemplate: (template) => template },
    },
    './window-manager': {
      createWindow: () => {
        state.windowCreatedAfterStart = state.started;
      },
      getMainWindow: () => win,
    },
    './backend-spawner': { startPythonBackend: async () => state.started++, killPython: () => state.killed++ },
    './ipc-router': { registerIpcHandlers: noop },
    './renderer-observability': { registerRendererObservability: noop },
    './renderer-trust': { isTrustedRendererFrame: () => true },
    './app-log': {
      installConsoleLogTee: noop,
      setAppContext: noop,
      initAppLogs: () => 'temporary',
      cleanStaleTempDirs: () => 0,
      appendLogLine: noop,
      appendLogEvent: noop,
      flushLogQueue: async () => {},
      flushLogQueueSync: noop,
    },
    './agent-runtime': {
      open: async () => {
        state.agentOpened = true;
      },
      activitySnapshot: async () => state.activity,
      shutdown: async () => {},
    },
    './file-capabilities': { cleanupAllStaged: async () => {} },
    './autoimg-sync-engine': { cleanupAutoSync: noop },
    './auto-updater': { setupAutoUpdater: noop, cleanupAutoUpdater: noop },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8'), {
    __dirname: path.resolve(__dirname, '../electron'),
    require: (id) => deps[id] || require(id.startsWith('.') ? path.resolve(__dirname, '../electron', id) : id),
    console,
    process: Object.assign(new EventEmitter(), { platform: 'win32', exit: noop }),
    setTimeout: (fn, delay) => {
      timeouts.set(delay, fn);
      return { unref: noop };
    },
    clearTimeout: noop,
    setInterval: (fn, delay) => {
      intervals.set(delay, fn);
      return { unref: noop };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { state, app, win, handlers, intervals, timeouts };
}
async function main() {
  const { state, app, win, handlers, intervals, timeouts } = await instance();
  assert.equal(state.started, 1);
  assert.equal(state.windowCreatedAfterStart, 1, 'el backend se lanza antes de crear la ventana');
  assert.equal(state.agentOpened, undefined, 'el runtime del agente no abre durante el arranque');
  const deferredOpen = timeouts.get(20000);
  assert.equal(typeof deferredOpen, 'function', 'la apertura diferida del agente queda programada');
  deferredOpen();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.agentOpened, true, 'la apertura diferida abre el runtime del agente');
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  win.emit('close', event);
  assert.equal(event.prevented, true);
  assert.equal(state.hidden, 1);
  assert.equal(state.killed, 0);
  assert.equal(state.lastSend, undefined);
  state.tray.menu[0].click();
  assert.equal(state.shown, 1);
  assert.equal(state.restored, 1);
  app.emit('second-instance');
  assert.equal(state.started, 1);
  assert.equal(intervals.has(2000), false, 'no se sondea la actividad para notificaciones del sistema');
  assert.equal(state.notifications.length, 0);
  state.tray.menu[2].click();
  assert.equal(state.lastSend[1], 'app.flush-canvas-before-quit');
  assert.equal(state.killed, 0);
  await handlers.get('canvas-flush-ack')({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.killed, 1);
  assert.equal(state.trayDestroyed, true);
  assert.equal(state.quit, true);
  const second = await instance(false);
  assert.equal(second.state.started, 0);
  assert.equal(second.state.killed, 0);
  assert.equal(second.state.quit, true);
  console.log('[PASS] Tray conserva el backend, evita duplicarlo, no notifica y espera el flush antes de Salir.');
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
