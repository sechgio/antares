'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { assert, finish } = require('./helpers/harness');
const { detect, launch, launchArgs, firefoxArgs, FIREFOX_PREFS, pipeTransport, label, isSession, attachment } = require('../electron/agent-browser-engines');

const tick = () => new Promise((resolve) => setImmediate(resolve));

function detectTest() {
  const env = { PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };
  const present = new Set([
    'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\PF\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Users\\a\\AppData\\Local\\Programs\\Opera\\opera.exe',
    'C:\\Users\\a\\AppData\\Local\\Programs\\Opera\\120.0.5543.61\\opera.exe',
    'C:\\Users\\a\\AppData\\Local\\Programs\\Opera\\99.0.1\\opera.exe',
  ]);
  const readdir = (dir) => {
    if (dir !== 'C:\\Users\\a\\AppData\\Local\\Programs\\Opera') throw new Error('no existe');
    return ['99.0.1', 'assistant', '120.0.5543.61', 'opera.exe'];
  };
  const found = detect({ env, exists: (file) => present.has(file), readdir });
  assert(found.map((engine) => engine.id).join() === 'chrome,edge,opera,chrome-session', 'detecta los navegadores instalados y omite los ausentes');
  assert(found[3].label === 'Mi sesión de Chrome' && found[3].session === true
    && found[3].path === 'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\User Data', 'con Chrome instalado ofrece usar la sesión abierta del usuario');
  assert(!detect({ env, exists: (file) => file.includes('Edge'), readdir }).some((engine) => engine.session),
    'sin Chrome no ofrece la sesión de Chrome');
  assert(found[0].path.endsWith('Local\\Google\\Chrome\\Application\\chrome.exe'), 'encuentra Chrome instalado solo para el usuario');
  assert(found[1].path === 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe', 'prefiere la primera ruta conocida de cada navegador');
  assert(found[2].path.endsWith('Opera\\120.0.5543.61\\opera.exe'),
    'usa el Opera de la versión más reciente, no el lanzador que perdería la tubería');
  assert(detect({ env: {}, exists: () => true, readdir }).length === 0, 'sin variables de entorno no inventa rutas');
  assert(label('brave') === 'Brave' && label('otro') === '', 'conoce el nombre visible de cada navegador');
  const args = launchArgs('C:\\perfiles\\chrome');
  assert(args.includes('--remote-debugging-pipe') && args.includes('--user-data-dir=C:\\perfiles\\chrome')
    && !args.some((arg) => arg.startsWith('--remote-debugging-port')),
  'lanza con tubería y perfil propio, nunca con un puerto TCP');
}

async function transportTest() {
  const out = new PassThrough();
  const input = new PassThrough();
  const written = [];
  out.on('data', (chunk) => written.push(chunk.toString()));
  const transport = pipeTransport(out, input);
  const events = [];
  transport.on((message) => events.push(message));
  const first = transport.send('Browser.getVersion');
  const second = transport.send('Page.navigate', { url: 'https://a.example' }, 'S1');
  const failing = transport.send('Nada.existe');
  await tick();
  const sent = written.join('').split('\0').filter(Boolean).map((raw) => JSON.parse(raw));
  assert(sent[0].id === 1 && sent[0].method === 'Browser.getVersion' && !('sessionId' in sent[0])
    && sent[1].sessionId === 'S1' && written.join('').endsWith('\0'), 'cada orden sale como JSON terminado en \\0 con su sesión');
  const frame = `${JSON.stringify({ id: 2, result: { frameId: 'F' } })}\0${JSON.stringify({ method: 'Page.loadEventFired', params: {}, sessionId: 'S1' })}\0`;
  input.write(frame.slice(0, 13));
  input.write(frame.slice(13));
  input.write(`${JSON.stringify({ id: 1, result: { product: 'Chrome/150' } })}\0${JSON.stringify({ id: 3, error: { message: 'no existe' } })}\0`);
  assert((await second).frameId === 'F' && (await first).product === 'Chrome/150', 'resuelve respuestas aunque lleguen partidas o desordenadas');
  let rejected = null;
  try { await failing; } catch (error) { rejected = error; }
  assert(rejected && rejected.code === 'CDP_ERROR' && rejected.message === 'no existe', 'rechaza con el error que devuelve el navegador');
  assert(events.length === 1 && events[0].method === 'Page.loadEventFired' && events[0].sessionId === 'S1', 'entrega los eventos a los oyentes');
  const pending = transport.send('Page.reload');
  transport.close(new Error('cerrado'));
  let closed = null;
  try { await pending; } catch (error) { closed = error.message; }
  let after = null;
  try { await transport.send('Page.reload'); } catch (error) { after = error.message; }
  assert(closed === 'cerrado' && after === 'cerrado', 'al cerrarse rechaza lo pendiente y lo que se envíe después');
}

// Un Chromium falso que habla CDP por la tubería del proceso lanzado.
function fakeBrowser({ failStart = false } = {}) {
  const commands = [];
  const child = new EventEmitter();
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  child.stdio = [null, null, null, toBrowser, fromBrowser];
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit('exit', 1); };
  const reply = (message) => fromBrowser.write(`${JSON.stringify(message)}\0`);
  const results = {
    'Target.createTarget': () => ({ targetId: 'T1' }),
    'Target.attachToTarget': () => ({ sessionId: 'S1' }),
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'T1', url: 'about:blank' } } }),
    'Page.getNavigationHistory': () => ({ currentIndex: 0, entries: [{ id: 1, url: 'about:blank' }] }),
  };
  let buffer = '';
  toBrowser.setEncoding('utf8');
  toBrowser.on('data', (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      commands.push(message);
      if (failStart && message.method === 'Target.setDiscoverTargets') { reply({ id: message.id, error: { message: 'perfil ocupado' } }); continue; }
      reply({ id: message.id, result: results[message.method] ? results[message.method](message.params) : {} });
    }
  });
  const event = (method, params, sessionId) => fromBrowser.write(`${JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  return { child, commands, event, spawned: [] };
}

async function launchTest() {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-engines-'));
  try {
    const fake = fakeBrowser();
    const engines = [{ id: 'chrome', label: 'Google Chrome', path: 'C:\\Chrome\\chrome.exe' }];
    const spawn = (exe, args, options) => { fake.spawned.push({ exe, args, options }); return fake.child; };
    let missing = null;
    try { await launch('opera', { profileRoot, spawn, engines }); } catch (error) { missing = error.code; }
    assert(missing === 'ENGINE_MISSING' && fake.spawned.length === 0, 'no lanza un navegador que no está instalado');

    const link = await launch('chrome', { profileRoot, spawn, engines });
    const launched = fake.spawned[0];
    assert(launched.exe === 'C:\\Chrome\\chrome.exe' && launched.args.includes(`--user-data-dir=${path.join(profileRoot, 'chrome')}`)
      && launched.options.stdio[3] === 'pipe' && launched.options.stdio[4] === 'pipe' && fs.existsSync(path.join(profileRoot, 'chrome')),
    'lanza el ejecutable con su perfil dedicado y las tuberías 3 y 4');
    const startup = fake.commands.map((command) => command.method);
    assert(startup[0] === 'Target.setDiscoverTargets' && fake.commands.some((command) => command.method === 'Browser.setDownloadBehavior'
      && command.params.behavior === 'deny'), 'descubre pestañas y deniega las descargas del navegador');
    const denied = fake.commands.filter((command) => command.method === 'Browser.setPermission' && command.params.setting === 'denied')
      .map((command) => command.params.permission.name);
    assert(['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read'].every((name) => denied.includes(name)),
      'deniega ubicación, notificaciones, cámara, micrófono y portapapeles');

    const decisions = [];
    const popups = [];
    const allow = (url, pageUrl, mainFrame) => {
      decisions.push({ url, pageUrl, mainFrame });
      return url.includes('privada') ? Promise.resolve(false) : true;
    };
    const contents = await link.openTab({ allow, onPopup: (url) => popups.push(url) });
    const tabCommands = fake.commands.filter((command) => command.sessionId === 'S1').map((command) => command.method);
    assert(fake.commands.some((command) => command.method === 'Target.attachToTarget' && command.params.flatten === true)
      && tabCommands.indexOf('Fetch.enable') >= 0 && tabCommands.indexOf('Fetch.enable') < tabCommands.indexOf('Page.enable')
      && tabCommands.includes('Target.setAutoAttach') && tabCommands.includes('Network.setBypassServiceWorker'),
    'protege la pestaña (red, hijos y service workers) antes de entregarla');
    assert(contents.getURL() === 'about:blank' && typeof contents.executeJavaScript === 'function', 'entrega una pestaña con la forma de WebContents');

    fake.event('Fetch.requestPaused', { requestId: 'r1', request: { url: 'https://publica.example/' }, resourceType: 'Document', frameId: 'T1' }, 'S1');
    fake.event('Fetch.requestPaused', { requestId: 'r2', request: { url: 'http://privada.local/x' }, resourceType: 'XHR', frameId: 'T1' }, 'S1');
    fake.event('Fetch.requestPaused', { requestId: 'r3', request: { url: 'https://otra.example/' }, resourceType: 'Document', frameId: 'F2' }, 'S1');
    await tick(); await tick();
    const continued = fake.commands.find((command) => command.method === 'Fetch.continueRequest' && command.params.requestId === 'r1');
    const failed = fake.commands.find((command) => command.method === 'Fetch.failRequest' && command.params.requestId === 'r2');
    assert(continued && continued.sessionId === 'S1' && failed && failed.params.errorReason === 'BlockedByClient',
      'cada petición pasa por la política: lo permitido continúa y lo demás se bloquea');
    assert(decisions[0].mainFrame === true && decisions[1].mainFrame === false && decisions[2].mainFrame === false
      && decisions[0].pageUrl === 'about:blank', 'solo el documento del marco principal cuenta como navegación de la pestaña');

    fake.event('Target.attachedToTarget', { sessionId: 'S2', targetInfo: { targetId: 'IF1', type: 'iframe', url: 'https://x.example/' },
      waitingForDebugger: true }, 'S1');
    await tick(); await tick(); await tick();
    const child = fake.commands.filter((command) => command.sessionId === 'S2').map((command) => command.method);
    assert(child.indexOf('Fetch.enable') >= 0 && child.indexOf('Runtime.runIfWaitingForDebugger') > child.indexOf('Fetch.enable'),
      'un iframe de otro proceso queda protegido antes de reanudarse');
    fake.event('Fetch.requestPaused', { requestId: 'r4', request: { url: 'http://privada.local/y' }, resourceType: 'Image', frameId: 'IF1' }, 'S2');
    await tick(); await tick();
    assert(fake.commands.some((command) => command.method === 'Fetch.failRequest' && command.sessionId === 'S2'),
      'las peticiones del iframe también pasan por la política');

    fake.event('Target.attachedToTarget', { sessionId: 'S3', targetInfo: { targetId: 'P1', type: 'page', url: 'https://emergente.example/' },
      waitingForDebugger: true }, 'S1');
    fake.event('Target.attachedToTarget', { sessionId: 'S4', targetInfo: { targetId: 'P2', type: 'page', url: 'about:blank' } }, 'S1');
    await tick(); await tick();
    const closedTargets = fake.commands.filter((command) => command.method === 'Target.closeTarget').map((command) => command.params.targetId);
    assert(closedTargets.join() === 'P1,P2' && popups.join() === 'https://emergente.example/'
      && !fake.commands.some((command) => command.sessionId === 'S3' && command.method === 'Runtime.runIfWaitingForDebugger'),
    'las ventanas emergentes se cierran sin cargar y su dirección vuelve a la pestaña del agente');

    fake.event('Fetch.requestPaused', { requestId: 'r5', request: { url: 'https://ajena.example/' }, resourceType: 'Document', frameId: 'X' }, 'S9');
    await tick();
    assert(!fake.commands.some((command) => command.params && command.params.requestId === 'r5'), 'no toca sesiones que no protegió');

    let exited = 0;
    link.onExit(() => { exited += 1; });
    let destroyed = false;
    contents.on('destroyed', () => { destroyed = true; });
    fake.child.emit('exit', 0);
    let afterExit = null;
    try { await contents.executeJavaScript('1'); } catch (error) { afterExit = error.code; }
    assert(destroyed && contents.isDestroyed() && exited === 1 && afterExit === 'ENGINE_CLOSED',
      'si el usuario cierra el navegador la pestaña se destruye y se avisa al agente');

    const busy = fakeBrowser({ failStart: true });
    let startError = null;
    try { await launch('chrome', { profileRoot, spawn: () => busy.child, engines }); } catch (error) { startError = error; }
    assert(startError && startError.code === 'ENGINE_START' && /ciérralo/.test(startError.message) && busy.child.killed,
      'si el navegador no responde explica cómo resolverlo y termina el proceso');
  } finally {
    fs.rmSync(profileRoot, { recursive: true, force: true });
  }
}

// Un Chrome abierto por el usuario: acepta o rechaza la conexión y responde CDP por WebSocket.
function fakeSessionChrome() {
  const sockets = [];
  const commands = [];
  const results = {
    'Target.createTarget': () => ({ targetId: 'T1' }),
    'Target.attachToTarget': () => ({ sessionId: 'S1' }),
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'T1', url: 'about:blank' } } }),
    'Page.getNavigationHistory': () => ({ currentIndex: 0, entries: [{ id: 1, url: 'about:blank' }] }),
  };
  class FakeSocket extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      this.closed = false;
      sockets.push(this);
    }
    addEventListener(name, listener) { this.on(name, listener); }
    send(text) {
      const message = JSON.parse(text);
      commands.push(message);
      setImmediate(() => this.emit('message', { data: JSON.stringify({ id: message.id,
        result: results[message.method] ? results[message.method](message.params) : {} }) }));
    }
    close() { if (!this.closed) { this.closed = true; this.emit('close', {}); } }
    accept() { this.emit('open', {}); }
    event(method, params, sessionId) {
      this.emit('message', { data: JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }) });
    }
  }
  return { FakeSocket, sockets, commands };
}

async function sessionTest() {
  assert(isSession('chrome-session') && !isSession('chrome'), 'distingue la sesión del usuario de los perfiles dedicados');
  assert(attachment([{ name: 'Content-Disposition', value: 'attachment; filename="a.exe"' }])
    && attachment([{ name: 'content-type', value: 'application/octet-stream' }])
    && !attachment([{ name: 'content-type', value: 'text/html; charset=utf-8' }])
    && !attachment([{ name: 'content-disposition', value: 'inline' }]), 'reconoce las respuestas que Chrome guardaría como descarga');

  const engines = [{ id: 'chrome-session', label: 'Mi sesión de Chrome', session: true, path: 'C:\\Users\\a\\Chrome\\User Data' }];
  const chrome = fakeSessionChrome();
  let read = null;
  const portFile = (text) => (file) => { read = file; if (text === null) throw new Error('ENOENT'); return text; };
  const options = (text, extra = {}) => ({ engines, readFile: portFile(text), WebSocketImpl: chrome.FakeSocket, acceptMs: 50, ...extra });

  let disabled = null;
  try { await launch('chrome-session', options(null)); } catch (error) { disabled = error; }
  assert(disabled && disabled.code === 'ENGINE_NOT_ENABLED' && disabled.message.includes('chrome://inspect/#remote-debugging')
    && read === 'C:\\Users\\a\\Chrome\\User Data\\DevToolsActivePort' && chrome.sockets.length === 0,
  'sin la depuración remota activada explica cómo activarla y no intenta conectar');
  let malformed = null;
  try { await launch('chrome-session', options('9222\n/otra/cosa')); } catch (error) { malformed = error.code; }
  assert(malformed === 'ENGINE_NOT_ENABLED' && chrome.sockets.length === 0, 'no conecta a un destino que no es el navegador');

  const rejecting = launch('chrome-session', options('9333\n/devtools/browser/abc'));
  await tick();
  chrome.sockets[0].close();
  let denied = null;
  try { await rejecting; } catch (error) { denied = error; }
  assert(chrome.sockets[0].url === 'ws://127.0.0.1:9333/devtools/browser/abc' && denied && denied.code === 'ENGINE_DENIED'
    && /Acepta el aviso de Chrome/.test(denied.message), 'si el usuario rechaza el aviso de Chrome, no se conecta y lo explica');
  let timedOut = null;
  try { await launch('chrome-session', options('9333\n/devtools/browser/abc')); } catch (error) { timedOut = error.code; }
  assert(timedOut === 'ENGINE_DENIED' && chrome.sockets[1].closed, 'si nadie acepta a tiempo abandona la conexión');

  const connecting = launch('chrome-session', options('9333\r\n/devtools/browser/abc\r\n', { acceptMs: 5_000 }));
  await tick();
  const socket = chrome.sockets[2];
  socket.accept();
  const link = await connecting;
  assert(link.session === true && link.label === 'Mi sesión de Chrome', 'se conecta tras aceptar el aviso de Chrome');
  const browserLevel = chrome.commands.filter((command) => !command.sessionId).map((command) => command.method);
  assert(browserLevel.join() === 'Target.setDiscoverTargets',
    'no cambia descargas ni permisos globales del Chrome del usuario');

  const decisions = [];
  const contents = await link.openTab({ allow: (url) => { decisions.push(url); return !url.includes('privada'); }, onPopup: () => {} });
  const fetchEnable = chrome.commands.find((command) => command.method === 'Fetch.enable' && command.sessionId === 'S1');
  assert(fetchEnable.params.patterns.some((pattern) => pattern.requestStage === 'Request' && !pattern.resourceType)
    && ['Document', 'Other'].every((type) => fetchEnable.params.patterns.some((pattern) => pattern.resourceType === type && pattern.requestStage === 'Response')),
  'en la sesión del usuario la pestaña revisa también las respuestas que serían descargas');
  socket.event('Fetch.requestPaused', { requestId: 'q1', request: { url: 'https://publica.example/' }, resourceType: 'Document', frameId: 'T1' }, 'S1');
  socket.event('Fetch.requestPaused', { requestId: 'q2', request: { url: 'https://publica.example/' }, resourceType: 'Document', frameId: 'T1',
    responseStatusCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html' }] }, 'S1');
  socket.event('Fetch.requestPaused', { requestId: 'q3', request: { url: 'https://publica.example/setup.exe' }, resourceType: 'Document', frameId: 'T1',
    responseStatusCode: 200, responseHeaders: [{ name: 'Content-Disposition', value: 'attachment; filename=setup.exe' }] }, 'S1');
  socket.event('Fetch.requestPaused', { requestId: 'q4', request: { url: 'http://privada.local/' }, resourceType: 'Document', frameId: 'T1' }, 'S1');
  await tick(); await tick(); await tick();
  const answer = (id) => chrome.commands.find((command) => command.params && command.params.requestId === id);
  assert(answer('q1').method === 'Fetch.continueRequest' && answer('q2').method === 'Fetch.continueResponse'
    && answer('q3').method === 'Fetch.failRequest' && answer('q4').method === 'Fetch.failRequest'
    && decisions.join() === 'https://publica.example/,http://privada.local/',
  'continúa las páginas, corta las descargas que no pidió web_download y aplica la política de red');

  let exited = 0;
  link.onExit(() => { exited += 1; });
  link.close();
  await tick(); await tick();
  const closing = chrome.commands.filter((command) => command.method === 'Target.closeTarget').map((command) => command.params.targetId);
  assert(closing.join() === 'T1' && socket.closed && !chrome.commands.some((command) => command.method === 'Browser.close'),
    'al desconectar cierra solo la pestaña del agente y deja abierto el Chrome del usuario');
  assert(contents.isDestroyed() && exited === 1, 'al cortarse la conexión la pestaña se da por cerrada y se avisa al agente');
}

// Un Firefox falso: anuncia WebDriver BiDi por stderr y responde por WebSocket.
function fakeFirefox({ announce = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit('exit', 1); };
  const commands = [];
  const sockets = [];
  const results = { 'session.new': () => ({ sessionId: 'sesion' }), 'browsingContext.create': () => ({ context: 'C1' }) };
  class FakeSocket extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
      setImmediate(() => this.emit('open', {}));
    }
    addEventListener(name, listener) { this.on(name, listener); }
    send(text) {
      const message = JSON.parse(text);
      commands.push(message);
      setImmediate(() => this.emit('message', { data: JSON.stringify({ type: 'success', id: message.id,
        result: results[message.method] ? results[message.method](message.params) : {} }) }));
    }
    close() { this.emit('close', {}); }
    event(method, params) { this.emit('message', { data: JSON.stringify({ type: 'event', method, params }) }); }
  }
  if (announce) setImmediate(() => child.stderr.write('1730 INFO WebDriver BiDi listening on ws://127.0.0.1:53111\n'));
  return { child, commands, sockets, FakeSocket };
}

async function firefoxTest() {
  const env = { PROGRAMFILES: 'C:\\PF', LOCALAPPDATA: 'C:\\L' };
  const found = detect({ env, exists: (file) => file === 'C:\\PF\\Mozilla Firefox\\firefox.exe', readdir: () => [] });
  assert(found.length === 1 && found[0].id === 'firefox' && found[0].protocol === 'bidi' && label('firefox') === 'Mozilla Firefox',
    'detecta Firefox y lo marca para WebDriver BiDi');
  assert(firefoxArgs('C:\\p').join(' ') === '--remote-debugging-port=0 --profile C:\\p --no-remote --new-instance about:blank',
    'Firefox arranca con perfil propio y un puerto aleatorio solo para Antares');

  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-firefox-'));
  try {
    const engines = [{ id: 'firefox', label: 'Mozilla Firefox', path: 'C:\\FF\\firefox.exe', protocol: 'bidi' }];
    const firefox = fakeFirefox();
    const spawned = [];
    const link = await launch('firefox', { profileRoot, engines, WebSocketImpl: firefox.FakeSocket,
      spawn: (exe, args, options) => { spawned.push({ exe, args, options }); return firefox.child; } });
    const userJs = fs.readFileSync(path.join(profileRoot, 'firefox', 'user.js'), 'utf8');
    assert(spawned[0].exe === 'C:\\FF\\firefox.exe' && spawned[0].args.includes(path.join(profileRoot, 'firefox')),
      'lanza Firefox con su perfil dedicado');
    assert(Object.entries(FIREFOX_PREFS).every(([name, value]) => userJs.includes(`user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`))
      && FIREFOX_PREFS['permissions.default.camera'] === 2 && FIREFOX_PREFS['browser.download.always_ask_before_handling_new_types'] === true,
    'el perfil deniega permisos, pregunta antes de descargar y desactiva la precarga');
    assert(firefox.sockets[0].url === 'ws://127.0.0.1:53111/session', 'se conecta a la dirección que anuncia Firefox');
    const setup = firefox.commands.map((command) => command.method);
    assert(setup.join() === 'session.new,session.subscribe,network.addIntercept'
      && firefox.commands[2].params.phases.join() === 'beforeRequestSent,responseStarted',
    'abre la única sesión BiDi, se suscribe y intercepta toda la red');

    const decisions = [];
    const popups = [];
    const allow = (url, pageUrl, mainFrame) => { decisions.push({ url, pageUrl, mainFrame }); return !url.includes('privada'); };
    const contents = await link.openTab({ allow, onPopup: (url) => popups.push(url) });
    assert(firefox.commands.some((command) => command.method === 'browsingContext.create' && command.params.type === 'tab')
      && contents.getURL() === 'about:blank', 'abre una pestaña propia con la forma de WebContents');

    const socket = firefox.sockets[0];
    const answers = () => firefox.commands.filter((command) => command.method.startsWith('network.') && command.params.request);
    socket.event('network.beforeRequestSent', { context: 'C1', navigation: 'n1', isBlocked: true, request: { request: 'q1', url: 'https://publica.example/' } });
    socket.event('browsingContext.contextCreated', { context: 'F1', parent: 'C1', url: 'about:blank' });
    socket.event('network.beforeRequestSent', { context: 'F1', navigation: 'n2', isBlocked: true, request: { request: 'q2', url: 'http://privada.local/' } });
    socket.event('network.beforeRequestSent', { context: 'C1', navigation: null, isBlocked: true, request: { request: 'q3', url: 'https://cdn.example/a.js' } });
    socket.event('network.beforeRequestSent', { context: 'C1', isBlocked: false, request: { request: 'q4', url: 'https://ya.example/' } });
    await tick(); await tick();
    const byRequest = Object.fromEntries(answers().map((command) => [command.params.request, command.method]));
    assert(byRequest.q1 === 'network.continueRequest' && byRequest.q2 === 'network.failRequest' && byRequest.q3 === 'network.continueRequest'
      && !byRequest.q4, 'cada petición interceptada pasa por la política y solo se responden las bloqueadas');
    assert(decisions[0].mainFrame === true && decisions[1].mainFrame === false && decisions[2].mainFrame === false,
      'solo la navegación de la pestaña cuenta como marco principal; un iframe no');

    socket.event('network.responseStarted', { context: 'C1', isBlocked: true, request: { request: 'q5' },
      response: { headers: [{ name: 'Content-Disposition', value: { type: 'string', value: 'attachment; filename=a.exe' } }] } });
    socket.event('network.responseStarted', { context: 'C1', isBlocked: true, request: { request: 'q6' },
      response: { headers: [{ name: 'content-type', value: { type: 'string', value: 'text/html' } }] } });
    await tick(); await tick();
    const responses = Object.fromEntries(answers().map((command) => [command.params.request, command.method]));
    assert(responses.q5 === 'network.failRequest' && responses.q6 === 'network.continueResponse',
      'corta las respuestas que serían descargas y deja pasar las páginas');

    socket.event('browsingContext.contextCreated', { context: 'P1', parent: null, originalOpener: 'C1', url: 'about:blank' });
    socket.event('network.beforeRequestSent', { context: 'P1', navigation: 'n3', isBlocked: true, request: { request: 'q7', url: 'https://emergente.example/' } });
    socket.event('browsingContext.contextCreated', { context: 'U1', parent: null, url: 'about:blank' });
    socket.event('network.beforeRequestSent', { context: 'U1', navigation: 'n4', isBlocked: true, request: { request: 'q8', url: 'http://privada.local/' } });
    await tick(); await tick();
    const later = Object.fromEntries(answers().map((command) => [command.params.request, command.method]));
    assert(later.q7 === 'network.failRequest' && popups.join() === 'https://emergente.example/'
      && firefox.commands.some((command) => command.method === 'browsingContext.close' && command.params.context === 'P1'),
    'una ventana emergente no carga: se cierra y su dirección vuelve a la pestaña del agente');
    assert(later.q8 === 'network.failRequest' && decisions.at(-1).pageUrl === '' && decisions.at(-1).mainFrame === false,
      'una pestaña que abra el usuario en ese Firefox también pasa por la política');

    let exited = 0;
    link.onExit(() => { exited += 1; });
    link.close();
    assert(firefox.commands.at(-1).method === 'browser.close', 'al desconectar cierra el Firefox del perfil del agente');
    firefox.child.emit('exit', 0);
    assert(contents.isDestroyed() && exited === 1, 'si Firefox se cierra la pestaña se da por cerrada y se avisa al agente');

    const silent = fakeFirefox({ announce: false });
    let timeout = null;
    try { await launch('firefox', { profileRoot, engines, WebSocketImpl: silent.FakeSocket, spawn: () => silent.child, startMs: 30 }); }
    catch (error) { timeout = error; }
    assert(timeout && timeout.code === 'ENGINE_START' && silent.child.killed && silent.sockets.length === 0,
      'si Firefox no abre WebDriver BiDi a tiempo explica qué hacer y termina el proceso');
    const crashing = fakeFirefox({ announce: false });
    setImmediate(() => crashing.child.emit('exit', 0));
    let crashed = null;
    try { await launch('firefox', { profileRoot, engines, WebSocketImpl: crashing.FakeSocket, spawn: () => crashing.child }); }
    catch (error) { crashed = error; }
    assert(crashed && crashed.code === 'ENGINE_START' && /se cerró al arrancar/.test(crashed.message),
      'si Firefox se cierra al arrancar (perfil ya abierto) lo explica');
  } finally {
    fs.rmSync(profileRoot, { recursive: true, force: true });
  }
}

async function main() {
  detectTest();
  await transportTest();
  await launchTest();
  await sessionTest();
  await firefoxTest();
}

main().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
