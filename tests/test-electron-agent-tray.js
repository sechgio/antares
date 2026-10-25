'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function instance(owner = true) {
  const state = { started: 0, killed: 0, hidden: 0, shown: 0, restored: 0, destroyed: 0, notifications: [], activity: [] };
  const wc = Object.assign(new EventEmitter(), { send: (...args) => { state.lastSend = args; } });
  const win = Object.assign(new EventEmitter(), { webContents: wc, isDestroyed: () => false, isMinimized: () => true,
    isVisible: () => state.visible, hide: () => { state.hidden++; state.visible = false; },
    restore: () => state.restored++, show: () => { state.shown++; state.visible = true; }, focus: () => {}, destroy: () => state.destroyed++ });
  const app = Object.assign(new EventEmitter(), { isPackaged: false, requestSingleInstanceLock: () => owner,
    getVersion: () => 'test', whenReady: () => Promise.resolve(), quit: () => {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      app.emit('before-quit', event);
      if (!event.prevented) { state.quit = true; app.emit('will-quit'); }
    } });
  const intervals = new Map();
  const handlers = new Map();
  class Tray extends EventEmitter {
    constructor() { super(); state.tray = this; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    destroy() { state.trayDestroyed = true; }
  }
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; }
    show() { state.notifications.push(this); }
  }
  const noop = () => {};
  const deps = {
    electron: { app, Tray, Notification, ipcMain: { handle: (id, fn) => handlers.set(id, fn), on: noop },
      Menu: { setApplicationMenu: noop, buildFromTemplate: (template) => template } },
    './window-manager': { createWindow: noop, getMainWindow: () => win },
    './backend-spawner': { startPythonBackend: async () => state.started++, killPython: () => state.killed++ },
    './ipc-router': { registerIpcHandlers: noop }, './renderer-observability': { registerRendererObservability: noop },
    './renderer-trust': { isTrustedRendererFrame: () => true },
    './app-log': { installConsoleLogTee: noop, setAppContext: noop, initAppLogs: () => 'temporary', cleanStaleTempDirs: () => 0,
      appendLogLine: noop, appendLogEvent: noop, flushLogQueue: async () => {}, flushLogQueueSync: noop },
    './agent-runtime': { open: async () => { state.agentOpened = true; }, activitySnapshot: async () => state.activity, shutdown: async () => {} },
    './file-capabilities': { cleanupAllStaged: async () => {} }, './autoimg-sync-engine': { cleanupAutoSync: noop },
    './auto-updater': { setupAutoUpdater: noop, cleanupAutoUpdater: noop },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8'), {
    __dirname: path.resolve(__dirname, '../electron'), require: (id) => deps[id] || require(id.startsWith('.') ? path.resolve(__dirname, '../electron', id) : id), console,
    process: Object.assign(new EventEmitter(), { platform: 'win32', exit: noop }),
    setTimeout: (fn, delay) => ({ fn, delay, unref: noop }), clearTimeout: noop,
    setInterval: (fn, delay) => { intervals.set(delay, fn); return { unref: noop }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { state, app, win, handlers, intervals };
}
async function main() {
  const { state, app, win, handlers, intervals } = await instance();
  assert.equal(state.started, 1);
  assert.equal(state.agentOpened, true);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
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
  state.visible = false;
  state.activity = [{ id: 's1', title: 'Encargo', status: 'waiting_input' }];
  await intervals.get(2000)();
  await intervals.get(2000)();
  assert.equal(state.notifications.length, 1);
  state.activity[0].status = 'completed';
  await intervals.get(2000)();
  assert.equal(state.notifications.length, 2);
  state.notifications[1].emit('click');
  assert.equal(state.visible, true);
  state.visible = false;
  state.activity[0].status = 'uncertain';
  await intervals.get(2000)();
  assert.equal(state.notifications[2].options.body, 'El encargo requiere revisión');
  state.activity = [{ id: 's2', title: 'Espera', status: 'waiting_event' }];
  await intervals.get(2000)();
  assert.equal(state.notifications.length, 3, 'entrar en waiting_event no notifica');
  state.activity[0].status = 'completed';
  await intervals.get(2000)();
  assert.equal(state.notifications.length, 4, 'salir de waiting_event sí notifica el cierre');
  assert.equal(state.notifications[3].options.body, 'El encargo terminó');
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
  console.log('[PASS] Tray conserva el backend, evita duplicarlo, notifica y espera el flush antes de Salir.');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
