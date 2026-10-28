'use strict';

const { assert, finish, stubModule, stubPublicDns, installInertTimers } = require('./helpers/harness');
const { EventEmitter } = require('node:events');
stubPublicDns();
const { nativeToolSpecs } = require('../electron/agent-native-tools');
const { nativeMethods } = require('../shared/ipc-method-catalog');

const specs = nativeToolSpecs();
const names = new Set(specs.map((s) => s.name));
const autoimg = nativeMethods('autoimg');

assert(specs.filter((s) => s.module === 'autoimg').every((s) => autoimg.has(s.name)), 'toda herramienta AutoIMG existe en el catálogo native:autoimg');
assert(specs.every((s) => s.kind === 'native' && s.module && s.inputSchema.type === 'object'), 'specs completas');
assert(specs.some((s) => s.name === 'canvas_apply_layers' && s.module === 'canvas' && s.gated && s.inheritSchema),
  'Canvas aplica capas con aprobación, puente del editor y esquema heredado del backend');
for (const config of ['autoimg_oauth_config_save', 'autoimg_oauth_config_status', 'autoimg_sheets_auth_url',
  'autoimg_sheets_auth_revoke', 'autoimg_sheets_auth_cancel', 'autoimg_sheets_open', 'autoimg_auto_sync_toggle', 'autoimg_bootstrap']) {
  assert(!names.has(config), `${config} queda en la interfaz humana`);
}
for (const effect of ['autoimg_sheets_write_range', 'autoimg_sheets_append_row', 'autoimg_sync_to_sheet',
  'autoimg_sync_from_sheet', 'autoimg_scan_and_sync', 'autoimg_rename_export', 'autoimg_folders_remove']) {
  assert(specs.find((s) => s.name === effect).gated === true, `${effect} requiere aprobación`);
}
assert(specs.find((s) => s.name === 'autoimg_sheets_read_range').gated === false, 'leer un rango es automático');

const exportsSpecs = specs.filter((s) => s.name.endsWith('_export_pdf'));
assert(exportsSpecs.length === 5 && exportsSpecs.every((s) => !s.gated), 'las exportaciones a borrador no piden aprobación');
assert(JSON.stringify(exportsSpecs.slice(0, 3).map((s) => s.module)) === JSON.stringify(['technicalReports', 'informesV2', 'fichasTecnicas']),
  'cada exportación pertenece a su módulo');

const browser = require('../electron/agent-browser');
assert(browser.normalizeUrl('example.com/a') === 'https://example.com/a', 'un dominio sin esquema se abre por https');
assert(browser.normalizeUrl('http://example.com/a') === 'http://example.com/a', 'una URL http pública se conserva');
assert(browser.normalizeUrl('clima en Lima').startsWith('https://www.bing.com/search?q=clima%20en%20Lima'), 'un texto libre se busca');
for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'chrome://settings', 'http://localhost:5173', '']) {
  let threw = false;
  try { browser.normalizeUrl(bad); } catch { threw = true; }
  assert(threw, `el navegador del agente rechaza ${JSON.stringify(bad)}`);
}
{
  const placed = browser.clampBounds({ x: 600.4, y: 80, width: 900, height: 700 }, 1.25, { width: 1500, height: 900 });
  assert(placed.x === 751 && placed.y === 100 && placed.width === 749 && placed.height === 800,
    'el panel se escala con el zoom de la interfaz y se ajusta a la ventana');
  const negative = browser.clampBounds({ x: -10, y: -5, width: 50, height: 40 }, 1, { width: 800, height: 600 });
  assert(negative.x === 0 && negative.y === 0, 'el panel nunca se coloca fuera de la ventana');
  assert(browser.siteUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) antares-app/0.11.12 Chrome/152.0.7977.130 Electron/44.6.0 Safari/537.36')
    === 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36',
  'los sitios ven un Chrome normal, sin Electron ni el nombre de la app');
  assert(browser.state().open === false && browser.state().user_control === false, 'sin página abierta el estado está vacío');
  assert(browser.dock(null).docked === false && browser.dock({ x: 1, y: 2, width: 0, height: 5 }).docked === false,
    'un hueco vacío o sin tamaño no monta la página');
}

const { draftName } = require('../electron/agent-native-tools');
assert(draftName('informe') === 'informe.pdf' && draftName('a.PDF') === 'a.PDF', 'nombre de borrador con extensión .pdf');
for (const bad of ['', '..', 'sub/a.pdf', String.raw`C:\x\a.pdf`, 'a?.pdf']) {
  let threw = false;
  try { draftName(bad); } catch { threw = true; }
  assert(threw, `rechaza el nombre ${JSON.stringify(bad)}`);
}

async function exportTest() {
  {
    let localError = null;
    try { await browser.run('web_open', { url: 'agents.md' }); } catch (error) { localError = error; }
    assert(localError?.code === 'LOCAL_FILE' && /fs_read/.test(localError.message),
      'web_open remite un archivo local a fs_read');
  }
  {
    const isolatedCalls = [];
    const inputCommands = [];
    let attached = false;
    let attachments = 0;
    let pageTimeOrigin = 1;
    let navigationPhase = '';
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false, getURL: () => 'https://example.com', getTitle: () => 'Página',
      isLoading: () => false, getZoomFactor: () => 0.5, setZoomFactor: () => {},
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      setWindowOpenHandler: () => {}, loadURL: async () => {}, close: () => contents.emit('destroyed'),
      executeJavaScriptInIsolatedWorld: async (world, scripts) => {
        isolatedCalls.push({ world, scripts });
        return { url: 'https://example.com', time_origin: pageTimeOrigin };
      },
      executeJavaScript: async (script) => {
        if (script.includes('elementFromPoint')) {
          if (navigationPhase === 'locate') pageTimeOrigin += 1;
          return { x: 240, y: 120 };
        }
        if (navigationPhase === 'clear' && script.includes("'select' in el")) pageTimeOrigin += 1;
        if (script.includes('document.activeElement')) return false;
        if (script.includes('innerText') && !script.includes('querySelectorAll')) {
          return { url: 'https://example.com', title: 'Página', text: 'Uno. Dos. Tres. Cuatro. Cinco.' };
        }
        return { url: 'https://example.com', title: '', text: '', elements: [] };
      },
      sendInputEvent: () => { throw new Error('La ventana no tiene foco'); },
      debugger: Object.assign(new EventEmitter(), {
        isAttached: () => attached,
        attach: () => { attached = true; attachments += 1; },
        sendCommand: async (method, params) => {
          await Promise.resolve();
          if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') {
            const mouse = { type: 'mouseDown', x: params.x * contents.getZoomFactor(), y: params.y * contents.getZoomFactor(),
              button: params.button, clickCount: params.clickCount };
            if (navigationPhase === 'human-error') {
              contents.emit('before-mouse-event', {}, mouse);
              throw new Error('Fallo de transporte simulado');
            }
            if (navigationPhase === 'human-mouse-before') contents.emit('before-mouse-event', {}, mouse);
            contents.emit('before-mouse-event', {}, mouse);
            if (navigationPhase === 'human-mouse-after') contents.emit('before-mouse-event', {}, mouse);
          }
          inputCommands.push({ method, params });
          if ((navigationPhase === 'human-key' && params.type === 'keyDown')
            || (navigationPhase === 'human-focus' && method === 'Emulation.setFocusEmulationEnabled')) {
            contents.emit('before-input-event', {}, { type: 'keyDown' });
          }
          if (navigationPhase === 'human-wheel' && params.type === 'mouseMoved') contents.emit('input-event', {}, { type: 'mouseWheel' });
          if (navigationPhase === 'human-control' && params.type === 'mouseMoved') browser.setUserControl(true);
          if ((navigationPhase === 'focus' && method === 'Emulation.setFocusEmulationEnabled')
            || (navigationPhase === 'packet' && params.type === 'mouseMoved')
            || (navigationPhase === 'key' && params.type === 'keyDown')) pageTimeOrigin += 1;
        },
      }),
    });
    const moves = [];
    const makeParent = (name) => ({
      isDestroyed: () => false,
      contentView: {
        addChildView: (child) => moves.push([name, 'add', child]),
        removeChildView: (child) => moves.push([name, 'remove', child]),
      },
    });
    const main = { ...makeParent('main'), getContentSize: () => [1000, 700],
      webContents: { getZoomFactor: () => 1, send: () => {} } };
    let hostVisible = false;
    let hostOpacity = 1;
    let hostIgnoresMouse = false;
    const host = { ...makeParent('host'), on: () => {}, showInactive: () => { hostVisible = true; },
      setIgnoreMouseEvents: (value) => { hostIgnoresMouse = value; }, destroy: () => {} };
    const page = { webContents: contents, setBounds: () => {}, getBounds: () => ({ width: 400, height: 500 }) };
    stubModule('electron/window-manager.js', { getMainWindow: () => main });
    stubModule('electron', {
      BrowserWindow: function (options) { hostOpacity = options.opacity ?? 1; return host; },
      WebContentsView: function () { return page; },
      session: { fromPartition: () => ({ setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {}, on: () => {},
        webRequest: { onBeforeRequest: () => {} },
        getUserAgent: () => 'Mozilla/5.0 Chrome/1 Electron/1', setUserAgent: () => {} }) },
    });
    const bounds = { x: 100, y: 50, width: 400, height: 500 };
    browser.dock(bounds);
    const timers = installInertTimers();
    try { await browser.navigate('open', 'https://example.com'); } finally { timers.restore(); }
    const pageContext = await browser.approvalContext();
    assert(pageContext.page_url === 'https://example.com' && pageContext.page_time_origin === 1,
      'el navegador obtiene la identidad del documento para el contexto de aprobación');
    assert(isolatedCalls.length === 1 && isolatedCalls[0].world !== 0 && isolatedCalls[0].world !== 999,
      'la identidad se consulta en un mundo aislado de los scripts de la página y del preload');
    moves.length = 0;
    browser.dock(null);
    assert(moves[0]?.[0] === 'main' && moves[0]?.[1] === 'remove' && moves[0]?.[2] === page
      && moves[1]?.[0] === 'host' && moves[1]?.[1] === 'add',
    'al salir del panel retira la vista nativa de la ventana principal antes de alojarla fuera de pantalla');
    assert(browser.state().open && !browser.state().docked, 'ocultar el navegador conserva la página abierta');
    assert(!hostVisible || hostOpacity === 0, 'fuera de Agent la ventana auxiliar no muestra el navegador');
    assert(hostIgnoresMouse, 'la ventana auxiliar no intercepta clics de otras pestañas');
    moves.length = 0;
    browser.dock(bounds);
    assert(moves[0]?.[0] === 'host' && moves[0]?.[1] === 'remove' && moves[1]?.[0] === 'main'
      && moves[1]?.[1] === 'add' && moves[1]?.[2] === page,
    'volver al panel retira la misma vista de la anfitriona antes de mostrarla en Agent');
    const inputTimers = installInertTimers();
    let inputError = null;
    try {
      await browser.run('web_click', { ref: '1' });
      await browser.run('web_type', { ref: '1', text: 'Prueba á', submit: true });
      await browser.run('web_key', { keys: 'ctrl+a shift+a space left ctrl+-' });
    } catch (error) { inputError = error.message; } finally { inputTimers.restore(); }
    assert(inputError === null, `las acciones del navegador no requieren foco nativo: ${inputError}`);
    assert(attachments === 1, 'el transporte de entrada reutiliza la conexión al navegador');
    assert(inputCommands[0]?.method === 'Emulation.setFocusEmulationEnabled' && inputCommands[0]?.params.enabled === true,
      'el navegador emula el foco de su página sin enfocar la ventana de Windows');
    const mouse = inputCommands.filter((command) => command.method === 'Input.dispatchMouseEvent');
    assert(mouse.length === 6 && mouse.slice(0, 3).map((command) => command.params.type).join()
      === 'mouseMoved,mousePressed,mouseReleased' && mouse.every((command) => command.params.x === 240 && command.params.y === 120),
    'el clic envía movimiento, pulsación y liberación en coordenadas CSS sin aplicar el zoom dos veces');
    assert(inputCommands.some((command) => command.method === 'Input.insertText' && command.params.text === 'Prueba á'),
      'el texto Unicode se inserta en la página sin usar el teclado global');
    const keyDown = inputCommands.filter((command) => command.method === 'Input.dispatchKeyEvent' && command.params.type === 'keyDown');
    assert(keyDown.length === 6 && keyDown[0].params.key === 'Enter' && keyDown[0].params.text === '\r'
      && keyDown[1].params.modifiers === 2 && !keyDown[1].params.text
      && keyDown[2].params.modifiers === 8 && keyDown[2].params.text === 'A'
      && keyDown[3].params.text === ' ' && keyDown[4].params.key === 'ArrowLeft'
      && keyDown[5].params.modifiers === 2 && keyDown[5].params.windowsVirtualKeyCode === 189,
    'las teclas conservan envío, atajos, mayúsculas, espacio y navegación');
    assert(inputCommands.filter((command) => command.method === 'Input.dispatchKeyEvent' && command.params.type === 'keyUp').length === 6,
      'cada tecla se libera después de enviarla');
    for (const [name, params, phase, sent] of [
      ['web_click', { ref: '1' }, 'locate', 0], ['web_click', { ref: '1' }, 'focus', 0],
      ['web_click', { ref: '1' }, 'packet', 1], ['web_type', { ref: '1', text: 'no enviar', clear: true }, 'clear', 3],
      ['web_key', { keys: 'enter ctrl+a' }, 'key', 1],
    ]) {
      pageTimeOrigin = 1;
      navigationPhase = phase;
      attached = phase !== 'focus';
      inputCommands.length = 0;
      const approvedContext = await browser.approvalContext();
      let changed;
      const raceTimers = installInertTimers();
      try { await browser.run(name, params, { approvedContext }); } catch (error) { changed = error; }
      finally { raceTimers.restore(); }
      assert(changed && /página cambió/.test(changed.message)
        && inputCommands.filter((command) => command.method.startsWith('Input.')).length === sent,
      `${phase}: navegar durante la interacción impide enviar entrada al documento nuevo`);
      assert(!!changed?.uncertain === (sent > 0), `${phase}: solo la entrada ya enviada produce incertidumbre`);
    }
    const realNow = Date.now;
    let now = realNow() - 100_000;
    Date.now = () => now;
    try {
      for (const [phase, name, sent] of [
        ['human-key', 'web_key', 1], ['human-focus', 'web_click', 0], ['human-wheel', 'web_click', 1],
        ['human-mouse-before', 'web_click', 2], ['human-mouse-after', 'web_click', 2], ['human-control', 'web_click', 1],
        ['human-error', 'web_click', 1],
      ]) {
        now += 6_000;
        navigationPhase = phase;
        attached = phase !== 'human-focus';
        inputCommands.length = 0;
        let interrupted;
        const timers = installInertTimers();
        try { await browser.run(name, name === 'web_key' ? { keys: 'enter ctrl+a' } : { ref: '1' }); }
        catch (error) { interrupted = error; }
        finally { timers.restore(); browser.setUserControl(false); }
        assert(interrupted?.message === (phase === 'human-control' ? browser.USER_CONTROL_ERROR
          : phase === 'human-error' ? 'Fallo de transporte simulado' : browser.USER_BUSY_ERROR)
          && inputCommands.filter((command) => command.method.startsWith('Input.')).length === sent,
        `${phase}: una entrada humana durante la espera detiene los siguientes paquetes`);
        assert(!!interrupted?.uncertain === (sent > 0), `${phase}: interrumpir después de enviar conserva la incertidumbre`);
        if (phase === 'human-error') {
          let paused;
          try { await browser.run('web_key', { keys: 'enter' }); } catch (error) { paused = error; }
          assert(paused?.message === browser.USER_BUSY_ERROR, 'fallar sin el eco CDP no pierde el clic humano consumido por la correlación');
        }
      }
      navigationPhase = '';
      now += 6_000;
      const timers = installInertTimers();
      let resumed;
      try { resumed = await browser.run('web_click', { ref: '1' }); }
      finally { timers.restore(); }
      assert(resumed?.clicked === '1', 'el clic propio no prolonga la pausa humana y el agente puede retomar tras la inactividad');
    } finally { Date.now = realNow; }
    contents.emit('console-message', { level: 'warning', message: 'casi sin saldo' });
    contents.emit('console-message', { level: 'error', message: 'falló la carga' });
    const consoleView = await browser.run('web_console', {});
    assert(JSON.stringify(consoleView.messages) === JSON.stringify(['[warning] casi sin saldo', '[error] falló la carga']),
      'web_console devuelve los mensajes recientes de la consola');
    contents.debugger.emit('message', {}, 'Network.requestWillBeSent',
      { requestId: '1', type: 'XHR', request: { method: 'GET', url: 'https://api.example.com/v1/datos' } });
    contents.debugger.emit('message', {}, 'Network.responseReceived',
      { requestId: '1', type: 'XHR', response: { url: 'https://api.example.com/v1/datos', status: 200 } });
    contents.debugger.emit('message', {}, 'Network.requestWillBeSent',
      { requestId: '2', type: 'Fetch', request: { method: 'POST', url: 'https://api.example.com/v1/enviar' } });
    contents.debugger.emit('message', {}, 'Network.loadingFailed', { requestId: '2', errorText: 'net::ERR_TIMED_OUT' });
    const networkView = await browser.run('web_network', {});
    assert(JSON.stringify(networkView.requests) === JSON.stringify([
      '200 GET XHR https://api.example.com/v1/datos',
      '· POST Fetch https://api.example.com/v1/enviar (falló: net::ERR_TIMED_OUT)',
    ]), 'web_network enumera las peticiones con estado, método y fallos');
    const textView = await browser.run('web_text', {});
    assert(textView.text === 'Uno. Dos. Tres. Cuatro. Cinco.' && textView.text_total === 30 && !textView.next_offset,
      'web_text devuelve el texto completo de la página');
    const paged = await browser.run('web_text', { offset: 5 });
    assert(paged.text === 'Dos. Tres. Cuatro. Cinco.' && paged.text_offset === 5 && paged.text_total === 30,
      'web_text pagina el texto por offset');
    for (let i = 0; i < 205; i += 1) contents.emit('console-message', { level: 'info', message: `m${i}` });
    const consoleCapped = await browser.run('web_console', {});
    assert(consoleCapped.messages.length === 200 && consoleCapped.messages[199] === '[info] m204',
      'la consola del navegador conserva solo los mensajes recientes');
    for (let i = 0; i < 305; i += 1) {
      contents.debugger.emit('message', {}, 'Network.requestWillBeSent', { requestId: String(i), request: { method: 'GET', url: `u${i}` } });
    }
    const networkCapped = await browser.run('web_network', {});
    assert(networkCapped.requests.length === 300 && networkCapped.requests[299] === '· GET u304',
      'el registro de red conserva solo las peticiones recientes');
    const { mkdtempSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const policyRoot = mkdtempSync(join(tmpdir(), 'antares-agent-policy-'));
    const realLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = policyRoot;
    let openBlocked = null;
    try { await browser.run('web_open', { url: 'bcp.pe/panel' }); } catch (error) { openBlocked = error.message; }
    assert(openBlocked && openBlocked.includes('Dominio bloqueado'),
      'web_open rechaza los dominios de la política del navegador, con o sin esquema');
    const userTimers = installInertTimers();
    let userOpenError = null;
    try { await browser.navigate('open', 'https://www.bcp.pe/panel'); } catch (error) { userOpenError = error; } finally { userTimers.restore(); }
    assert(!userOpenError, 'la navegación manual del usuario no pasa por la política del agente');
    const openTimers = installInertTimers();
    try { await browser.run('web_open', { url: 'https://example.com' }); } finally { openTimers.restore(); }
    process.env.LOCALAPPDATA = realLocalAppData;
    rmSync(policyRoot, { recursive: true, force: true });
    browser.close();
  }
  browser.setUserControl(true);
  let blocked = null;
  try { await browser.run('web_read', {}); } catch (err) { blocked = err.message; }
  assert(blocked === browser.USER_CONTROL_ERROR, 'con el control en manos del usuario el agente no usa el navegador');
  browser.setUserControl(false);
  {
    const { EventEmitter: Emitter } = require('node:events');
    const parent = { isDestroyed: () => false, on: () => {}, showInactive: () => {}, setIgnoreMouseEvents: () => {}, destroy: () => {},
      contentView: { addChildView: () => {}, removeChildView: () => {} } };
    const contents = Object.assign(new Emitter(), {
      isDestroyed: () => false, getURL: () => 'https://example.com', getTitle: () => '', isLoading: () => false,
      getZoomFactor: () => 1, setZoomFactor: () => {}, setWindowOpenHandler: () => {}, loadURL: async () => {},
      navigationHistory: { canGoBack: () => false, canGoForward: () => false }, close: () => contents.emit('destroyed'),
      debugger: Object.assign(new Emitter(), { isAttached: () => false, attach: () => {}, sendCommand: async () => {} }),
    });
    stubModule('electron/window-manager.js', { getMainWindow: () => null });
    stubModule('electron', {
      BrowserWindow: function () { return parent; },
      WebContentsView: function () { return { webContents: contents, setBounds: () => {}, getBounds: () => ({ width: 1280 }) }; },
      session: { fromPartition: () => ({ setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {}, on: () => {},
        webRequest: { onBeforeRequest: () => {} },
        getUserAgent: () => 'Mozilla/5.0 Chrome/1 Electron/1', setUserAgent: () => {} }) },
    });
    const timers = installInertTimers();
    try { await browser.navigate('open', 'https://example.com'); } finally { timers.restore(); }
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    assert(browser.state().busy_until > Date.now(), 'el estado expone cuándo termina la espera humana');
    let blocked = null;
    try { await browser.run('web_key', { keys: 'enter' }); } catch (err) { blocked = err; }
    assert(blocked && blocked.code === 'USER_BUSY' && blocked.retryable === true && blocked.retryAfterMs > 0,
      'una acción no navegable devuelve un error retryable con la espera restante');
    browser.resetUserActivity();
    assert(browser.state().busy_until === 0, 'enviar una instrucción reinicia la espera humana');
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    const attempt = async () => { try { await browser.run('web_back', {}); return null; } catch (err) { return err.message; } };
    browser.allowAgent();
    assert(browser.state().busy_until === 0, 'permitir al agente limpia la espera');
    assert(await attempt() === 'No hay una página anterior', 'permitir al agente deja navegar de inmediato');
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    const now = Date.now;
    Date.now = () => now() + 6_000;
    try {
      assert(await attempt() === 'No hay una página anterior', 'pasado el tiempo de gracia, la navegación se reanuda');
    } finally { Date.now = now; }
    browser.close();
  }
}

exportTest().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
