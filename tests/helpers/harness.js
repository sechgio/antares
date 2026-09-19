// Shared helpers for plain-node test scripts in tests/.
// Runner contract: tests report via exit code; console output is informational.

const path = require('path');
const { EventEmitter } = require('events');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const counters = { passed: 0, failed: 0 };

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    counters.passed += 1;
  } else {
    console.error(`  ✗ ${message}`);
    counters.failed += 1;
  }
}

function assertActionsPinned(source, label) {
  const actionRefs = [...source.matchAll(/uses:\s+actions\/[^@\s]+@([^\s#]+)/g)].map((match) => match[1]);
  assert(actionRefs.length > 0, `${label} uses GitHub-maintained actions`);
  assert(
    actionRefs.every((ref) => /^[0-9a-f]{40}$/.test(ref)),
    `${label} pins every GitHub action to a full commit SHA`,
  );
}

function assertOrExit(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function finish() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${counters.passed} passed, ${counters.failed} failed`);
  console.log('='.repeat(50));
  if (counters.failed > 0) process.exit(1);
}

async function flushAsyncTurns(turns = 1) {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function waitFor(predicate, maxTurns = 500) {
  for (let i = 0; i < maxTurns; i += 1) {
    if (predicate()) return true;
    await flushAsyncTurns();
  }
  return false;
}

function _resolveRepoModule(spec) {
  if (path.isAbsolute(spec)) return require.resolve(spec);
  // Bare package names (e.g. 'electron') must resolve via node_modules;
  // repo-relative paths (e.g. 'electron/backend-spawner.js') resolve from root.
  try {
    return require.resolve(spec);
  } catch {
    return require.resolve(path.join(REPO_ROOT, spec));
  }
}

function stubModule(spec, exports) {
  const resolved = _resolveRepoModule(spec);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return resolved;
}

function evictModule(spec) {
  delete require.cache[_resolveRepoModule(spec)];
}

function stubBackendCommand(exports = {}) {
  return stubModule('electron/backend-command.js', {
    getBackendCommand: () => ({ cmd: 'python', args: [] }),
    ...exports,
  });
}

const BACKEND_READY_LINE = '{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n';

function emitBackendReady(proc) {
  proc.stdout.emit('data', Buffer.from(BACKEND_READY_LINE));
}

function makeFakeProc({ pid = 12345, closeOnKill = true, ready = true } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.stdin.end = () => {};
  proc.stdin.write = () => true;
  proc.killed = false;
  proc.pid = pid;
  proc.kill = () => {
    proc.killed = true;
    if (closeOnKill) setImmediate(() => proc.emit('close', 1, null));
  };
  if (ready) process.nextTick(() => emitBackendReady(proc));
  return proc;
}

function patchSpawn(impl) {
  const childProcess = require('child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = impl;
  const state = { count: 0, restore: () => { childProcess.spawn = originalSpawn; } };
  childProcess.spawn = (...args) => {
    state.count += 1;
    return impl(...args);
  };
  return state;
}

function installInertTimers({
  isInert = (delay) => delay === 30_000 || delay === 60_000,
  fastForward = true,
  fakeInterval = false,
  onInert = null,
  onClear = null,
} = {}) {
  const inertTimers = new Set();
  const original = {
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
  };
  const state = { inertTimers, activeInterval: null, original };

  global.setTimeout = (fn, delay, ...args) => {
    if (isInert(delay)) {
      const timer = { fn, delay, args };
      inertTimers.add(timer);
      if (onInert) onInert(timer);
      return timer;
    }
    return original.setTimeout(fn, fastForward ? 0 : delay, ...args);
  };
  global.clearTimeout = (timer) => {
    if (inertTimers.has(timer)) {
      inertTimers.delete(timer);
      if (onClear) onClear(timer);
      return undefined;
    }
    return original.clearTimeout(timer);
  };
  global.setInterval = (fn, delay, ...args) => {
    state.activeInterval = fakeInterval
      ? { fn, delay, args }
      : original.setInterval(fn, delay, ...args);
    return state.activeInterval;
  };
  global.clearInterval = (timer) => {
    if (timer === state.activeInterval) state.activeInterval = null;
    return original.clearInterval(timer);
  };
  state.restore = () => {
    global.setTimeout = original.setTimeout;
    global.clearTimeout = original.clearTimeout;
    global.setInterval = original.setInterval;
    global.clearInterval = original.clearInterval;
  };
  return state;
}

module.exports = {
  assert,
  assertActionsPinned,
  assertOrExit,
  counters,
  finish,
  flushAsyncTurns,
  waitFor,
  stubModule,
  evictModule,
  stubBackendCommand,
  emitBackendReady,
  makeFakeProc,
  patchSpawn,
  installInertTimers,
};
