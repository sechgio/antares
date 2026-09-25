#!/usr/bin/env node

const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync, spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_EXE = path.join(ROOT, 'dist-electron', 'win-unpacked', 'Antares.exe');
const CDP_TIMEOUT_MS = 10_000;
const APP_READY_TIMEOUT_MS = 15_000;
const STARTUP_LOG_TIMEOUT_MS = 12_000;

function round(value) {
  return Math.round(value * 10) / 10;
}

function summarize(values, unit = 'ms') {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) {
    return {
      n: 0,
      [`min_${unit}`]: null,
      [`p50_${unit}`]: null,
      [`p95_${unit}`]: null,
      [`max_${unit}`]: null,
      [`mean_${unit}`]: null,
    };
  }
  const percentile = (q) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
  return {
    n: sorted.length,
    [`min_${unit}`]: round(sorted[0]),
    [`p50_${unit}`]: round(percentile(0.5)),
    [`p95_${unit}`]: round(percentile(0.95)),
    [`max_${unit}`]: round(sorted[sorted.length - 1]),
    [`mean_${unit}`]: round(sorted.reduce((total, value) => total + value, 0) / sorted.length),
  };
}

function resourceDelta(before, after) {
  const previous = new Set(before.map((resource) => resource.name));
  return after.filter((resource) => !previous.has(resource.name));
}

function resourcesByName(resources, names) {
  return resources.filter((resource) => names.has(resource.name));
}

function mergeResources(primary, secondary) {
  const resources = new Map(primary.map((resource) => [resource.name, resource]));
  for (const resource of secondary) {
    const existing = resources.get(resource.name);
    if (!existing) resources.set(resource.name, resource);
    else if (!Number.isFinite(existing.bytes) && Number.isFinite(resource.bytes)) {
      resources.set(resource.name, resource);
    }
  }
  return [...resources.values()];
}

function sumResourceBytes(resources) {
  const sizes = resources.map((resource) => resource.bytes).filter(Number.isFinite);
  return sizes.length ? sizes.reduce((total, size) => total + size, 0) : null;
}

function parseArgs(args) {
  const options = { iterations: 3, startupPairs: 0, canvasFlow: false, exe: DEFAULT_EXE, output: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--iterations') {
      options.iterations = Number(args[++index]);
    } else if (argument === '--startup-pairs') {
      options.startupPairs = Number(args[++index]);
    } else if (argument === '--canvas-flow') {
      options.canvasFlow = true;
    } else if (argument === '--exe') {
      options.exe = path.resolve(args[++index] || '');
    } else if (argument === '--output') {
      options.output = path.resolve(args[++index] || '');
    } else {
      throw new Error(`Argumento desconocido: ${argument}`);
    }
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 10) {
    throw new Error('--iterations debe ser un entero entre 1 y 10.');
  }
  if (!Number.isInteger(options.startupPairs) || options.startupPairs < 0 || options.startupPairs > 50) {
    throw new Error('--startup-pairs debe ser un entero entre 1 y 50.');
  }
  if (options.canvasFlow && !options.startupPairs) {
    throw new Error('--canvas-flow requiere --startup-pairs.');
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const events = new EventEmitter();
  let nextId = 0;

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message.id) {
      if (message.method) events.emit(message.method, message.params);
      return;
    }
    if (!pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('La conexión CDP se cerró.'));
    }
    pending.clear();
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tiempo agotado al conectar con CDP.')), 5_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('No se pudo abrir la conexión CDP.'));
    }, { once: true });
  });

  return {
    command(method, params = {}, timeoutMs = CDP_TIMEOUT_MS) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} excedió ${timeoutMs} ms.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
    onEvent(method, callback) {
      events.on(method, callback);
    },
    async evaluate(expression, timeoutMs = CDP_TIMEOUT_MS) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await this.command('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
          }, timeoutMs);
          if (response.exceptionDetails) {
            throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
          }
          return response.result?.value;
        } catch (error) {
          if (!/Inspected target navigated or closed/.test(error.message) || attempt === 2) throw error;
          await sleep(100);
        }
      }
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    },
  };
}

async function waitForDevTools(profileDir, child, startedAt) {
  const activePortPath = path.join(profileDir, 'DevToolsActivePort');
  const deadline = startedAt + 10_000;
  while (Date.now() < deadline) {
    if (child.launchError) throw new Error(`No se pudo iniciar Antares: ${child.launchError.message}`);
    if (child.exitCode !== null) throw new Error(`Antares terminó durante el arranque (código ${child.exitCode}).`);
    if (fs.existsSync(activePortPath)) {
      try {
        const port = Number(fs.readFileSync(activePortPath, 'utf8').split(/\r?\n/)[0]);
        if (Number.isInteger(port) && port > 0) return port;
      } catch (error) {
        if (!['EBUSY', 'ENOENT', 'EPERM'].includes(error.code)) throw error;
      }
    }
    await sleep(100);
  }
  throw new Error('No apareció DevToolsActivePort; comprueba que la build acepta --remote-debugging-port.');
}

async function waitForPageTarget(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Antares terminó durante el arranque (código ${child.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(100);
  }
  throw new Error('CDP no encontró la ventana principal de Antares.');
}

async function waitForShell(cdp) {
  const deadline = Date.now() + APP_READY_TIMEOUT_MS;
  let state;
  while (Date.now() < deadline) {
    state = await cdp.evaluate(`(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        title: document.title,
        ready: document.readyState,
        rootReady: Boolean(document.querySelector('#root')?.firstElementChild),
        timeOrigin: performance.timeOrigin,
        firstContentfulPaintMs: paint?.startTime ?? null,
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      };
    })()`);
    if (state.ready === 'complete' && state.rootReady && state.firstContentfulPaintMs !== null) return state;
    await sleep(100);
  }
  throw new Error(`Antares no llegó al primer render en ${APP_READY_TIMEOUT_MS} ms (estado=${state?.ready || 'sin página'}).`);
}

function idleInstrumentation(mode) {
  const suppress = mode === 'on_demand';
  return `(() => {
    const state = { requested: false, fired: false, suppressed: false, firedAt: null };
    Object.defineProperty(window, '__antaresPerfIdle', { value: state, configurable: true });
    const scriptResources = () => performance.getEntriesByType('resource')
      .filter((entry) => entry.name.toLowerCase().includes('/assets/js/'))
      .map((entry) => ({
        name: new URL(entry.name).pathname.split('/').pop(),
        bytes: entry.decodedBodySize || entry.encodedBodySize || entry.transferSize || null,
        start_ms: Math.round(entry.startTime * 10) / 10,
      }));
    const nativeIdleCallback = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback.bind(window)
      : null;
    window.requestIdleCallback = (callback, options) => {
      state.requested = true;
      state.resourcesBeforeCallback = scriptResources();
      ${suppress ? 'state.suppressed = true; return 0;' : `
      const schedule = nativeIdleCallback || ((fn, opts) => window.setTimeout(
        () => fn({ didTimeout: true, timeRemaining: () => 0 }), opts?.timeout ?? 1,
      ));
      return schedule((deadline) => {
        state.fired = true;
        state.firedAt = performance.now();
        callback(deadline);
      }, options);`}
    };
  })();`;
}

async function readScriptResources(cdp) {
  return cdp.evaluate(`performance.getEntriesByType('resource')
    .filter((entry) => entry.name.toLowerCase().includes('/assets/js/'))
    .map((entry) => {
      const name = new URL(entry.name).pathname.split('/').pop();
      return {
        name,
        bytes: entry.decodedBodySize || entry.encodedBodySize || entry.transferSize || null,
        start_ms: Math.round(entry.startTime * 10) / 10,
      };
    })`);
}

async function waitForIdleResources(cdp, mode, timeOrigin, scriptRequestsSince) {
  const startedAt = Date.now();
  const deadline = startedAt + 7_000;
  let previousSignature = '';
  let stableSince = 0;
  let snapshot;
  while (Date.now() < deadline) {
    const idle = await cdp.evaluate('window.__antaresPerfIdle || null');
    const resources = await readScriptResources(cdp);
    const idleBoundary = idle?.firedAt == null ? null : timeOrigin + idle.firedAt;
    const networkResources = idleBoundary === null ? [] : scriptRequestsSince(idleBoundary);
    const idleReached = idle?.fired || (mode === 'on_demand' && idle?.suppressed);
    const signature = JSON.stringify([
      resources.map(({ name, bytes }) => [name, bytes]),
      networkResources.map(({ name, bytes, complete }) => [name, bytes, complete]),
    ]);
    if (idleReached && Date.now() - startedAt >= 1_000 && signature === previousSignature) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 700 && networkResources.every((resource) => resource.complete)) {
        return { idle, resources, networkResources };
      }
    } else {
      stableSince = 0;
    }
    previousSignature = signature;
    snapshot = { idle, resources, networkResources };
    await sleep(100);
  }
  if (mode === 'on_demand' && snapshot?.idle?.suppressed) return snapshot;
  throw new Error(`El precalentado de Canvas no se estabilizó (modo=${mode}).`);
}

async function waitForCanvasOpen(cdp) {
  return cdp.evaluate(`new Promise((resolve, reject) => {
    const root = document.querySelector('#root') || document.body;
    const readyCanvas = () => document.querySelector('.canvas-app:not(.canvas-loading)');
    const startedAt = performance.now();
    const startedAtEpochMs = performance.timeOrigin + startedAt;
    let timeout;
    const observer = new MutationObserver(() => {
      if (!readyCanvas()) return;
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve({
        open_ms: Math.round((performance.now() - startedAt) * 10) / 10,
        started_at_epoch_ms: startedAtEpochMs,
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error('Canvas no llegó a estar listo en 20 segundos.'));
    }, 20_000);
    const button = Array.from(document.querySelectorAll('button')).find((element) =>
      (element.getAttribute('aria-label') || element.innerText || '').trim() === 'Canvas',
    );
    if (!button) {
      observer.disconnect();
      window.clearTimeout(timeout);
      reject(new Error('No se encontró el botón Canvas en la navegación.'));
      return;
    }
    button.click();
    if (readyCanvas()) {
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve({
        open_ms: Math.round((performance.now() - startedAt) * 10) / 10,
        started_at_epoch_ms: startedAtEpochMs,
      });
    }
  })`, 25_000);
}

async function rendererHeapBytes(cdp) {
  try {
    const usage = await cdp.command('Runtime.getHeapUsage');
    return Number.isFinite(usage.usedSize) ? usage.usedSize : null;
  } catch {
    return null;
  }
}

async function waitForUi(cdp, expression, label, timeoutMs = 15_000, logsDir = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await cdp.evaluate(expression);
    if (value) return value;
    if (logsDir && readAppEvents(logsDir).some((event) =>
      event.method === 'canvas_save' && event.error_code === 'MEMORY_PRESSURE')) {
      throw new Error('Canvas no pudo guardar por MEMORY_PRESSURE; libera memoria antes de medir el flujo.');
    }
    await sleep(100);
  }
  throw new Error(`Canvas no completó ${label} en ${timeoutMs} ms.`);
}

async function measureCanvasWorkflow(cdp, tempDir, phase) {
  const opened = await waitForCanvasOpen(cdp);
  if (phase === 'reopen') {
    const reopened = await waitForUi(cdp, `(() => {
      const name = document.querySelector('input[aria-label="Nombre del documento"]')?.value;
      const layers = document.querySelectorAll('[data-testid="canvas-artboard"] [data-layer-id]').length;
      return name === 'Formato reservorios' && layers > 10 ? layers : null;
    })()`, 'apertura del documento guardado');
    const downloadDir = path.join(tempDir, 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });
    await cdp.command('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    const exportStarted = Date.now();
    await cdp.command('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75,
    });
    await cdp.command('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75,
    });
    await waitForUi(cdp, `Boolean(document.querySelector('[data-testid="canvas-command-palette"]'))`, 'paleta de comandos');
    const selected = await cdp.evaluate(`(() => {
      const action = Array.from(document.querySelectorAll('[data-testid="canvas-command-palette"] [role="option"]'))
        .find((item) => item.textContent.includes('Exportar página actual (PNG)'));
      if (!action) return false;
      action.click();
      return true;
    })()`);
    if (!selected) throw new Error('No se encontró Exportar página actual (PNG).');
    let pngFile;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      pngFile = fs.readdirSync(downloadDir).find((name) => name.endsWith('.png'));
      if (pngFile && fs.statSync(path.join(downloadDir, pngFile)).size > 8) break;
      await sleep(100);
    }
    if (!pngFile || !fs.existsSync(path.join(downloadDir, pngFile))) throw new Error('No se descargó el PNG.');
    const pngPath = path.join(downloadDir, pngFile);
    if (!fs.readFileSync(pngPath).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      throw new Error('La exportación no produjo un PNG válido.');
    }
    return {
      reopen_document_ms: opened.open_ms,
      restored_layers: reopened,
      export_png_ms: Date.now() - exportStarted,
      export_png_bytes: fs.statSync(pngPath).size,
    };
  }

  await cdp.evaluate(`document.querySelector('[data-testid="canvas-open-templates"]')?.click()`);
  await waitForUi(cdp, `Boolean(document.querySelector('.tpl-card[data-preset="format-reservorios"] .tpl-action--primary'))`, 'carga de plantillas');
  const createStarted = Date.now();
  await cdp.evaluate(`document.querySelector('.tpl-card[data-preset="format-reservorios"] .tpl-action--primary').click()`);
  const layers = await waitForUi(cdp, `(() => {
    const name = document.querySelector('input[aria-label="Nombre del documento"]')?.value;
    const count = document.querySelectorAll('[data-testid="canvas-artboard"] [data-layer-id]').length;
    return name === 'Formato reservorios' && count > 10 ? count : null;
  })()`, 'creación de plantilla', 15_000, path.join(tempDir, 'local', 'Antares', 'logs'));
  const createMs = Date.now() - createStarted;
  const selected = await cdp.evaluate(`(() => {
    const row = document.querySelector('[data-testid="canvas-layer-list"] .canvas-list-row:not([data-locked="true"]) .canvas-list-label');
    if (!row) return false;
    row.click();
    return true;
  })()`);
  if (!selected) throw new Error('La plantilla no tiene capas editables visibles.');
  await waitForUi(cdp, `Boolean(document.querySelector('[data-testid="canvas-layer-list"] .canvas-list-row[data-selected="true"]'))`, 'selección de capa');
  const nudgeStarted = Date.now();
  await cdp.command('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
  });
  await cdp.command('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
  });
  await waitForUi(cdp, `Boolean(document.querySelector('[data-testid="canvas-save-dirty"]'))`, 'edición de capa');
  const nudgeMs = Date.now() - nudgeStarted;
  const saveStarted = Date.now();
  await cdp.evaluate(`document.querySelector('[data-testid="canvas-save-btn"]').click()`);
  await waitForUi(cdp, `!document.querySelector('[data-testid="canvas-save-dirty"]')`, 'guardado del documento');
  const saved = await cdp.evaluate(`(() => {
    const picker = document.querySelector('select[aria-label="Archivo abierto"]');
    return picker?.value || null;
  })()`);
  const docPath = path.join(tempDir, 'local', 'Antares', 'canvas', 'documents', `${saved}.json`);
  const persisted = JSON.parse(fs.readFileSync(docPath, 'utf8'));
  if (persisted.name !== 'Formato reservorios' || persisted.layers.length < layers) {
    throw new Error('El documento editado no quedó persistido en el perfil temporal.');
  }
  return { create_template_ms: createMs, edit_layer_ms: nudgeMs, save_document_ms: Date.now() - saveStarted, layers };
}

function readAppEvents(logsDir) {
  if (!fs.existsSync(logsDir)) return [];
  const events = [];
  for (const name of fs.readdirSync(logsDir).filter((entry) => entry.endsWith('.jsonl'))) {
    const content = fs.readFileSync(path.join(logsDir, name), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
  }
  return events;
}

function trackScriptRequests(cdp) {
  const assets = new Map();
  cdp.onEvent('Network.requestWillBeSent', ({ requestId, request, type, wallTime }) => {
    const name = new URL(request.url).pathname.split('/').pop();
    if (type !== 'Script' && !/\.m?js(?:[?#]|$)/i.test(name)) return;
    assets.set(requestId, {
      name,
      bytes: null,
      complete: false,
      start_wall_ms: Number.isFinite(wallTime) ? wallTime * 1000 : Date.now(),
    });
  });
  cdp.onEvent('Network.responseReceived', ({ requestId, response }) => {
    const asset = assets.get(requestId);
    if (!asset) return;
    const contentLength = Object.entries(response.headers || {}).find(([name]) =>
      name.toLowerCase() === 'content-length',
    )?.[1];
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > 0) asset.bytes = bytes;
  });
  cdp.onEvent('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const asset = assets.get(requestId);
    if (!asset) return;
    if (Number.isFinite(encodedDataLength) && encodedDataLength > 0) asset.bytes = encodedDataLength;
    asset.complete = true;
  });
  cdp.onEvent('Network.loadingFailed', ({ requestId }) => {
    const asset = assets.get(requestId);
    if (asset) asset.complete = true;
  });
  return (startWallMs) => [...assets.values()]
    .filter((asset) => asset.start_wall_ms >= startWallMs)
    .map(({ name, bytes, complete }) => ({ name, bytes, complete }));
}

async function waitForStartupEvents(logsDir, startedAt = 0) {
  const deadline = Date.now() + STARTUP_LOG_TIMEOUT_MS;
  let events = [];
  while (Date.now() < deadline) {
    events = readAppEvents(logsDir).filter((event) => Date.parse(event.timestamp) >= startedAt);
    const shown = events.some((event) => event.event === 'renderer.lifecycle' && event.reason === 'ready_to_show');
    const backend = events.some((event) => event.event === 'backend.ready');
    if (shown && backend) break;
    await sleep(100);
  }
  return events;
}

async function measureCanvasScenario(cdp, mode, scriptRequestsSince, canvasAssetNames) {
  const injection = await cdp.command('Page.addScriptToEvaluateOnNewDocument', {
    source: idleInstrumentation(mode),
  });
  try {
    await cdp.command('Page.reload', { ignoreCache: true });
    const shell = await waitForShell(cdp);
    const idle = await waitForIdleResources(cdp, mode, shell.timeOrigin, scriptRequestsSince);
    const heapBefore = await rendererHeapBytes(cdp);
    const beforeClick = idle.resources;
    const idleBoundary = idle.idle?.firedAt == null ? null : shell.timeOrigin + idle.idle.firedAt;
    const scriptsStartedAfterIdle = idleBoundary === null
      ? []
      : mergeResources(
        idle.networkResources,
        resourceDelta(idle.idle?.resourcesBeforeCallback ?? [], beforeClick),
      );
    const canvasPrefetchAssets = resourcesByName(scriptsStartedAfterIdle, canvasAssetNames);
    const opened = await waitForCanvasOpen(cdp);
    const afterClick = await readScriptResources(cdp);
    const heapAfter = await rendererHeapBytes(cdp);
    const resources = mergeResources(
      scriptRequestsSince(opened.started_at_epoch_ms),
      resourceDelta(beforeClick, afterClick),
    );
    const canvasAssetsLoadedOnOpen = resourcesByName(resources, canvasAssetNames);
    return {
      mode,
      idle_callback_after_reload_ms: idle.idle?.firedAt == null ? null : round(idle.idle.firedAt),
      first_paint_after_reload_ms: shell.firstContentfulPaintMs,
      canvas_prefetch_assets: canvasPrefetchAssets,
      canvas_prefetch_bytes: sumResourceBytes(canvasPrefetchAssets) ?? 0,
      scripts_loaded_on_canvas_open: resources,
      scripts_loaded_on_canvas_open_bytes: sumResourceBytes(resources),
      canvas_assets_loaded_on_open: canvasAssetsLoadedOnOpen,
      canvas_assets_loaded_on_open_bytes: sumResourceBytes(canvasAssetsLoadedOnOpen),
      renderer_js_heap_before_canvas_bytes: heapBefore,
      renderer_js_heap_after_canvas_bytes: heapAfter,
      canvas_open_ms: opened.open_ms,
    };
  } finally {
    await cdp.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier }).catch(() => {});
  }
}

function benchmarkEnvironment(tempDir) {
  const allowed = new Set([
    'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  ]);
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key.toUpperCase())) env[key] = value;
  }
  env.APPDATA = path.join(tempDir, 'roaming');
  env.LOCALAPPDATA = path.join(tempDir, 'local');
  env.TEMP = tempDir;
  env.TMP = tempDir;
  env.ANTARES_PERF_BENCHMARK = '1';
  return env;
}

async function stopBenchmarkApp(child, cdp, tempDir, cleanup = true) {
  cdp?.close();
  if (child?.pid && child.exitCode === null) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 3_000,
      });
    } catch {}
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(1_000),
    ]);
  }
  if (cleanup) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  }
}

async function runIteration(exe, iteration, canvasAssetNames, options = {}) {
  const tempDir = options.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'antares-perf-'));
  const profileDir = path.join(tempDir, 'profile');
  const logsDir = path.join(tempDir, 'local', 'Antares', 'logs');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.rmSync(path.join(profileDir, 'DevToolsActivePort'), { force: true });
  const startedAt = Date.now();
  const child = spawn(exe, [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
  ], { env: benchmarkEnvironment(tempDir), stdio: 'ignore', windowsHide: false });
  let cdp;
  let stage = 'DevTools';
  try {
    child.on('error', (error) => {
      child.launchError = error;
    });
    const port = await waitForDevTools(profileDir, child, startedAt);
    stage = 'ventana CDP';
    const page = await waitForPageTarget(port, child);
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.command('Page.enable');
    await cdp.command('Runtime.enable');
    await cdp.command('Network.enable');
    const scriptRequestsSince = trackScriptRequests(cdp);
    await cdp.command('Network.setCacheDisabled', { cacheDisabled: true });
    stage = 'primer render';
    const firstRender = await waitForShell(cdp);
    const startupHeap = await rendererHeapBytes(cdp);
    const events = await waitForStartupEvents(logsDir, startedAt);
    const startupEvents = readAppEvents(logsDir).filter((event) => Date.parse(event.timestamp) >= startedAt);
    const readyEvent = startupEvents.find((event) =>
      event.event === 'renderer.lifecycle' && event.reason === 'ready_to_show',
    );
    const backendEvent = startupEvents.find((event) => event.event === 'backend.ready');
    stage = 'flujo Canvas';
    const workflow = options.canvasFlow ? await measureCanvasWorkflow(cdp, tempDir, options.canvasFlow) : null;
    const modes = options.startupOnly ? [] : iteration % 2 === 1
      ? ['on_demand', 'idle_prefetched']
      : ['idle_prefetched', 'on_demand'];
    const scenarios = {};
    for (const mode of modes) {
      stage = `Canvas ${mode}`;
      scenarios[mode] = await measureCanvasScenario(cdp, mode, scriptRequestsSince, canvasAssetNames);
    }
    return {
      iteration,
      scenario_order: modes,
      app_version: events.find((event) => event.app_version)?.app_version ?? null,
      startup: {
        first_paint_after_process_start_ms: round(Math.max(
          0,
          firstRender.timeOrigin + firstRender.firstContentfulPaintMs - startedAt,
        )),
        electron_process_to_ready_to_show_ms: readyEvent?.duration_ms ?? null,
        backend_spawn_to_ready_ms: backendEvent?.duration_ms ?? null,
        renderer_js_heap_bytes: startupHeap,
      },
      ...(workflow ? { workflow } : {}),
      canvas: scenarios,
    };
  } catch (error) {
    throw new Error(`iteración ${iteration}, etapa ${stage}: ${error.message}`);
  } finally {
    await stopBenchmarkApp(child, cdp, tempDir, !options.tempDir);
  }
}

function summarizeStartupPairs(samples) {
  const metrics = [
    'first_paint_after_process_start_ms',
    'electron_process_to_ready_to_show_ms',
    'backend_spawn_to_ready_ms',
    'renderer_js_heap_bytes',
  ];
  return Object.fromEntries(metrics.map((metric) => {
    const unit = metric.endsWith('_bytes') ? 'bytes' : 'ms';
    return [metric, {
      fresh_profile: summarize(samples.map((sample) => sample.fresh_profile[metric]), unit),
      reused_profile: summarize(samples.map((sample) => sample.reused_profile[metric]), unit),
      paired_reused_minus_fresh: summarize(samples.map((sample) => {
        const fresh = sample.fresh_profile[metric];
        const reused = sample.reused_profile[metric];
        return Number.isFinite(fresh) && Number.isFinite(reused) ? reused - fresh : NaN;
      }), unit),
    }];
  }));
}

function summarizeSamples(samples) {
  const scenarioValues = (mode, field) => samples
    .map((sample) => sample.canvas[mode][field])
    .filter(Number.isFinite);
  const pairedDelta = (field) => samples
    .map((sample) => sample.canvas.on_demand[field] - sample.canvas.idle_prefetched[field])
    .filter(Number.isFinite);
  return {
    first_paint_after_process_start_ms: summarize(samples.map((sample) => sample.startup.first_paint_after_process_start_ms)),
    electron_process_to_ready_to_show_ms: summarize(samples.map((sample) => sample.startup.electron_process_to_ready_to_show_ms)),
    backend_spawn_to_ready_ms: summarize(samples.map((sample) => sample.startup.backend_spawn_to_ready_ms)),
    canvas_open_ms: {
      on_demand: summarize(scenarioValues('on_demand', 'canvas_open_ms')),
      idle_prefetched: summarize(scenarioValues('idle_prefetched', 'canvas_open_ms')),
    },
    idle_prefetch_canvas_open_time_saved_ms: summarize(pairedDelta('canvas_open_ms')),
    first_paint_after_reload_ms: {
      on_demand: summarize(scenarioValues('on_demand', 'first_paint_after_reload_ms')),
      idle_prefetched: summarize(scenarioValues('idle_prefetched', 'first_paint_after_reload_ms')),
    },
    idle_prefetch_first_paint_time_saved_ms: summarize(pairedDelta('first_paint_after_reload_ms')),
    canvas_prefetch_bytes: summarize(scenarioValues('idle_prefetched', 'canvas_prefetch_bytes'), 'bytes'),
    scripts_loaded_on_canvas_open_bytes: {
      on_demand: summarize(scenarioValues('on_demand', 'scripts_loaded_on_canvas_open_bytes'), 'bytes'),
      idle_prefetched: summarize(scenarioValues('idle_prefetched', 'scripts_loaded_on_canvas_open_bytes'), 'bytes'),
    },
    canvas_assets_loaded_on_open_bytes: {
      on_demand: summarize(scenarioValues('on_demand', 'canvas_assets_loaded_on_open_bytes'), 'bytes'),
      idle_prefetched: summarize(scenarioValues('idle_prefetched', 'canvas_assets_loaded_on_open_bytes'), 'bytes'),
    },
    renderer_js_heap_after_canvas_bytes: {
      on_demand: summarize(scenarioValues('on_demand', 'renderer_js_heap_after_canvas_bytes'), 'bytes'),
      idle_prefetched: summarize(scenarioValues('idle_prefetched', 'renderer_js_heap_after_canvas_bytes'), 'bytes'),
    },
    renderer_js_heap_before_canvas_bytes: {
      on_demand: summarize(scenarioValues('on_demand', 'renderer_js_heap_before_canvas_bytes'), 'bytes'),
      idle_prefetched: summarize(scenarioValues('idle_prefetched', 'renderer_js_heap_before_canvas_bytes'), 'bytes'),
    },
    idle_prefetch_heap_delta_before_canvas_bytes: summarize(
      samples.map((sample) => sample.canvas.idle_prefetched.renderer_js_heap_before_canvas_bytes
        - sample.canvas.on_demand.renderer_js_heap_before_canvas_bytes)
        .filter(Number.isFinite),
      'bytes',
    ),
  };
}

function printHelp() {
  console.log([
    'Benchmark local del arranque de Antares y del precalentado de Canvas.',
    '',
    'Uso: npm run bench:desktop -- [--iterations N | --startup-pairs N] [--canvas-flow] [--exe RUTA] [--output RUTA]',
    '',
    'Requiere una build Windows desempacada. Cada iteración usa un perfil temporal,',
    'bloquea conexiones de Chromium a hosts externos y desactiva el auto-updater.',
    'El modo por defecto no abre documentos; ningún modo usa el perfil habitual de Antares.',
    '--startup-pairs compara dos procesos sucesivos con perfil nuevo/reutilizado;',
    'no vacía la caché del sistema operativo. --canvas-flow crea, edita y exporta',
    'una plantilla en el perfil temporal; requiere memoria suficiente para guardar.',
  ].join('\n'));
}

async function resolveCanvasAssetNames() {
  const frontendDir = path.join(ROOT, 'frontend');
  const jsDir = path.join(frontendDir, 'dist', 'assets', 'js');
  const indexHtmlPath = path.join(frontendDir, 'dist', 'index.html');
  if (!fs.existsSync(jsDir) || !fs.existsSync(indexHtmlPath)) {
    throw new Error('Falta frontend/dist; ejecuta primero npm run build:frontend.');
  }
  const canvasChunk = fs.readdirSync(jsDir).find((name) =>
    name.endsWith('.js') && fs.readFileSync(path.join(jsDir, name), 'utf8').includes('Cargando Canvas'),
  );
  if (!canvasChunk) throw new Error('No se identificó el chunk Canvas en frontend/dist.');
  const { shellChunkNames, staticClosure } = await import(
    pathToFileURL(path.join(frontendDir, 'scripts', 'lib', 'chunk-graph.mjs')).href
  );
  const shellAssets = staticClosure({
    jsDir,
    seeds: shellChunkNames(fs.readFileSync(indexHtmlPath, 'utf8')),
  });
  const canvasAssets = staticClosure({ jsDir, seeds: [canvasChunk] });
  return new Set([...canvasAssets.keys()].filter((name) => !shellAssets.has(name)));
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) return printHelp();
  if (process.platform !== 'win32') throw new Error('Este benchmark requiere Windows.');
  if (!fs.existsSync(options.exe)) {
    throw new Error(`No se encontró ${options.exe}; ejecuta primero npm run dist:dir.`);
  }

  const canvasAssetNames = options.startupPairs ? null : await resolveCanvasAssetNames();
  const samples = [];
  if (options.startupPairs) {
    for (let iteration = 1; iteration <= options.startupPairs; iteration += 1) {
      console.error(`[bench:desktop] par de arranque ${iteration}/${options.startupPairs}`);
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-perf-'));
      try {
        const fresh = await runIteration(options.exe, iteration, null, {
          tempDir, startupOnly: true, canvasFlow: options.canvasFlow ? 'create' : null,
        });
        const reused = await runIteration(options.exe, iteration, null, {
          tempDir, startupOnly: true, canvasFlow: options.canvasFlow ? 'reopen' : null,
        });
        samples.push({
          iteration, app_version: fresh.app_version,
          fresh_profile: fresh.startup, reused_profile: reused.startup,
          ...(options.canvasFlow ? { canvas_flow: { create: fresh.workflow, reopen: reused.workflow } } : {}),
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    }
  } else {
    for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
      console.error(`[bench:desktop] iteración ${iteration}/${options.iterations}`);
      samples.push(await runIteration(options.exe, iteration, canvasAssetNames));
    }
  }
  const report = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    mode: options.startupPairs ? 'startup_profile_pairs' : 'canvas_prefetch',
    app_version: samples.find((sample) => sample.app_version)?.app_version ?? null,
    methodology: {
      ...(options.startupPairs ? {
        startup: 'Dos procesos sucesivos con el mismo perfil temporal: perfil nuevo y reutilizado. No se vacía la caché del sistema operativo.',
        ...(options.canvasFlow ? { canvas_flow: 'Plantilla Formato reservorios: crear, editar una capa, guardar; reabrir tras reiniciar y exportar página PNG en el perfil temporal.' } : {}),
      } : {
        canvas_scenarios: 'Se miden secuencialmente en el mismo renderer; el orden alterna en cada iteración.',
        on_demand: 'Suprime requestIdleCallback, incluido el precalentado del modal de ajustes.',
        cache: 'La caché de Chromium está desactivada en cada recarga medida.',
      }),
      renderer_heap: 'Runtime.getHeapUsage mide heap JavaScript, no RSS del proceso.',
    },
    system: {
      platform: `${os.platform()} ${os.release()}`,
      architecture: os.arch(),
      logical_cpus: os.cpus().length,
      total_memory_bytes: os.totalmem(),
    },
    samples,
    summary: options.startupPairs ? {
      ...summarizeStartupPairs(samples),
      ...(options.canvasFlow ? {
        canvas_flow: Object.fromEntries([
          ['create_template_ms', 'create'], ['edit_layer_ms', 'create'], ['save_document_ms', 'create'],
          ['reopen_document_ms', 'reopen'], ['export_png_ms', 'reopen'], ['export_png_bytes', 'reopen'],
        ].map(([metric, phase]) => [metric, summarize(samples.map((sample) => sample.canvas_flow[phase][metric]),
          metric.endsWith('_bytes') ? 'bytes' : 'ms')])),
      } : {}),
    } : summarizeSamples(samples),
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, output, 'utf8');
    console.log(`[bench:desktop] resultados: ${options.output}`);
  } else {
    console.log(output);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[bench:desktop] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, mergeResources, parseArgs, resourceDelta, resourcesByName, summarize, summarizeSamples, summarizeStartupPairs };
