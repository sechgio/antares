'use strict';

const { EventEmitter } = require('node:events');
const { assert, finish } = require('./helpers/harness');
const { createBidiContents, bidiTransport, wrap, keyValue } = require('../electron/agent-browser-bidi');

const CONTEXT = 'C1';
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeTransport() {
  const sent = [];
  const listeners = new Set();
  const handlers = {};
  return {
    sent,
    handlers,
    listeners,
    send: async (method, params) => {
      sent.push({ method, params });
      return handlers[method] ? handlers[method](params) : {};
    },
    on: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    emit: (method, params) => { for (const listener of [...listeners]) listener({ method, params }); },
  };
}

async function transportTest() {
  const socket = Object.assign(new EventEmitter(), { sent: [], send(text) { socket.sent.push(JSON.parse(text)); } });
  socket.addEventListener = (name, listener) => socket.on(name, listener);
  const transport = bidiTransport(socket);
  const events = [];
  transport.on((message) => events.push(message));
  const ok = transport.send('session.new', { capabilities: {} });
  const bad = transport.send('browsingContext.navigate', { context: 'X', url: 'https://a.example' });
  assert(socket.sent[0].id === 1 && socket.sent[0].method === 'session.new' && socket.sent[1].params.url === 'https://a.example',
    'cada orden sale con su id, método y parámetros');
  socket.emit('message', { data: JSON.stringify({ type: 'event', method: 'log.entryAdded', params: { text: 'hola' } }) });
  socket.emit('message', { data: JSON.stringify({ type: 'success', id: 1, result: { sessionId: 'abc' } }) });
  socket.emit('message', { data: JSON.stringify({ type: 'error', id: 2, error: 'unknown error', message: 'Address not found' }) });
  socket.emit('message', { data: 'no es json' });
  assert((await ok).sessionId === 'abc', 'resuelve la respuesta de su orden');
  let rejected = null;
  try { await bad; } catch (error) { rejected = error; }
  assert(rejected && rejected.code === 'BIDI_ERROR' && rejected.message === 'unknown error: Address not found',
    'rechaza con el error y el mensaje de Firefox');
  assert(events.length === 1 && events[0].method === 'log.entryAdded' && events[0].params.text === 'hola', 'entrega los eventos a los oyentes');
  transport.close(new Error('cerrado'));
  let closed = null;
  try { await transport.send('session.end'); } catch (error) { closed = error.message; }
  assert(closed === 'cerrado', 'tras cerrarse rechaza las órdenes nuevas');
}

async function contentsTest() {
  const transport = fakeTransport();
  let decoded = null;
  const image = { getSize: () => ({ width: 4, height: 3 }) };
  const contents = await createBidiContents(transport, { context: CONTEXT, imageFromBuffer: (buffer) => { decoded = buffer.toString(); return image; } });
  assert(contents.getURL() === 'about:blank' && !contents.isLoading() && contents.getZoomFactor() === 1 && !contents.isDestroyed(),
    'empieza en about:blank con la forma de WebContents');

  assert(wrap('(() => 1)();').startsWith('(async () => JSON.stringify(await ((() => 1)()'), 'envuelve la expresión para devolverla como JSON');
  transport.handlers['script.evaluate'] = (params) => {
    if (params.expression.includes('boom')) return { type: 'exception', exceptionDetails: { text: 'TypeError: boom no existe' } };
    if (params.expression.includes('nada')) return { type: 'success', result: { type: 'undefined' } };
    if (params.expression.includes('document.title')) return { type: 'success', result: { type: 'string', value: JSON.stringify('Ejemplo') } };
    return { type: 'success', result: { type: 'string', value: JSON.stringify({ ok: true, sandbox: params.target.sandbox || null,
      gesture: params.userActivation, ownership: params.resultOwnership }) } };
  };
  const value = await contents.executeJavaScript('(() => ({ ok: true }))()', true);
  assert(value.ok === true && value.sandbox === null && value.gesture === true && value.ownership === 'none',
    'executeJavaScript evalúa en la pestaña, con gesto del usuario, y devuelve el valor como JSON');
  assert(await contents.executeJavaScript('nada') === undefined, 'un resultado sin valor llega como undefined');
  let thrown = null;
  try { await contents.executeJavaScript('boom'); } catch (error) { thrown = error.message; }
  assert(thrown === 'TypeError: boom no existe', 'executeJavaScript rechaza con la excepción de la página');
  const isolated = await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: '({ url: location.href })' }]);
  assert(isolated.sandbox === 'antares-1001', 'el mundo aislado es un sandbox propio de Firefox');

  const events = [];
  for (const name of ['did-start-loading', 'did-stop-loading', 'dom-ready', 'did-navigate', 'did-navigate-in-page',
    'page-title-updated', 'console-message', 'destroyed']) {
    contents.on(name, (...args) => events.push([name, ...args]));
  }
  let loaded = false;
  const loading = contents.loadURL('https://ejemplo.com/').then(() => { loaded = true; });
  await tick();
  const navigate = transport.sent.find((item) => item.method === 'browsingContext.navigate');
  assert(navigate.params.context === CONTEXT && navigate.params.url === 'https://ejemplo.com/' && navigate.params.wait === 'none',
    'loadURL navega su propia pestaña');
  transport.emit('browsingContext.navigationStarted', { context: CONTEXT, url: 'https://ejemplo.com/' });
  transport.emit('browsingContext.contextCreated', { context: 'F1', parent: CONTEXT, url: 'about:blank' });
  transport.emit('browsingContext.navigationStarted', { context: 'F1', url: 'https://marco.example/' });
  transport.emit('browsingContext.load', { context: 'F1', url: 'https://marco.example/' });
  assert(contents.isLoading() && !loaded, 'un iframe que termina no da por cargada la pestaña');
  transport.emit('browsingContext.domContentLoaded', { context: CONTEXT, url: 'https://ejemplo.com/' });
  transport.emit('browsingContext.load', { context: CONTEXT, url: 'https://ejemplo.com/' });
  await loading;
  await tick(); await tick();
  assert(loaded && !contents.isLoading() && contents.getURL() === 'https://ejemplo.com/' && contents.getTitle() === 'Ejemplo',
    'loadURL termina con la carga y el título se lee de la página');
  assert(['did-start-loading', 'dom-ready', 'did-navigate', 'did-stop-loading', 'page-title-updated']
    .every((name) => events.some(([event]) => event === name)), 'los eventos de BiDi llegan con los nombres de WebContents');
  assert(contents.navigationHistory.canGoBack() && !contents.navigationHistory.canGoForward(), 'el historial registra la navegación');

  transport.emit('browsingContext.fragmentNavigated', { context: CONTEXT, url: 'https://ejemplo.com/#a' });
  assert(contents.getURL() === 'https://ejemplo.com/#a' && events.some(([name]) => name === 'did-navigate-in-page'),
    'la navegación por ancla actualiza la dirección');
  contents.navigationHistory.goBack();
  await tick();
  assert(transport.sent.at(-1).method === 'browsingContext.traverseHistory' && transport.sent.at(-1).params.delta === -1
    && contents.navigationHistory.canGoForward(), 'atrás recorre el historial de Firefox');
  transport.emit('browsingContext.domContentLoaded', { context: CONTEXT, url: 'https://ejemplo.com/' });
  assert(contents.navigationHistory.canGoForward() && contents.navigationHistory.canGoBack(),
    'la carga que provoca atrás no borra la página siguiente');

  transport.emit('log.entryAdded', { level: 'error', text: 'fallo', source: { context: CONTEXT } });
  transport.emit('log.entryAdded', { level: 'warn', text: 'aviso', source: { context: 'F1' } });
  transport.emit('log.entryAdded', { level: 'error', text: 'ajeno', source: { context: 'OTRA' } });
  const consoles = events.filter(([name]) => name === 'console-message').map(([, message]) => message);
  assert(consoles.length === 2 && consoles[0].level === 'error' && consoles[1].level === 'warning' && consoles[1].message === 'aviso',
    'la consola de la pestaña y de sus iframes llega como console-message; la de otras pestañas no');

  const messages = [];
  contents.debugger.on('message', (_event, method, params) => messages.push([method, params]));
  transport.emit('network.beforeRequestSent', { context: CONTEXT, navigation: 'n1', request: { request: 'r1', method: 'GET', url: 'https://ejemplo.com/' } });
  transport.emit('network.responseCompleted', { context: CONTEXT, request: { request: 'r1', url: 'https://ejemplo.com/' }, response: { status: 500 } });
  transport.emit('network.fetchError', { context: 'F1', request: { request: 'r2' }, errorText: 'NS_ERROR_CONNECTION_REFUSED' });
  transport.emit('network.beforeRequestSent', { context: 'OTRA', request: { request: 'r3', method: 'GET', url: 'https://ajena.example/' } });
  assert(messages.length === 3 && messages[0][0] === 'Network.requestWillBeSent' && messages[0][1].requestId === 'r1'
    && messages[1][0] === 'Network.responseReceived' && messages[1][1].response.status === 500
    && messages[2][0] === 'Network.loadingFailed' && messages[2][1].errorText === 'NS_ERROR_CONNECTION_REFUSED',
  'la red de la pestaña llega con forma CDP para web_network');

  contents.debugger.attach('1.3');
  assert(contents.debugger.isAttached() && (await contents.debugger.sendCommand('Page.enable')) !== null, 'las órdenes de preparación no fallan');
  const before = transport.sent.length;
  await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10.4, y: 20.6, button: 'left' });
  await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 21, button: 'left', clickCount: 1 });
  await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 10, y: 21, button: 'left', clickCount: 1 });
  const pointer = transport.sent.slice(before).map((item) => item.params.actions[0]);
  assert(pointer.every((source) => source.type === 'pointer' && source.parameters.pointerType === 'mouse')
    && pointer[0].actions[0].type === 'pointerMove' && pointer[0].actions[0].x === 10 && pointer[0].actions[0].y === 21
    && pointer[1].actions[1].type === 'pointerDown' && pointer[1].actions[1].button === 0 && pointer[2].actions[1].type === 'pointerUp',
  'el ratón se traduce a acciones de puntero de WebDriver');

  const keysAt = transport.sent.length;
  await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2 });
  await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2 });
  await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', modifiers: 0, text: '\r' });
  const keyActions = transport.sent.slice(keysAt).map((item) => item.params.actions[0].actions);
  assert(keyActions[0].map((action) => `${action.type}:${action.value}`).join() === 'keyDown:\uE009,keyDown:a'
    && keyActions[1].map((action) => `${action.type}:${action.value}`).join() === 'keyUp:a,keyUp:\uE009'
    && keyActions[2][0].value === '\uE007', 'las teclas y sus modificadores se traducen a teclas de WebDriver');
  assert(keyValue('ArrowLeft') === '\uE012' && keyValue('Space') === ' ' && keyValue('ñ') === 'ñ', 'conoce las teclas especiales');
  await contents.debugger.sendCommand('Input.insertText', { text: 'ñ😀' });
  const typed = transport.sent.at(-1).params.actions[0].actions;
  assert(typed.map((action) => action.value).join('|') === 'ñ|ñ|😀|😀', 'el texto se escribe por caracteres completos, emojis incluidos');

  transport.handlers['browsingContext.captureScreenshot'] = (params) => ({ data: Buffer.from(`${params.origin}:${params.format.type}`).toString('base64') });
  const full = await contents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: true });
  const fullCall = transport.sent.at(-1).params;
  assert(Buffer.from(full.data, 'base64').toString() === 'document:image/jpeg' && fullCall.format.quality === 0.7,
    'la captura de página completa usa el documento entero y la calidad pedida');
  await contents.capturePage();
  assert(decoded === 'viewport:image/png', 'capturePage captura lo visible en PNG');

  transport.handlers['script.evaluate'] = (params) => (params.expression.includes('ref=\\"9\\"')
    ? { type: 'success', result: { type: 'node', sharedId: 'nodo-9' } } : { type: 'success', result: { type: 'null' } });
  const doc = await contents.debugger.sendCommand('DOM.getDocument', {});
  const node = await contents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-antares-ref="9"]' });
  const none = await contents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-antares-ref="8"]' });
  await contents.debugger.sendCommand('DOM.setFileInputFiles', { files: ['C:\\datos\\informe.pdf'], nodeId: node.nodeId });
  const setFiles = transport.sent.at(-1);
  assert(node.nodeId > 0 && none.nodeId === 0 && setFiles.method === 'input.setFiles'
    && setFiles.params.element.sharedId === 'nodo-9' && setFiles.params.files[0] === 'C:\\datos\\informe.pdf',
  'subir un archivo localiza el campo y usa input.setFiles');

  for (const method of ['Network.getAllCookies', 'Storage.getCookies', 'Target.attachToTarget', 'Browser.close']) {
    let error = null;
    try { await contents.debugger.sendCommand(method, {}); } catch (err) { error = err.code; }
    assert(error === 'CDP_FORBIDDEN', `rechaza ${method} como el adaptador CDP`);
  }
  let unsupported = null;
  try { await contents.debugger.sendCommand('Page.navigate', { url: 'https://x.example' }); } catch (error) { unsupported = error.code; }
  assert(unsupported === 'BIDI_UNSUPPORTED', 'una orden permitida sin traducción falla en vez de fingir que funcionó');

  transport.handlers['browsingContext.navigate'] = () => { throw new Error('unknown error: Address not found'); };
  let failed = null;
  try { await contents.loadURL('https://no-existe.invalid/'); } catch (error) { failed = error.message; }
  assert(failed && failed.includes('Address not found'), 'loadURL rechaza si Firefox no puede navegar');

  contents.reload();
  contents.close();
  assert(transport.sent.at(-2).method === 'browsingContext.reload' && transport.sent.at(-1).method === 'browsingContext.close'
    && transport.sent.at(-1).params.context === CONTEXT, 'recarga y cierra solo su pestaña');
  transport.handlers['browsingContext.navigate'] = () => ({});
  const pending = contents.loadURL('https://lenta.example/');
  await tick();
  transport.emit('browsingContext.contextDestroyed', { context: 'F1' });
  assert(!contents.isDestroyed(), 'cerrar un iframe no cierra la pestaña');
  transport.emit('browsingContext.contextDestroyed', { context: CONTEXT });
  let closed = null;
  try { await pending; } catch (error) { closed = error.message; }
  assert(closed && contents.isDestroyed() && transport.listeners.size === 0 && events.filter(([name]) => name === 'destroyed').length === 1,
    'al cerrarse la pestaña emite destroyed, rechaza lo pendiente y deja de escuchar');
}

async function main() {
  await transportTest();
  await contentsTest();
}

main().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
