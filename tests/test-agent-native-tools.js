'use strict';

const { assert, finish, stubModule, installInertTimers } = require('./helpers/harness');
const { EventEmitter } = require('node:events');
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

const web = specs.filter((s) => s.name.startsWith('web_'));
assert(web.length === 16 && web.every((s) => s.module === 'computer'), 'las herramientas del navegador pertenecen al módulo Equipo');
assert(web.filter((s) => s.gated).map((s) => s.name).sort().join() === 'web_click,web_download,web_key,web_type,web_upload',
  'leer y navegar es automático; clic, escribir, teclas, descargar y subir requieren aprobación');
assert(web.filter((s) => !s.gated).map((s) => s.name).sort().join()
  === 'web_back,web_console,web_forward,web_handover,web_network,web_open,web_read,web_reload,web_screenshot,web_tab,web_text',
  'texto, consola, red, captura, pestañas y navegación se usan sin aprobación');
const browser = require('../electron/agent-browser');
assert(browser.normalizeUrl('example.com/a') === 'https://example.com/a', 'un dominio sin esquema se abre por https');
assert(browser.normalizeUrl('http://localhost:5173') === 'http://localhost:5173', 'una URL http se conserva');
assert(browser.normalizeUrl('clima en Lima').startsWith('https://duckduckgo.com/html/?q=clima%20en%20Lima'), 'un texto libre se busca');
for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'chrome://settings', '']) {
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
    const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const { EventEmitter: Emitter } = require('node:events');
    const commands = [];
    let uploadField = { tag: 'input', type: 'file' };
    let canGoForward = false;
    let forwards = 0;
    let reloads = 0;
    const parent = { isDestroyed: () => false, on: () => {}, showInactive: () => {}, setIgnoreMouseEvents: () => {}, destroy: () => {},
      contentView: { addChildView: () => {}, removeChildView: () => {} } };
    const contents = Object.assign(new Emitter(), {
      isDestroyed: () => false, getURL: () => 'https://files.example.com', getTitle: () => 'Archivos', isLoading: () => false,
      getZoomFactor: () => 1, setZoomFactor: () => {}, setWindowOpenHandler: () => {}, loadURL: async () => {},
      reload: () => { reloads += 1; },
      navigationHistory: { canGoBack: () => false, canGoForward: () => canGoForward,
        goForward: () => { forwards += 1; } },
      close: () => contents.emit('destroyed'),
      executeJavaScript: async (script) => {
        if (script.includes('tagName') && script.includes('scrollIntoView')) return uploadField;
        return { url: 'https://files.example.com', title: 'Archivos', text: 'Contenido', elements: [] };
      },
      executeJavaScriptInIsolatedWorld: async () => ({ url: 'https://files.example.com', time_origin: 3 }),
      capturePage: async () => ({ getSize: () => ({ width: 1280, height: 800 }), toJPEG: () => Buffer.from('jpeg-viewport') }),
      debugger: Object.assign(new Emitter(), {
        isAttached: () => false, attach: () => {},
        sendCommand: async (method, params) => {
          commands.push([method, params]);
          if (method === 'Page.captureScreenshot') return { data: Buffer.from('jpeg-completa').toString('base64') };
          if (method === 'DOM.getDocument') return { root: { nodeId: 7 } };
          if (method === 'DOM.querySelector') return { nodeId: params.selector.includes('"9"') ? 21 : 0 };
          return {};
        },
      }),
    });
    let downloadHandler = null;
    const downloads = [];
    stubModule('electron/window-manager.js', { getMainWindow: () => null });
    stubModule('electron', {
      BrowserWindow: function () { return parent; },
      WebContentsView: function () { return { webContents: contents, setBounds: () => {}, getBounds: () => ({ width: 1280 }) }; },
      nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 2000, height: 4000 }),
        resize: () => ({ getSize: () => ({ width: 1280, height: 2560 }), toJPEG: () => Buffer.from('jpeg-1280') }),
        toJPEG: () => Buffer.from('jpeg-full') }) },
      session: { fromPartition: () => ({
        setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {},
        getUserAgent: () => 'Mozilla/5.0 Chrome/1 Electron/1', setUserAgent: () => {},
        on: (event, handler) => { if (event === 'will-download') downloadHandler = handler; },
        downloadURL: (url) => { downloads.push(url); },
      }) },
    });
    const timers = installInertTimers();
    try {
      await browser.navigate('open', 'https://files.example.com');
      assert(downloadHandler, 'la sesión del navegador registra el interceptor de descargas');
      let forwardError = null;
      try { await browser.run('web_forward', {}); } catch (error) { forwardError = error.message; }
      assert(forwardError === 'No hay una página siguiente', 'web_forward avisa cuando no hay página siguiente');
      canGoForward = true;
      const forward = await browser.run('web_forward', {});
      assert(forwards === 1 && forward.url === 'https://files.example.com' && forward.text === 'Contenido',
        'web_forward avanza y devuelve la página nueva');
      const reload = await browser.run('web_reload', {});
      assert(reloads === 1 && reload.url === 'https://files.example.com', 'web_reload recarga la página actual');
      const handover = await browser.run('web_handover', {});
      assert(handover.handed_over === true && handover.user_control === true, 'web_handover cede el control con un resultado estructurado');
      let blocked = null;
      try { await browser.run('web_read', {}); } catch (error) { blocked = error.message; }
      assert(blocked === browser.USER_CONTROL_ERROR, 'tras ceder el control el agente no puede actuar');
      browser.setUserControl(false);
      const shotDir = mkdtempSync(join(tmpdir(), 'antares-agent-shot-'));
      try {
        const viewport = await browser.run('web_screenshot', {}, { dir: shotDir });
        assert(readFileSync(viewport.image.path, 'utf8') === 'jpeg-viewport', 'la captura del viewport sigue usando capturePage');
        const full = await browser.run('web_screenshot', { full_page: true }, { dir: shotDir });
        assert(full.width === 1280 && full.height === 2560 && readFileSync(full.image.path, 'utf8') === 'jpeg-1280',
          'web_screenshot full_page captura la página completa vía CDP');
        assert(commands.some(([method, params]) => method === 'Page.captureScreenshot' && params.captureBeyondViewport === true),
          'la captura completa usa captureBeyondViewport');
      } finally { rmSync(shotDir, { recursive: true, force: true }); }
      const downloadRoot = mkdtempSync(join(tmpdir(), 'antares-agent-download-'));
      try {
        let policyError = null;
        try { await browser.run('web_download', { url: 'https://bcp.pe/tarifas.pdf' }, { drafts: downloadRoot }); }
        catch (error) { policyError = error.message; }
        assert(policyError && policyError.includes('Dominio bloqueado'), 'web_download respeta la política de dominios');
        let schemeError = null;
        try { await browser.run('web_download', { url: 'ftp://files.example.com/a.zip' }, { drafts: downloadRoot }); }
        catch (error) { schemeError = error.message; }
        assert(schemeError === 'Indica la dirección http(s) del archivo', 'web_download solo acepta direcciones http(s)');
        const pending = browser.run('web_download', { url: 'https://files.example.com/informe.pdf' }, { drafts: downloadRoot });
        assert(JSON.stringify(downloads) === JSON.stringify(['https://files.example.com/informe.pdf']),
          'web_download pide el archivo en la sesión aislada del navegador');
        let doneHandler = null;
        const item = {
          cancelled: 0, saved: null,
          getFilename: () => 'informe final?.pdf', setSavePath: (value) => { item.saved = value; },
          getURLChain: () => ['https://files.example.com/informe.pdf'],
          on: () => {}, once: (event, handler) => { doneHandler = handler; },
          getTotalBytes: () => 4096, getReceivedBytes: () => 4096, cancel: () => { item.cancelled += 1; },
        };
        let unrequestedCancelled = false;
        downloadHandler({ preventDefault: () => {} }, { ...item,
          getURLChain: () => ['https://files.example.com/no-solicitado.pdf'],
          cancel: () => { unrequestedCancelled = true; },
        });
        assert(unrequestedCancelled && item.saved === null,
          'una descarga ajena no escribe ni consume la descarga autorizada pendiente');
        let requestedCancelled = false;
        downloadHandler({ preventDefault: () => { requestedCancelled = true; } }, item);
        assert(!requestedCancelled, 'la descarga autorizada conserva el comportamiento nativo de Electron');
        assert(item.saved && item.saved.startsWith(downloadRoot) && item.saved.endsWith('-informe final_.pdf'),
          'la descarga pedida se guarda en los borradores con nombre saneado');
        doneHandler({}, 'completed');
        const saved = await pending;
        assert(saved.filename === 'informe final_.pdf' && saved.bytes === 4096 && saved.saved_path === item.saved,
          'web_download devuelve el archivo guardado en borradores');
        const bigPending = browser.run('web_download', { url: 'https://files.example.com/grande.zip' }, { drafts: downloadRoot });
        const bigItem = {
          cancelled: false, updated: null,
          getFilename: () => 'grande.zip', setSavePath: () => {},
          getURLChain: () => [downloads.at(-1)],
          on: (event, handler) => { bigItem.updated = handler; }, once: () => {},
          getTotalBytes: () => 150 * 1024 * 1024, getReceivedBytes: () => 150 * 1024 * 1024,
          cancel: () => { bigItem.cancelled = true; },
        };
        let bigDone = null;
        bigItem.once = (event, handler) => { bigDone = handler; };
        downloadHandler({ preventDefault: () => {} }, bigItem);
        bigItem.updated({}, 'progressing');
        assert(bigItem.cancelled, 'una descarga que excede el límite se cancela en cuanto se conoce su tamaño');
        bigDone({}, 'interrupted');
        let bigError = null;
        try { await bigPending; } catch (error) { bigError = error.message; }
        assert(bigError && bigError.includes('excede el límite'), 'web_download falla cuando el archivo excede el límite de tamaño');
        bigItem.getTotalBytes = () => 0;
        for (const state of ['interrupted', 'completed']) {
          const unknownPending = browser.run('web_download', { url: 'https://files.example.com/stream' }, { drafts: downloadRoot });
          bigItem.cancelled = false;
          downloadHandler({ preventDefault: () => {} }, bigItem);
          if (state === 'interrupted') {
            bigItem.updated({}, 'progressing');
            assert(bigItem.cancelled, 'los bytes recibidos limitan también las descargas sin Content-Length');
          }
          bigDone({}, state);
          let unknownError = null;
          try { await unknownPending; } catch (error) { unknownError = error.message; }
          assert(unknownError && unknownError.includes('excede el límite'), `el tamaño desconocido no evita el límite al terminar ${state}`);
        }
        const stray = { cancelled: 0, cancel: () => { stray.cancelled += 1; } };
        downloadHandler({ preventDefault: () => {} }, stray);
        assert(stray.cancelled === 1, 'las descargas que no pidió el agente se cancelan como antes');
      } finally { rmSync(downloadRoot, { recursive: true, force: true }); }
      const approvedContext = await browser.approvalContext();
      const uploaded = await browser.run('web_upload', { ref: '9', path: 'C:\\datos\\informe.pdf' }, { approvedContext });
      assert(uploaded.uploaded === 'C:\\datos\\informe.pdf' && uploaded.ref === '9', 'web_upload asigna el archivo al campo de la página');
      const setFiles = commands.find(([method]) => method === 'DOM.setFileInputFiles');
      assert(setFiles && JSON.stringify(setFiles[1]) === JSON.stringify({ files: ['C:\\datos\\informe.pdf'], nodeId: 21 }),
        'web_upload usa DOM.setFileInputFiles sobre el nodo del campo');
      uploadField = null;
      let missing = null;
      try { await browser.run('web_upload', { ref: '9', path: 'C:\\datos\\informe.pdf' }, { approvedContext }); }
      catch (error) { missing = error.message; }
      assert(missing === 'El elemento ya no está en la página; vuelve a leerla con web_read', 'web_upload exige volver a leer la página si el campo desapareció');
      uploadField = { tag: 'div', type: '' };
      let notField = null;
      try { await browser.run('web_upload', { ref: '9', path: 'C:\\datos\\informe.pdf' }, { approvedContext }); }
      catch (error) { notField = error.message; }
      assert(notField === 'El elemento no es un campo de archivo', 'web_upload rechaza elementos que no son campos de archivo');
      uploadField = { tag: 'input', type: 'file' };
      let noNode = null;
      try { await browser.run('web_upload', { ref: '8', path: 'C:\\datos\\informe.pdf' }, { approvedContext }); }
      catch (error) { noNode = error.message; }
      assert(noNode === 'El campo de archivo ya no está en la página; vuelve a leerla con web_read', 'web_upload exige el nodo vivo en el DOM');
    } finally { timers.restore(); browser.close(); }
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
        if (script.includes('const el = document.querySelector') && script.includes('getBoundingClientRect')) {
          if (navigationPhase === 'locate') pageTimeOrigin += 1;
          return { x: 240, y: 120 };
        }
        if (navigationPhase === 'clear' && script.includes("'select' in el")) pageTimeOrigin += 1;
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
        getUserAgent: () => 'Mozilla/5.0 Chrome/1 Electron/1', setUserAgent: () => {} }) },
    });
    const timers = installInertTimers();
    try { await browser.navigate('open', 'https://example.com'); } finally { timers.restore(); }
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    const attempt = async () => { try { await browser.run('web_back', {}); return null; } catch (err) { return err.message; } };
    assert(await attempt() === browser.USER_BUSY_ERROR, 'si el usuario acaba de usar la página, el agente no actúa sobre ella');
    const now = Date.now;
    Date.now = () => now() + 6_000;
    try {
      assert(await attempt() === 'No hay una página anterior', 'pasados unos segundos sin actividad del usuario, el agente retoma la página');
    } finally { Date.now = now; }
    browser.close();
  }
  {
    const { EventEmitter: Emitter } = require('node:events');
    const { mkdtempSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const moves = [];
    const pages = [];
    let hostDestroyed = 0;
    let pageSeq = 0;
    const makeParent = (name) => ({
      isDestroyed: () => false,
      contentView: {
        addChildView: (child) => moves.push([name, 'add', child]),
        removeChildView: (child) => moves.push([name, 'remove', child]),
      },
    });
    const main = { ...makeParent('main'), getContentSize: () => [1000, 700], webContents: { getZoomFactor: () => 1, send: () => {} } };
    const host = { ...makeParent('host'), on: () => {}, showInactive: () => {}, setIgnoreMouseEvents: () => {},
      destroy: () => { hostDestroyed += 1; } };
    stubModule('electron/window-manager.js', { getMainWindow: () => main });
    stubModule('electron', {
      BrowserWindow: function () { return host; },
      WebContentsView: function () {
        const url = `https://tab-${pageSeq += 1}.example.com`;
        const contents = Object.assign(new Emitter(), {
          isDestroyed: () => false, getURL: () => url, getTitle: () => `Título ${url}`, isLoading: () => false,
          getZoomFactor: () => 1, setZoomFactor: () => {}, setWindowOpenHandler: () => {}, loadURL: async () => {},
          navigationHistory: { canGoBack: () => false, canGoForward: () => false }, close: () => contents.emit('destroyed'),
          executeJavaScript: async () => ({ url, title: `Título ${url}`, text: `Texto de ${url}`, elements: [] }),
          executeJavaScriptInIsolatedWorld: async () => ({ url, time_origin: 1 }),
          debugger: Object.assign(new Emitter(), { isAttached: () => false, attach: () => {}, sendCommand: async () => ({}) }),
        });
        const page = { webContents: contents, setBounds: () => {}, getBounds: () => ({ width: 1280 }) };
        pages.push(page);
        return page;
      },
      session: { fromPartition: () => ({ setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {}, on: () => {},
        getUserAgent: () => 'Mozilla/5.0 Chrome/1 Electron/1', setUserAgent: () => {} }) },
    });
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    const timers = installInertTimers();
    try {
      browser.dock({ x: 0, y: 0, width: 400, height: 500 });
      await browser.navigate('open', 'https://tab-1.example.com');
      const first = (await browser.run('web_tab', { action: 'list' })).tabs[0].id;
      moves.length = 0;
      const opened = await browser.run('web_tab', { action: 'open', url: 'https://tab-2.example.com' });
      const second = opened.tab;
      assert(second && second !== first && opened.text === 'Texto de https://tab-2.example.com',
        'web_tab abre una pestaña nueva y devuelve su página');
      let st = browser.state();
      assert(st.tabs.length === 2 && st.tabs[0].id === first && st.tabs[0].active === false
        && st.tabs[1].id === second && st.tabs[1].active === true, 'la pestaña nueva queda activa y listada con la original');
      assert(moves[0]?.[0] === 'main' && moves[0]?.[2] === pages[0] && moves[1]?.[0] === 'host' && moves[1]?.[2] === pages[0]
        && moves[3]?.[0] === 'main' && moves[3]?.[2] === pages[1],
      'la pestaña de fondo queda en la anfitriona y la activa se añade la última, encima en el panel');
      moves.length = 0;
      const selected = await browser.run('web_tab', { action: 'select', id: first });
      assert(selected.selected === first && selected.tabs[0].active === true && selected.tabs[1].active === false,
        'web_tab selecciona otra pestaña');
      assert(moves[1]?.[0] === 'host' && moves[1]?.[2] === pages[1] && moves[3]?.[0] === 'main' && moves[3]?.[2] === pages[0],
        'al seleccionar, la pestaña activa vuelve al panel y la anterior pasa al anfitrión');
      moves.length = 0;
      const again = await browser.run('web_tab', { action: 'select', id: first });
      assert(again.selected === first && moves.length === 0, 'seleccionar la pestaña ya activa no remonta nada');
      await browser.run('web_open', { url: 'https://tab-1b.example.com' });
      assert(browser.state().tabs.length === 2, 'web_open navega en la pestaña activa sin crear otra');
      const closed = await browser.run('web_tab', { action: 'close', id: second });
      assert(closed.closed === second && closed.open === true && closed.tabs.length === 1 && closed.tabs[0].id === first,
        'cerrar una pestaña de fondo conserva el navegador y la activa');
      const last = await browser.run('web_tab', { action: 'close', id: first });
      assert(last.closed === first && last.open === false && last.tabs.length === 0 && last.docked === false,
        'cerrar la última pestaña cierra el navegador y desacopla el panel');
      assert(hostDestroyed === 1, 'cerrar la última pestaña destruye también la ventana anfitriona');
      let missingTab = null;
      try { await browser.run('web_tab', { action: 'close', id: '9' }); } catch (error) { missingTab = error.message; }
      assert(missingTab === 'No existe esa pestaña; usa web_tab con «list» para verlas',
        'seleccionar o cerrar una pestaña inexistente avisa con la salida');
      let badAction = null;
      try { await browser.run('web_tab', { action: 'zoom' }); } catch (error) { badAction = error.message; }
      assert(badAction === 'Acción de pestaña no válida: zoom', 'web_tab rechaza acciones desconocidas');
      const empty = await browser.run('web_tab', { action: 'list' });
      assert(JSON.stringify(empty.tabs) === '[]' && empty.active === null, 'listar sin navegador devuelve una lista vacía');
      const reopened = await browser.run('web_tab', { action: 'open', url: 'https://tab-3.example.com' });
      assert(reopened.tab && browser.state().open === true, 'abrir una pestaña recrea el navegador sin página previa');
      const policyRoot = mkdtempSync(join(tmpdir(), 'antares-agent-tabs-'));
      const realLocalAppData = process.env.LOCALAPPDATA;
      process.env.LOCALAPPDATA = policyRoot;
      let blockedTab = null;
      try { await browser.run('web_tab', { action: 'open', url: 'bcp.pe/panel' }); } catch (error) { blockedTab = error.message; }
      assert(blockedTab && blockedTab.includes('Dominio bloqueado'), 'web_tab open respeta la política de dominios');
      process.env.LOCALAPPDATA = realLocalAppData;
      rmSync(policyRoot, { recursive: true, force: true });
    } finally { Date.now = realNow; timers.restore(); browser.close(); }
  }
  const { validateToolArguments } = await import('@earendil-works/pi-ai');
  const taskSpec = specs.find((s) => s.name === 'espacios_tarea_update');
  const taskTool = { name: taskSpec.name, description: taskSpec.description, parameters: taskSpec.inputSchema };
  for (const revision of [undefined, '']) {
    let rejected = false;
    try {
      validateToolArguments(taskTool, { id: 'call-1', name: taskTool.name,
        arguments: { id: 'task-1', input: { title: 'Corregida' }, ...(revision === undefined ? {} : { expected_updated_at: revision }) } });
    } catch { rejected = true; }
    assert(rejected, 'el esquema rechaza una actualización sin revisión');
  }
  const revision = '2026-10-13T10:00:00Z';
  const taskArgs = { id: 'task-1', input: { title: 'Corregida' }, expected_updated_at: revision };
  assert(validateToolArguments(taskTool, { id: 'call-1', name: taskTool.name, arguments: taskArgs }).expected_updated_at === revision,
    'una actualización válida conserva la revisión consultada');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-export-'));
  process.env.LOCALAPPDATA = root;
  const calls = [];
  const stub = (request, exportsValue) => {
    const id = require.resolve(request);
    require.cache[id] = { id, filename: id, loaded: true, exports: exportsValue };
  };
  stub('electron', { BrowserWindow: function BrowserWindow() {}, session: {} });
  stub('../electron/ipc-router', { _callBackend: async (method, params) => { calls.push([method, params]); return { html: '<p>x</p>', count: 2 }; } });
  stub('../electron/pdf-render', {
    renderHtmlToPdf: async (params) => {
      const out = path.join(root, `tmp-${params.filename}`);
      fs.writeFileSync(out, '%PDF render');
      return { saved_path: out, filename: params.filename };
    },
  });
  const { runNativeTool } = require('../electron/agent-native-tools');
  const single = await runNativeTool('technical_reports_export_pdf', { id: '7', filename: 'informe-7' }, { sessionId: 'abc123' });
  const expected = path.join(root, 'Antares', 'ai-agent', 'drafts', 'abc123');
  assert(path.dirname(single.saved_path) === expected && fs.readFileSync(single.saved_path, 'utf8') === '%PDF render', 'el PDF queda en los borradores de la conversación');
  const repeated = await runNativeTool('technical_reports_export_pdf', { id: '7', filename: 'informe-7' }, { sessionId: 'abc123' });
  assert(repeated.saved_path !== single.saved_path && fs.existsSync(single.saved_path), 'otro borrador no reemplaza el PDF revisado');
  assert(JSON.stringify(calls[0]) === JSON.stringify(['technical_reports_render_html', { id: '7' }]), 'usa el render HTML del backend');
  const all = await runNativeTool('fichas_tecnicas_export_pdf', { ids: ['a', 'b'], filename: 'fichas' }, { sessionId: 'abc123' });
  assert(all.count === 2 && JSON.stringify(calls[2]) === JSON.stringify(['fichas_tecnicas_render_consolidated_html', { ficha_ids: ['a', 'b'] }]),
    'el consolidado usa los ids del módulo');
  let account = 'cuenta-original';
  let sheet = 'hoja-original';
  const fixtureRefresh = 'refresh-original';
  let tokens = { access_token: 'access-original', refresh_token: fixtureRefresh,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive' };
  stub('../electron/google-session', {
    captureAuthSession: () => ({ userKey: account }), assertAuthSessionCurrent: () => {},
    getValidTokens: async () => tokens, getOAuthConfig: () => ({ clientId: 'client-publico' }),
  });
  stub('../electron/autoimg-user-scope', { getActiveEmail: () => `${account}@example.com` });
  stub('../electron/autoimg-user-store', { loadSheetConfig: () => ({ sheet_id: sheet }) });
  stub('../electron/google-sheets-service', { getSheetId: () => sheet });
  let effects = 0;
  stub('../electron/autoimg-handlers', { handleAutoimgCall: async () => { effects += 1; return { handled: true, result: { ok: true } }; } });
  const { nativeToolContext } = require('../electron/agent-native-tools');
  {
    let pageUrl = 'https://example.com/informe';
    let pageTimeOrigin = 1;
    let interactions = 0;
    stubModule('electron/agent-browser.js', {
      ...browser,
      approvalContext: async () => ({ page_url: pageUrl, page_time_origin: pageTimeOrigin }),
      run: async (_name, _params, options) => {
        assert(options.approvedContext?.page_time_origin === pageTimeOrigin, 'el adapter conserva el contexto aprobado hasta el navegador');
        interactions += 1; return { clicked: '1' };
      },
    });
    const approved = await nativeToolContext('web_click');
    assert(approved.page_url === pageUrl && approved.page_time_origin === pageTimeOrigin,
      'la aprobación del navegador identifica la página y su documento');
    pageTimeOrigin += 1;
    let rejected = false;
    try { await runNativeTool('web_click', { ref: '1' }, { sessionId: 'abc123', approvedContext: approved }); }
    catch { rejected = true; }
    assert(rejected && interactions === 0, 'recargar la misma URL invalida una aprobación pendiente antes de hacer clic');
    pageUrl = 'https://example.com/otra';
    const currentPage = await nativeToolContext('web_click');
    assert(currentPage.page_url === pageUrl, 'la siguiente aprobación identifica la página nueva');
    await runNativeTool('web_click', { ref: '1' }, { sessionId: 'abc123', approvedContext: currentPage });
    assert(interactions === 1, 'una aprobación de la página actual ejecuta la interacción una sola vez');
    const router = require('../electron/ipc-router');
    const grantCalls = [];
    stubModule('electron/ipc-router.js', { _callBackend: async (method, params) => {
      grantCalls.push([method, params]);
      return { granted: true };
    } });
    const uploadApproved = await nativeToolContext('web_upload', 's1', { ref: '9', path: 'C:\\datos\\x.pdf' });
    assert(uploadApproved.page_url === pageUrl && grantCalls[0][0] === 'agent_internal_grants_check'
      && grantCalls[0][1].session_id === 's1' && grantCalls[0][1].path === 'C:\\datos\\x.pdf',
    'web_upload verifica los grants del backend antes de pedir aprobación');
    stubModule('electron/ipc-router.js', { _callBackend: async () => {
      throw new Error('El archivo no está autorizado; escribe su ruta en tu mensaje o selecciónalo');
    } });
    let denied = null;
    try { await nativeToolContext('web_upload', 's1', { path: 'C:\\otros\\y.pdf' }); } catch (error) { denied = error.message; }
    assert(denied && denied.includes('no está autorizado'), 'una ruta sin grant impide pedir la aprobación de web_upload');
    stubModule('electron/ipc-router.js', router);
    stubModule('electron/agent-browser.js', browser);
  }
  const context = await nativeToolContext('autoimg_sheets_write_range');
  assert(context.account === 'cuenta-original@example.com' && context.sheet_id === sheet, 'contexto identifica cuenta y hoja');
  assert(!JSON.stringify(context).includes('refresh-original'), 'la aprobación no incluye credenciales');
  await runNativeTool('autoimg_sheets_write_range', { range: 'CONFIG!A1', values: [['dato']] }, { approvedContext: context });
  assert(effects === 1, 'ejecuta en el contexto aprobado');
  for (const change of ['account', 'sheet', 'scope', 'credential']) {
    account = change === 'account' ? 'otra-cuenta' : 'cuenta-original';
    sheet = change === 'sheet' ? 'otra-hoja' : 'hoja-original';
    tokens.scope = change === 'scope' ? '' : 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';
    tokens.refresh_token = change === 'credential' ? 'refresh-distinto' : 'refresh-original';
    let rejected = false;
    try { await runNativeTool('autoimg_sheets_write_range', {}, { approvedContext: context }); } catch { rejected = true; }
    assert(rejected && effects === 1, `cambiar ${change} impide iniciar el efecto`);
  }
  account = 'cuenta-original'; sheet = 'hoja-original'; tokens.refresh_token = fixtureRefresh;
  tokens.access_token = 'access-renovado';
  assert(JSON.stringify(await nativeToolContext('autoimg_sheets_write_range')) === JSON.stringify(context), 'renovar access token mantiene la intención');
  tokens = null;
  let disconnected = false;
  try { await runNativeTool('autoimg_sheets_write_range', {}, { approvedContext: context }); } catch { disconnected = true; }
  assert(disconnected && effects === 1, 'desconectar Google impide iniciar el efecto');
  let spaceAccount = 'space-user-1';
  let spaceEffects = 0;
  stub('../electron/agent-renderer-tools', { runRendererTool: async (name, params) => {
    if (!spaceAccount) throw new Error('Inicia sesión en Espacios');
    if (name === 'espacios_context') return { account_id: spaceAccount, account: `${spaceAccount}@example.com` };
    assert(params._expected_account_id === spaceAccount, 'Espacios recibe la cuenta aprobada');
    spaceEffects += 1;
    return { ok: true };
  } });
  const spaceContext = await nativeToolContext('espacios_tarea_delete');
  await runNativeTool('espacios_tarea_delete', { id: 'task-1' }, { approvedContext: spaceContext });
  for (const changedAccount of ['space-user-2', null]) {
    spaceAccount = changedAccount;
    let rejected = false;
    try { await runNativeTool('espacios_tarea_delete', { id: 'task-1' }, { approvedContext: spaceContext }); } catch { rejected = true; }
    assert(rejected && spaceEffects === 1, 'cambiar o desconectar Espacios bloquea el efecto');
  }
  fs.rmSync(root, { recursive: true, force: true });
}

exportTest().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
