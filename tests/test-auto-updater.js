const Module = require('module');
const { EventEmitter } = require('events');

const { assert, finish, evictModule } = require('./helpers/harness');

function installStub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return { resolved, previous };
}

function restoreStubs(stubs) {
  for (const { resolved, previous } of stubs) {
    if (previous) require.cache[resolved] = previous;
    else evictModule('electron/auto-updater.js');
  }
}

function freshAutoUpdater() {
  const resolved = require.resolve('../electron/auto-updater.js');
  evictModule('electron/auto-updater.js');
  return require(resolved);
}

function makeWindow() {
  const sent = [];
  return {
    sent,
    isDestroyed: () => false,
    webContents: { send: (channel, data) => sent.push({ channel, data }) },
  };
}

function makeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  };
}

function makeFakeUpdater() {
  const updater = new EventEmitter();
  updater.checkCalls = [];
  updater.checkResult = Promise.resolve({ version: null });
  updater.checkForUpdates = () => {
    const call = {};
    updater.checkCalls.push(call);
    return updater.checkResult;
  };
  updater.installCalls = [];
  updater.quitAndInstall = (...args) => {
    updater.installCalls.push(args);
  };
  return updater;
}

async function run() {
  console.log('Testing auto-updater state machine...\n');

  const originalLoad = Module._load;
  const fakeUpdater = makeFakeUpdater();
  const win = makeWindow();
  const ipcMain = makeIpcMain();
  const app = { isPackaged: true, getVersion: () => '1.2.3' };
  const logEvents = [];

  const stubs = [
    installStub('../electron/window-manager.js', { getMainWindow: () => win }),
    installStub('../electron/ipc-router.js', {
      _isAllowedIpcSender: (event) => event && event.trusted === true,
    }),
    installStub('../electron/app-log.js', {
      appendLogEvent: (level, event, fields) => { logEvents.push({ level, event, fields }); },
      appendLogLine: () => {},
      logInfo: () => {},
    }),
  ];

  // Capture timers instead of scheduling real ones: the module arms an 8s
  // initial check, a 6h periodic interval and a 30min stuck-flag timeout.
  const timers = { timeouts: [], intervals: [], cleared: [] };
  const realTimers = {
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
  };
  global.setTimeout = (fn, delay, ...args) => {
    const t = { fn, delay, args, id: `t${timers.timeouts.length}` };
    timers.timeouts.push(t);
    return t;
  };
  global.clearTimeout = (t) => { timers.cleared.push(t); };
  global.setInterval = (fn, delay) => {
    const t = { fn, delay, id: `i${timers.intervals.length}` };
    timers.intervals.push(t);
    return t;
  };
  global.clearInterval = (t) => { timers.cleared.push(t); };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return { app, ipcMain };
    if (request === 'electron-updater') return { autoUpdater: fakeUpdater };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    console.log('dev / unpackaged mode:');
    let mod = freshAutoUpdater();
    const devApp = { isPackaged: false, getVersion: () => '0.0.0-dev' };
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'electron') return { app: devApp, ipcMain };
      if (request === 'electron-updater') return { autoUpdater: fakeUpdater };
      return originalLoad.call(this, request, parent, isMain);
    };

    mod.setupAutoUpdater(true);
    assert(ipcMain.handlers.has('auto-update-check'), 'dev registers auto-update-check');
    assert(ipcMain.handlers.has('auto-update-install'), 'dev registers auto-update-install');

    let res = await ipcMain.handlers.get('auto-update-check')({ trusted: false });
    assert(res.success === false && res.reason === 'untrusted sender', 'dev check rejects untrusted sender');
    res = await ipcMain.handlers.get('auto-update-install')({ trusted: false });
    assert(res.success === false && res.reason === 'untrusted sender', 'dev install rejects untrusted sender');

    res = await ipcMain.handlers.get('auto-update-check')({ trusted: true });
    assert(res.success === true, 'dev check succeeds for trusted sender');
    const devNotify = timers.timeouts.find((t) => t.delay === 500);
    assert(devNotify !== undefined, 'dev check schedules the mocked up-to-date broadcast');
    devNotify.fn();
    assert(
      win.sent.some((m) => m.channel === 'auto-update-status' && m.data.status === 'up-to-date'),
      'dev check broadcasts up-to-date to the renderer',
    );

    res = await ipcMain.handlers.get('auto-update-install')({ trusted: true });
    assert(res.success === false && /desarrollo/i.test(res.reason), 'dev install reports unavailable');

    console.log('\npackaged mode:');
    timers.timeouts.length = 0;
    win.sent.length = 0;
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'electron') return { app, ipcMain };
      if (request === 'electron-updater') return { autoUpdater: fakeUpdater };
      return originalLoad.call(this, request, parent, isMain);
    };

    mod = freshAutoUpdater();
    mod.setupAutoUpdater(false);

    assert(fakeUpdater.autoDownload === true, 'autoDownload enabled');
    assert(fakeUpdater.autoInstallOnAppQuit === false, 'autoInstallOnAppQuit disabled');
    assert(typeof fakeUpdater.logger?.info === 'function', 'updater logger installed');
    assert(
      timers.timeouts.some((t) => t.delay === 8000),
      'initial update check is scheduled',
    );
    assert(
      timers.intervals.some((t) => t.delay === 6 * 60 * 60 * 1000),
      'periodic 6h check is scheduled',
    );

    const initialCheck = timers.timeouts.find((t) => t.delay === 8000);
    fakeUpdater.checkResult = Promise.resolve({ version: null });
    initialCheck.fn();
    assert(fakeUpdater.checkCalls.length === 1, 'initial check calls checkForUpdates once');

    res = await ipcMain.handlers.get('auto-update-install')({ trusted: true });
    assert(res.success === false && res.reason === 'update not ready', 'install before download is rejected');

    res = await ipcMain.handlers.get('auto-update-check')({ trusted: false });
    assert(res.success === false && res.reason === 'untrusted sender', 'prod check rejects untrusted sender');
    res = await ipcMain.handlers.get('auto-update-install')({ trusted: false });
    assert(res.success === false && res.reason === 'untrusted sender', 'prod install rejects untrusted sender');

    logEvents.length = 0;
    fakeUpdater.emit('checking-for-update');
    const periodicStart = logEvents.find((entry) => entry.event === 'updater.check_start');
    assert(periodicStart !== undefined, 'checking-for-update opens the check');
    assert(periodicStart.fields.reason === 'periodic', 'a background check is labelled periodic');
    assert(periodicStart.fields.outcome === undefined, 'an unfinished check has no outcome yet');
    assert(
      !logEvents.some((entry) => entry.event === 'updater.check'),
      'checking-for-update does not emit the completion event',
    );

    fakeUpdater.emit('update-not-available');
    assert(
      !win.sent.some((m) => m.data.status === 'up-to-date'),
      'update-not-available without a manual check stays silent',
    );

    fakeUpdater.checkResult = Promise.resolve({ version: null });
    res = await ipcMain.handlers.get('auto-update-check')({ trusted: true });
    assert(res.success === true, 'manual check succeeds when idle');
    logEvents.length = 0;
    fakeUpdater.emit('checking-for-update');
    assert(
      logEvents.some((entry) => entry.event === 'updater.check_start' && entry.fields.reason === 'manual'),
      'a user requested check is labelled manual',
    );
    fakeUpdater.emit('update-not-available');
    assert(
      win.sent.some((m) => m.data.status === 'up-to-date' && m.data.version === '1.2.3'),
      'manual check + update-not-available broadcasts up-to-date',
    );

    fakeUpdater.emit('update-available', { version: '9.9.9' });
    assert(
      win.sent.some((m) => m.data.status === 'available' && m.data.version === '9.9.9'),
      'update-available broadcasts the new version',
    );
    res = await ipcMain.handlers.get('auto-update-check')({ trusted: true });
    assert(
      res.success === false && res.reason === 'update in progress',
      'manual check rejected while a download is in progress',
    );

    const stuckTimer = timers.timeouts.find((t) => t.delay === 30 * 60 * 1000);
    assert(stuckTimer !== undefined, 'a stuck in-progress flag gets a 30min watchdog');
    stuckTimer.fn();
    fakeUpdater.checkResult = Promise.resolve({ version: null });
    res = await ipcMain.handlers.get('auto-update-check')({ trusted: true });
    assert(res.success === true, 'watchdog clears a stuck in-progress flag');

    win.sent.length = 0;
    fakeUpdater.emit('update-available', { version: '9.9.9' });
    fakeUpdater.emit('download-progress', { percent: 42.4 });
    assert(
      win.sent.some((m) => m.data.status === 'downloading' && m.data.progress === 42),
      'download progress broadcasts rounded percent',
    );
    fakeUpdater.emit('update-downloaded', { version: '9.9.9' });
    assert(
      win.sent.some((m) => m.data.status === 'ready' && m.data.version === '9.9.9' && m.data.progress === 100),
      'update-downloaded broadcasts ready at 100%',
    );

    res = await ipcMain.handlers.get('auto-update-install')({ trusted: true });
    assert(res.success === true, 'install succeeds once the update is downloaded');
    assert(
      fakeUpdater.installCalls.length === 1
        && fakeUpdater.installCalls[0][0] === false
        && fakeUpdater.installCalls[0][1] === true,
      'install calls quitAndInstall(false, true)',
    );

    win.sent.length = 0;
    fakeUpdater.emit('error', new Error('network down'));
    assert(
      win.sent.some((m) => m.data.status === 'error' && /network down/.test(m.data.message)),
      'updater errors are broadcast to the renderer',
    );

    const failUpdater = makeFakeUpdater();
    failUpdater.checkResult = Promise.reject(new Error('403 forbidden'));
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'electron') return { app, ipcMain };
      if (request === 'electron-updater') return { autoUpdater: failUpdater };
      return originalLoad.call(this, request, parent, isMain);
    };
    mod = freshAutoUpdater();
    mod.setupAutoUpdater(false);
    res = await ipcMain.handlers.get('auto-update-check')({ trusted: true });
    assert(res.success === false && res.reason === '403 forbidden', 'checkForUpdates failure surfaces the reason');

    console.log('\ncleanup:');
    mod.cleanupAutoUpdater();
    assert(
      timers.cleared.some((t) => timers.intervals.includes(t)),
      'cleanup clears the periodic interval',
    );
    mod.cleanupAutoUpdater();
    assert(true, 'cleanup is idempotent');
  } finally {
    Module._load = originalLoad;
    global.setTimeout = realTimers.setTimeout;
    global.clearTimeout = realTimers.clearTimeout;
    global.setInterval = realTimers.setInterval;
    global.clearInterval = realTimers.clearInterval;
    restoreStubs(stubs);
  }

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
