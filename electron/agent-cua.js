'use strict';

// Computer use con cua-driver (trycua, MIT): un daemon `serve` propio en un pipe con
// nombre aleatorio y un proxy `mcp --socket` por stdio que habla JSON-RPC. El driver
// actúa por accesibilidad y en segundo plano (no mueve el cursor ni roba el foco) e
// informa el efecto de cada acción. La política del daemon solo admite las herramientas
// expuestas aquí: si su archivo no existiera, el driver correría sin política, así que
// se escribe y se comprueba antes de arrancar.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const CATALOG = require('./agent-cua-tools.json');

const CALL_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 15_000;
const SHOT_DIMENSION = 1280;
const DEFAULT_MAX_ELEMENTS = 300;
const KEEP_SCREENS = 12;
const TOOLS = new Map(CATALOG.tools.map((tool) => [tool.name, tool]));
const MISSING_DRIVER = 'El driver de computer use no está instalado. Descarga el zip de cua-driver/manifest.json '
  + 'e instálalo con node scripts/prepare-cua-driver.js install <zip>';

let runtime = null;
let starting = null;
// Lo último que el driver dijo de cada ventana y elemento, para describir la
// acción en la tarjeta de aprobación sin volver a leer el escritorio.
const windows = new Map();
const elements = new Map();

function driverDir() {
  return process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'cua-driver'))
    ? path.join(process.resourcesPath, 'cua-driver')
    : path.join(__dirname, '..', 'cua-driver');
}

function verifiedExecutable() {
  const dir = driverDir();
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error(MISSING_DRIVER);
  }
  const bin = (manifest.binaries || []).find((entry) => entry.path === 'cua-driver.exe');
  const file = path.join(dir, 'cua-driver.exe');
  if (!bin || !fs.existsSync(file)) throw new Error(MISSING_DRIVER);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (digest !== bin.sha256) throw new Error('El driver de computer use no coincide con su manifest; reinstálalo');
  return file;
}

function policyFile() {
  const { antaresUserData } = require('./canvas-assets');
  const file = path.join(antaresUserData('ai-agent'), 'cua-policy.yaml');
  const body = `allow:\n  tools: [${[...TOOLS.values()].map((tool) => tool.tool).join(', ')}]\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  if (fs.readFileSync(file, 'utf8') !== body) throw new Error('No se pudo preparar la política del driver de computer use');
  return file;
}

function driverEnv() {
  return {
    ...process.env,
    CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
    CUA_DRIVER_RS_UPDATE_CHECK: '0',
    CUA_DRIVER_POLICY_FILE: policyFile(),
  };
}

function stop() {
  const current = runtime;
  runtime = null;
  if (!current) return;
  for (const { reject, timer } of current.pending.values()) {
    clearTimeout(timer);
    reject(new Error('El driver de computer use se detuvo'));
  }
  current.pending.clear();
  for (const child of [current.proxy, current.daemon]) {
    try { child.kill(); } catch {}
  }
}

function request(current, method, params, timeoutMs = CALL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const id = current.next++;
    const timer = setTimeout(() => {
      current.pending.delete(id);
      reject(Object.assign(new Error('El driver de computer use no respondió a tiempo'), { uncertain: true }));
    }, timeoutMs);
    current.pending.set(id, { resolve, reject, timer });
    current.proxy.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function start() {
  const exe = verifiedExecutable();
  const env = driverEnv();
  const pipe = `\\\\.\\pipe\\antares-cua-${crypto.randomUUID()}`;
  const daemon = spawn(exe, ['serve', '--socket', pipe, '--no-overlay'], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El driver de computer use no arrancó')), START_TIMEOUT_MS);
    let log = '';
    daemon.stderr.on('data', (chunk) => {
      log += String(chunk);
      if (log.includes('listening')) { clearTimeout(timer); resolve(); }
    });
    daemon.once('exit', () => { clearTimeout(timer); reject(new Error('El driver de computer use terminó al arrancar')); });
    daemon.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
  const proxy = spawn(exe, ['mcp', '--socket', pipe], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const current = { daemon, proxy, pending: new Map(), next: 1 };
  readline.createInterface({ input: proxy.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = current.pending.get(message.id);
    if (!waiter) return;
    current.pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(String(message.error.message || 'Error del driver de computer use')));
    else waiter.resolve(message.result);
  });
  for (const child of [daemon, proxy]) child.once('exit', () => { if (runtime === current) stop(); });
  await request(current, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'antares', version: CATALOG.driverVersion },
  }, START_TIMEOUT_MS);
  proxy.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return current;
}

async function ensureRuntime() {
  if (runtime) return runtime;
  if (!starting) {
    starting = start().then((current) => { runtime = current; return current; }).finally(() => { starting = null; });
  }
  return starting;
}

function remember(tool, args, structured) {
  if (!structured || typeof structured !== 'object') return;
  for (const win of structured.windows || []) {
    windows.set(String(win.window_id), { pid: win.pid, app: win.app_name, title: win.title, bounds: win.bounds });
  }
  if (tool === 'get_window_state' && structured.window_id !== undefined) {
    windows.set(String(structured.window_id), { pid: structured.pid, app: structured.app_name,
      title: structured.window_title, bounds: structured.window_bounds });
    for (const element of structured.elements || []) {
      if (element.element_token) elements.set(element.element_token, { role: element.role, label: element.label });
    }
  }
  if (elements.size > 5000) elements.clear();
}

function targetWindow(params) {
  if (params.window_id !== undefined) return windows.get(String(params.window_id)) || null;
  if (params.pid === undefined) return null;
  return [...windows.values()].find((win) => win.pid === params.pid) || null;
}

// Lo que la tarjeta de aprobación muestra y lo que se compara al ejecutar.
function approvalContext(name, params = {}) {
  if (name === 'cua_launch_app') {
    const app = String(params.name || path.basename(String(params.path || ''))).trim();
    return app ? { app } : {};
  }
  const win = targetWindow(params);
  const info = {};
  if (win) {
    info.app = win.app;
    info.window = win.title;
  } else if (params.pid !== undefined) {
    // Sin app no hay concesión por app ni lista blanca: un pid se reutiliza.
    info.window = `Proceso ${params.pid} (sin leer con cua_list_windows)`;
  }
  const element = params.element_token ? elements.get(String(params.element_token)) : null;
  if (element) info.element = element.label ? `${element.role} «${element.label}»` : String(element.role || '');
  return info;
}

function saveShot(item, dir) {
  if (!dir) return null;
  const { nativeImage } = require('electron');
  const image = nativeImage.createFromBuffer(Buffer.from(String(item.data), 'base64'));
  if (image.isEmpty()) return null;
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `cua-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`);
  fs.writeFileSync(target, image.toJPEG(70));
  const old = fs.readdirSync(dir).filter((file) => file.startsWith('cua-')).sort().slice(0, -KEEP_SCREENS);
  for (const file of old) fs.rmSync(path.join(dir, file), { force: true });
  const { width, height } = image.getSize();
  return { path: target, mime: 'image/jpeg', width, height };
}

function shape(tool, result, dir) {
  const structured = result.structuredContent && typeof result.structuredContent === 'object'
    ? { ...result.structuredContent } : null;
  const text = (result.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n').trim();
  if (result.isError) {
    const code = structured && structured.code ? ` (${structured.code})` : '';
    throw new Error(`${text || 'El driver rechazó la acción'}${code}`);
  }
  const out = structured || {};
  // La versión Markdown del árbol duplica `elements`.
  delete out.tree_markdown;
  delete out._legacy_windows;
  if (!structured && text) out.summary = text;
  const shot = (result.content || []).find((item) => item.type === 'image' && item.data);
  if (shot) {
    const image = saveShot(shot, dir);
    if (image) out.image = image;
  }
  if (out.effect === 'suspected_noop' || out.effect === 'refused') {
    out.note = 'La acción no surtió efecto: no la des por hecha. Vuelve a leer la ventana y prueba otra vía.';
  } else if (out.effect === 'unverifiable') {
    out.note = 'El driver no pudo comprobar el efecto: lee la ventana y describe lo que ves, no lo que enviaste.';
  }
  return out;
}

async function run(name, params = {}, { sessionId, dir } = {}) {
  const spec = TOOLS.get(name);
  if (!spec) throw new Error(`Herramienta no disponible para el agente: ${name}`);
  const args = {};
  for (const key of Object.keys(spec.inputSchema.properties)) {
    if (params[key] !== undefined) args[key] = params[key];
  }
  if (spec.tool === 'get_window_state') {
    if (args.max_elements === undefined) args.max_elements = DEFAULT_MAX_ELEMENTS;
    args.max_image_dimension = SHOT_DIMENSION;
  }
  if (sessionId) args.session = `antares-${String(sessionId).replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
  const current = await ensureRuntime();
  const result = await request(current, 'tools/call', { name: spec.tool, arguments: args });
  const out = shape(spec.tool, result || {}, dir);
  remember(spec.tool, args, out);
  const win = targetWindow(params);
  if (win && win.bounds) out.window_rect = [win.bounds.x, win.bounds.y, win.bounds.width, win.bounds.height];
  return out;
}

function close() {
  stop();
  windows.clear();
  elements.clear();
}

module.exports = { TOOLS, run, approvalContext, close };
