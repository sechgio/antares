'use strict';

const { assert, finish } = require('./helpers/harness');
const { createCdpContents, allowed } = require('../electron/agent-browser-cdp');

const SESSION = 'S1';
const TARGET = 'T1';

function fakeTransport() {
  const sent = [];
  const listeners = new Set();
  const handlers = {
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'F1', url: 'about:blank' } } }),
    'Page.getNavigationHistory': () => ({ currentIndex: 0, entries: [{ id: 1, url: 'about:blank' }] }),
  };
  return {
    sent,
    handlers,
    send: async (method, params, sessionId) => {
      sent.push({ method, params, sessionId });
      const handler = handlers[method];
      return handler ? handler(params, sessionId) : {};
    },
    on: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    // Sin sessionId explícito el evento es de la pestaña; con undefined, de la sesión del navegador.
    emit: (method, params, ...rest) => {
      const sessionId = rest.length ? rest[0] : SESSION;
      for (const listener of [...listeners]) listener({ method, params, sessionId });
    },
    listeners,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function main() {
  const transport = fakeTransport();
  const image = { getSize: () => ({ width: 10, height: 5 }) };
  let decoded = null;
  const contents = await createCdpContents(transport,
    { targetId: TARGET, sessionId: SESSION, imageFromBuffer: (buffer) => { decoded = buffer.toString(); return image; } });

  assert(['Page.enable', 'Runtime.enable', 'Page.getFrameTree', 'Page.getNavigationHistory']
    .every((method) => transport.sent.some((item) => item.method === method && item.sessionId === SESSION)),
  'al crearse habilita Page y Runtime y lee el marco y el historial de su sesión');
  assert(contents.getURL() === 'about:blank' && !contents.isLoading() && !contents.isDestroyed() && contents.getZoomFactor() === 1,
    'expone dirección, carga, estado y zoom como WebContents');

  transport.handlers['Runtime.evaluate'] = (params) => (params.expression === 'boom'
    ? { exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x no existe' } } }
    : { result: { value: { ok: params.expression, gesture: params.userGesture, awaited: params.awaitPromise } } });
  const value = await contents.executeJavaScript('1 + 1', true);
  assert(value.ok === '1 + 1' && value.gesture === true && value.awaited === true,
    'executeJavaScript devuelve el valor, espera promesas y propaga el gesto del usuario');
  let thrown = null;
  try { await contents.executeJavaScript('boom'); } catch (error) { thrown = error.message; }
  assert(thrown === 'TypeError: x no existe', 'executeJavaScript rechaza con la excepción de la página');

  transport.handlers['Page.createIsolatedWorld'] = (params) => ({ executionContextId: params.worldName === 'antares-1001' ? 77 : 0 });
  await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: 'location.href' }], true);
  const isolated = transport.sent.filter((item) => item.method === 'Runtime.evaluate').at(-1);
  assert(isolated.params.contextId === 77 && isolated.params.expression === 'location.href'
    && transport.sent.some((item) => item.method === 'Page.createIsolatedWorld' && item.params.frameId === 'F1'),
  'executeJavaScriptInIsolatedWorld evalúa en un mundo aislado del marco principal');

  const events = [];
  for (const name of ['did-start-loading', 'did-stop-loading', 'dom-ready', 'did-navigate', 'did-navigate-in-page',
    'page-title-updated', 'console-message', 'destroyed']) {
    contents.on(name, (...args) => events.push([name, ...args]));
  }
  transport.handlers['Page.navigate'] = () => ({ frameId: 'F1', loaderId: 'L1' });
  let loaded = false;
  const loading = contents.loadURL('https://example.com/').then(() => { loaded = true; });
  await tick();
  transport.emit('Page.frameStartedLoading', { frameId: 'F1' });
  assert(contents.isLoading() && !loaded, 'loadURL no termina mientras la página carga');
  transport.handlers['Page.getNavigationHistory'] = () => ({ currentIndex: 1,
    entries: [{ id: 1, url: 'about:blank' }, { id: 2, url: 'https://example.com/' }] });
  transport.emit('Page.frameNavigated', { frame: { id: 'F1', url: 'https://example.com/' } });
  transport.emit('Page.domContentEventFired', {});
  transport.emit('Page.frameStartedLoading', { frameId: 'IFRAME' });
  transport.emit('Page.frameStoppedLoading', { frameId: 'IFRAME' });
  assert(contents.isLoading() && !loaded, 'los marcos internos no terminan la carga de la página');
  transport.emit('Page.frameStoppedLoading', { frameId: 'F1' });
  await loading;
  await tick();
  assert(loaded && !contents.isLoading() && contents.getURL() === 'https://example.com/',
    'loadURL termina cuando la página principal deja de cargar');
  assert(contents.navigationHistory.canGoBack() && !contents.navigationHistory.canGoForward(),
    'el historial se consulta de forma síncrona, como en WebContents');
  assert(['did-start-loading', 'did-navigate', 'dom-ready', 'did-stop-loading'].every((name) => events.some(([event]) => event === name)),
    'los eventos de CDP llegan con los nombres de WebContents');

  contents.navigationHistory.goBack();
  assert(transport.sent.at(-1).method === 'Page.navigateToHistoryEntry' && transport.sent.at(-1).params.entryId === 1,
    'goBack navega a la entrada anterior del historial');

  transport.handlers['Page.navigate'] = () => ({ frameId: 'F1', loaderId: 'L2', errorText: 'net::ERR_NAME_NOT_RESOLVED' });
  let failed = null;
  try { await contents.loadURL('https://no-existe.invalid/'); } catch (error) { failed = error.message; }
  assert(failed && failed.includes('ERR_NAME_NOT_RESOLVED'), 'loadURL rechaza con el error de red de Chromium');
  transport.handlers['Page.navigate'] = () => ({ frameId: 'F1' });
  await contents.loadURL('https://example.com/#seccion');
  assert(true, 'loadURL termina sin esperar carga cuando la navegación es en el mismo documento');

  transport.emit('Page.navigatedWithinDocument', { frameId: 'F1', url: 'https://example.com/#otra' });
  transport.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'fallo' }, { type: 'object', description: 'Object' }] });
  transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'number', value: 3 }] });
  transport.emit('Target.targetInfoChanged', { targetInfo: { targetId: TARGET, title: 'Ejemplo', url: 'https://example.com/#otra' } }, undefined);
  transport.emit('Target.targetInfoChanged', { targetInfo: { targetId: 'OTRA', title: 'Ajena', url: 'https://ajena.example/' } }, undefined);
  await tick();
  const consoles = events.filter(([name]) => name === 'console-message').map(([, message]) => message);
  assert(consoles[0].level === 'error' && consoles[0].message === 'fallo Object' && consoles[1].level === 'info' && consoles[1].message === '3',
    'la consola llega como console-message con nivel y texto');
  assert(contents.getTitle() === 'Ejemplo' && contents.getURL() === 'https://example.com/#otra'
    && events.some(([name, , title]) => name === 'page-title-updated' && title === 'Ejemplo'),
  'el título y la dirección siguen solo a su propia pestaña');

  transport.emit('Page.loadEventFired', {}, 'OTRA-SESION');
  const messages = [];
  contents.debugger.on('message', (_event, method, params) => messages.push([method, params]));
  transport.emit('Network.requestWillBeSent', { requestId: 'r1', request: { method: 'GET', url: 'https://example.com/api' } });
  transport.emit('Network.requestWillBeSent', { requestId: 'r2', request: { method: 'GET', url: 'https://ajena.example/' } }, 'OTRA-SESION');
  assert(messages.length === 1 && messages[0][1].requestId === 'r1', 'debugger.on(message) solo entrega eventos de su sesión');

  assert(!contents.debugger.isAttached(), 'el debugger empieza sin adjuntar, como en WebContents');
  contents.debugger.attach('1.3');
  assert(contents.debugger.isAttached(), 'attach marca la sesión como adjunta');
  await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 2 });
  assert(transport.sent.at(-1).method === 'Input.dispatchMouseEvent' && transport.sent.at(-1).sessionId === SESSION,
    'sendCommand reenvía las órdenes permitidas a su sesión');
  for (const method of ['Network.getAllCookies', 'Network.getCookies', 'Storage.getCookies', 'Target.attachToTarget',
    'Page.setDownloadBehavior', 'Browser.setDownloadBehavior', 'Runtime.callFunctionOn', 'Fetch.enable']) {
    const before = transport.sent.length;
    let error = null;
    try { await contents.debugger.sendCommand(method, {}); } catch (err) { error = err; }
    assert(error && error.code === 'CDP_FORBIDDEN' && transport.sent.length === before, `sendCommand rechaza ${method} sin enviarla`);
  }
  assert(['Input.insertText', 'DOM.setFileInputFiles', 'Page.captureScreenshot', 'Runtime.evaluate', 'Network.enable',
    'Emulation.setFocusEmulationEnabled'].every(allowed), 'las órdenes que usan las herramientas web_* están permitidas');

  transport.handlers['Page.captureScreenshot'] = () => ({ data: Buffer.from('png').toString('base64') });
  const shot = await contents.capturePage();
  assert(shot === image && decoded === 'png', 'capturePage decodifica la captura de CDP como imagen');

  contents.reload();
  assert(transport.sent.at(-1).method === 'Page.reload', 'reload recarga la pestaña');
  contents.close();
  assert(transport.sent.at(-1).method === 'Target.closeTarget' && transport.sent.at(-1).params.targetId === TARGET
    && transport.sent.at(-1).sessionId === undefined, 'close cierra solo su propia pestaña desde la sesión del navegador');

  transport.handlers['Page.navigate'] = () => ({ frameId: 'F1', loaderId: 'L3' });
  const pending = contents.loadURL('https://example.com/lenta');
  await tick();
  transport.emit('Target.targetDestroyed', { targetId: TARGET }, undefined);
  let closed = null;
  try { await pending; } catch (error) { closed = error.message; }
  assert(closed && contents.isDestroyed() && events.filter(([name]) => name === 'destroyed').length === 1,
    'al cerrarse la pestaña emite destroyed y rechaza las cargas pendientes');
  assert(transport.listeners.size === 0, 'al destruirse deja de escuchar el transporte');
}

main().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
