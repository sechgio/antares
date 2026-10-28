'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { assert, finish, stubModule } = require('./helpers/harness');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-cua-test-'));
const driverDir = path.join(tmp, 'resources', 'cua-driver');
fs.mkdirSync(driverDir, { recursive: true });
const fakeExe = Buffer.from('binario falso de cua-driver');
fs.writeFileSync(path.join(driverDir, 'cua-driver.exe'), fakeExe);
const writeManifest = (sha256) => fs.writeFileSync(path.join(driverDir, 'manifest.json'),
  JSON.stringify({ binaries: [{ path: 'cua-driver.exe', sha256 }] }));
writeManifest(crypto.createHash('sha256').update(fakeExe).digest('hex'));
process.resourcesPath = path.join(tmp, 'resources');

stubModule('electron/canvas-assets.js', { antaresUserData: (...parts) => path.join(tmp, 'user', ...parts) });
stubModule('electron', { nativeImage: { createFromBuffer: (buffer) => ({
  isEmpty: () => buffer.length === 0, toJPEG: () => Buffer.from('jpeg'), getSize: () => ({ width: 640, height: 400 }),
}) } });

const spawned = [];
const calls = [];
let answers = {};
function fakeChild(args, options) {
  const child = Object.assign(new EventEmitter(), {
    args, options, killed: false, stdout: new PassThrough(), stderr: new PassThrough(),
    kill() { this.killed = true; this.emit('exit', 0); },
  });
  child.stdin = { write(line) {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    if (message.method === 'tools/call') calls.push(message.params);
    const result = message.method === 'initialize' ? { serverInfo: { name: 'cua-driver' } }
      : (answers[message.params.name] || { content: [], structuredContent: {} });
    setImmediate(() => child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`));
  } };
  if (args[0] === 'serve') setImmediate(() => child.stderr.write('Cua Driver daemon listening on pipe\n'));
  spawned.push(child);
  return child;
}
childProcess.spawn = (exe, args, options) => fakeChild(args, options);

const cua = require('../electron/agent-cua');
const { nativeToolSpecs, nativeToolContext } = require('../electron/agent-native-tools');

async function main() {
  const specs = nativeToolSpecs().filter((spec) => spec.name.startsWith('cua_'));
  assert(specs.length === 15 && specs.every((spec) => spec.module === 'computer' && spec.kind === 'native'),
    'las 15 herramientas cua_ se registran como nativas del módulo Equipo');
  assert(specs.filter((spec) => !spec.gated).map((spec) => spec.name).sort().join()
    === 'cua_list_apps,cua_list_windows,cua_screen_size', 'solo listar ventanas, apps y pantalla se usa sin aprobación');
  const forbidden = ['session', 'target', 'scope', 'screenshot_out_file', 'capture_id'];
  assert(specs.every((spec) => forbidden.every((key) => !(key in spec.inputSchema.properties))),
    'los esquemas no exponen sesión, destino de escritorio, rutas de salida ni capturas ajenas');

  writeManifest('0'.repeat(64));
  let mismatch = null;
  try { await cua.run('cua_list_windows', {}); } catch (error) { mismatch = error.message; }
  assert(mismatch && mismatch.includes('no coincide con su manifest') && spawned.length === 0,
    'un binario que no coincide con su manifest no se ejecuta');
  writeManifest(crypto.createHash('sha256').update(fakeExe).digest('hex'));

  answers = { list_windows: { content: [{ type: 'text', text: 'Found 2 window(s).' }], structuredContent: {
    _legacy_windows: [], windows: [
      { window_id: 7, pid: 42, app_name: 'Notepad.exe', title: 'Notas - Bloc de notas', bounds: { x: 10, y: 20, width: 800, height: 600 } },
      { window_id: 8, pid: 42, app_name: 'Notepad.exe', title: '', bounds: { x: 0, y: 0, width: 1, height: 1 } },
    ] } } };
  const listed = await cua.run('cua_list_windows', { on_screen_only: true, screenshot_out_file: 'C:\\x.png' }, { sessionId: 'ab12cd' });
  const [daemon, proxy] = spawned;
  assert(daemon.args[0] === 'serve' && daemon.args[3] === '--no-overlay'
    && /^\\\\\.\\pipe\\antares-cua-[0-9a-f-]{36}$/.test(daemon.args[2]), 'el daemon arranca en un pipe con nombre aleatorio y sin overlay');
  assert(proxy.args[0] === 'mcp' && proxy.args[2] === daemon.args[2], 'el proxy MCP se conecta al pipe del daemon');
  const env = daemon.options.env;
  assert(env.CUA_DRIVER_RS_TELEMETRY_ENABLED === '0' && env.CUA_DRIVER_RS_UPDATE_CHECK === '0',
    'el driver arranca sin telemetría ni comprobación de actualizaciones');
  const policy = fs.readFileSync(env.CUA_DRIVER_POLICY_FILE, 'utf8');
  assert(policy.includes('list_windows') && policy.includes('get_window_state') && !policy.includes('kill_app')
    && !policy.includes('clipboard'), 'la política del daemon solo admite las herramientas expuestas');
  assert(JSON.stringify(calls[0]) === JSON.stringify({ name: 'list_windows', arguments: { on_screen_only: true, session: 'antares-ab12cd' } }),
    'solo se reenvían los argumentos del esquema más la sesión de la conversación');
  assert(listed.windows.length === 2 && !('_legacy_windows' in listed), 'el resultado conserva las ventanas sin duplicados internos');

  answers.get_window_state = { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('png').toString('base64') }],
    structuredContent: { pid: 42, window_id: 7, app_name: 'Notepad.exe', window_title: 'Notas - Bloc de notas',
      window_bounds: { x: 10, y: 20, width: 800, height: 600 }, tree_markdown: '# árbol',
      elements: [{ element_index: 0, element_token: 's00000001:0', role: 'Document', label: 'Editor de texto' }] } };
  const shots = path.join(tmp, 'user', 'drafts', 's1.screens');
  const state = await cua.run('cua_window_state', { pid: 42, window_id: 7 }, { sessionId: 's1', dir: shots });
  const stateArgs = calls.at(-1).arguments;
  assert(stateArgs.max_elements === 300 && stateArgs.max_image_dimension === 1280,
    'la lectura de ventana limita elementos y deja que el driver escale la captura');
  assert(!('tree_markdown' in state) && state.image.mime === 'image/jpeg' && fs.existsSync(state.image.path),
    'la captura se guarda como JPEG en los borradores y se omite el árbol en Markdown');
  assert(JSON.stringify(state.window_rect) === '[10,20,800,600]', 'el resultado indica el rectángulo de la ventana para el marco');

  const context = await nativeToolContext('cua_click', 's1', { pid: 42, window_id: 7, element_token: 's00000001:0' });
  assert(JSON.stringify(context.computer) === JSON.stringify(
    { app: 'Notepad.exe', window: 'Notas - Bloc de notas', element: 'Document «Editor de texto»' }),
  'la aprobación nombra la app, la ventana y el elemento');
  const unknown = cua.approvalContext('cua_click', { pid: 99, x: 1, y: 2 });
  assert(!('app' in unknown) && unknown.window.includes('99'), 'un pid sin leer no se presenta como app concedible');
  assert(cua.approvalContext('cua_launch_app', { path: 'C:\\Windows\\notepad.exe' }).app === 'notepad.exe',
    'abrir una app nombra el ejecutable');

  answers.click = { content: [{ type: 'text', text: 'Clicked' }], structuredContent: { effect: 'suspected_noop', delivery: { mode: 'background' } } };
  const noop = await cua.run('cua_click', { pid: 42, window_id: 7, element_token: 's00000001:0' }, { sessionId: 's1' });
  assert(noop.effect === 'suspected_noop' && noop.note.includes('no la des por hecha'), 'un clic sin efecto avisa de que no está hecho');

  answers.type_text = { isError: true, content: [{ type: 'text', text: 'Stale element token' }], structuredContent: { code: 'stale' } };
  let failure = null;
  try { await cua.run('cua_type_text', { pid: 42, text: 'hola' }, { sessionId: 's1' }); } catch (error) { failure = error.message; }
  assert(failure === 'Stale element token (stale)', 'un error del driver llega al agente como error');

  let unavailable = null;
  try { await cua.run('cua_kill_app', { pid: 42 }); } catch (error) { unavailable = error.message; }
  assert(unavailable && unavailable.includes('no disponible'), 'una herramienta fuera del catálogo se rechaza');

  cua.close();
  assert(daemon.killed && proxy.killed, 'cerrar detiene el daemon y el proxy');
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
