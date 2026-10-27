'use strict';

const { assert, finish, stubModule, installInertTimers } = require('./helpers/harness');
const { nativeToolSpecs } = require('../electron/agent-native-tools');
const browser = require('../electron/agent-browser');

const specs = nativeToolSpecs();
const web = specs.filter((s) => s.name.startsWith('web_'));
assert(web.length === 21 && web.every((s) => s.module === 'computer'), 'las herramientas del navegador pertenecen al módulo Equipo');
assert(web.filter((s) => s.gated).map((s) => s.name).sort().join()
  === 'web_check,web_click,web_download,web_fill,web_key,web_select,web_type,web_upload',
  'leer y navegar es automático; clic, escribir, elegir, marcar, rellenar, teclas, descargar y subir requieren aprobación');
assert(web.filter((s) => !s.gated).map((s) => s.name).sort().join()
  === 'web_back,web_console,web_forward,web_handover,web_hover,web_network,web_open,web_read,web_reload,web_screenshot,web_scroll,web_text,web_wait',
  'texto, consola, red, captura, desplazar, esperar, pasar el puntero, cesión del control y navegación se usan sin aprobación');

async function main() {
  const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { EventEmitter: Emitter } = require('node:events');
  const commands = [];
  let uploadField = { tag: 'input', type: 'file' };
  let documentOrigin = 3;
  let target = { x: 10, y: 20, secret: false };
  let focusedSecret = false;
  let fillKinds = ['text'];
  let pageText = 'Contenido';
  let onPress = () => {};
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
      const guard = script.match(/performance\.timeOrigin !== (\S+)\)/);
      if (guard && JSON.parse(guard[1]) !== documentOrigin) return { stale: true };
      if (script.includes('tagName') && script.includes('scrollIntoView')) return uploadField;
      if (script.includes('scrollIntoView')) return target;
      if (script.includes('document.activeElement')) return focusedSecret;
      if (script.includes('const wanted')) return { selected: ['Perú'] };
      if (script.includes("'missing'")) return fillKinds;
      if (script.includes('gone:')) return { text: pageText.includes('listo'), gone: true, url: true };
      if (script.includes('scrollBy')) return { moved: 800, at_end: false, at_start: false };
      return { url: 'https://files.example.com', title: 'Archivos', text: pageText, elements: [], time_origin: documentOrigin };
    },
    executeJavaScriptInIsolatedWorld: async () => ({ url: 'https://files.example.com', time_origin: 3 }),
    capturePage: async () => ({ getSize: () => ({ width: 1280, height: 800 }), toJPEG: () => Buffer.from('jpeg-viewport') }),
    debugger: Object.assign(new Emitter(), {
      isAttached: () => false, attach: () => {},
      sendCommand: async (method, params) => {
        commands.push([method, params]);
        if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') onPress();
        if (method === 'Page.captureScreenshot') return { data: Buffer.from('jpeg-completa').toString('base64') };
        if (method === 'DOM.getDocument') return { root: { nodeId: 7 } };
        if (method === 'DOM.querySelector') return { nodeId: params.selector.includes('"9"') ? 21 : 0 };
        return {};
      },
    }),
  });
  let downloadHandler = null;
  const downloads = [];
  const requested = async (count) => {
    for (let i = 0; i < 20 && downloads.length < count; i += 1) await Promise.resolve();
  };
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
      await requested(1);
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
      await requested(2);
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
        await requested(downloads.length + 1);
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

    const sentInput = () => commands.filter(([method]) => method.startsWith('Input.')).length;
    const failure = async (name, params) => {
      try { await browser.run(name, params); } catch (error) { return error; }
      return null;
    };
    documentOrigin = 4;
    let before = sentInput();
    const staleClick = await failure('web_click', { ref: '9' });
    assert(staleClick && staleClick.code === 'PAGE_CHANGED' && staleClick.recoverable === true && sentInput() === before,
      'una ref de un documento anterior no hace clic en el elemento que hoy tiene ese número');
    const staleUpload = await failure('web_upload', { ref: '9', path: 'C:\datos\informe.pdf' });
    assert(staleUpload && staleUpload.code === 'PAGE_CHANGED', 'web_upload tampoco usa refs de un documento anterior');
    await browser.run('web_read', {});
    const clicked = await browser.run('web_click', { ref: '9' });
    assert(clicked.clicked === '9' && sentInput() > before, 'tras volver a leer la página las refs nuevas funcionan');

    target = { x: 10, y: 20, secret: true };
    before = sentInput();
    const secretType = await failure('web_type', { ref: '9', text: 'hunter2' });
    assert(secretType && secretType.code === 'SECRET_FIELD' && secretType.message.includes('web_handover') && sentInput() === before,
      'web_type no escribe en contraseñas, códigos ni tarjetas y propone ceder el control');
    target = { x: 10, y: 20, secret: false };
    const typed = await browser.run('web_type', { ref: '9', text: 'Lima' });
    assert(typed.typed === 4 && commands.some(([method, params]) => method === 'Input.insertText' && params.text === 'Lima'),
      'web_type sigue escribiendo en campos ordinarios');

    focusedSecret = true;
    before = sentInput();
    const secretKeys = await failure('web_key', { keys: 'h u n space' });
    assert(secretKeys && secretKeys.code === 'SECRET_FIELD' && sentInput() === before,
      'web_key no escribe caracteres en un campo secreto enfocado');
    const submitted = await browser.run('web_key', { keys: 'enter' });
    assert(submitted.pressed === 'enter' && sentInput() > before, 'web_key puede enviar el formulario que completó el usuario');
    focusedSecret = false;

    target = { x: 10, y: 20, secret: false, covered: 'div «Aceptar cookies»' };
    before = sentInput();
    const covered = await failure('web_click', { ref: '9' });
    assert(covered && covered.code === 'COVERED' && covered.message.includes('Aceptar cookies') && !covered.recoverable
      && sentInput() === before, 'un elemento encima bloquea el clic y nombra lo que tapa la referencia');
    target = { x: 10, y: 20, secret: false };

    onPress = () => {
      contents.emit('console-message', { level: 'error', message: 'TypeError: pago no definido' });
      contents.debugger.emit('message', {}, 'Network.requestWillBeSent',
        { requestId: 'r500', request: { method: 'POST', url: 'https://files.example.com/api/pago' } });
      contents.debugger.emit('message', {}, 'Network.responseReceived', { requestId: 'r500', response: { status: 500 } });
    };
    const reported = await browser.run('web_click', { ref: '9' });
    assert(reported.page_reported && reported.page_reported.console_errors[0] === 'TypeError: pago no definido'
      && reported.page_reported.failed_requests[0] === '500 POST https://files.example.com/api/pago',
      'el clic informa los errores de consola y las peticiones fallidas que provocó');
    onPress = () => {};
    const quiet = await browser.run('web_click', { ref: '9' });
    assert(!quiet.page_reported, 'los errores ya informados no se repiten en la acción siguiente');

    const picked = await browser.run('web_select', { ref: '9', values: ['Perú'] });
    assert(JSON.stringify(picked.selected) === '["Perú"]' && picked.page, 'web_select elige la opción y devuelve la página');

    target = { x: 10, y: 20, secret: false, checked: false };
    onPress = () => { target = { ...target, checked: !target.checked }; };
    const checked = await browser.run('web_check', { ref: '9', checked: true });
    assert(checked.checked === true && checked.changed === true && !checked.note, 'web_check hace clic y confirma el estado nuevo');
    before = sentInput();
    const already = await browser.run('web_check', { ref: '9', checked: true });
    assert(already.checked === true && already.changed === false && sentInput() === before,
      'web_check no hace clic si ya tiene el estado pedido');
    onPress = () => {};
    target = { x: 10, y: 20, secret: false, checked: null };
    const notToggle = await failure('web_check', { ref: '9', checked: true });
    assert(notToggle && notToggle.message.includes('no es una casilla'), 'web_check rechaza lo que no es una casilla');
    target = { x: 10, y: 20, secret: false };

    fillKinds = ['text', 'secret'];
    before = sentInput();
    const secretFill = await failure('web_fill', { fields: [{ ref: '9', text: 'Ana' }, { ref: '10', text: 'clave' }] });
    assert(secretFill && secretFill.code === 'SECRET_FIELD' && sentInput() === before,
      'web_fill no escribe ningún campo si alguno es secreto');
    const duplicated = await failure('web_fill', { fields: [{ ref: '9', text: 'a' }, { ref: '9', text: 'b' }] });
    assert(duplicated && duplicated.message.includes('ref distinta'), 'web_fill exige refs distintas');
    fillKinds = ['text', 'text'];
    const filled = await browser.run('web_fill', { fields: [{ ref: '9', text: 'Ana' }, { ref: '10', text: 'Lima' }] });
    const inserted = commands.filter(([method]) => method === 'Input.insertText').slice(-2).map(([, params]) => params.text);
    assert(filled.filled === 2 && JSON.stringify(inserted) === '["Ana","Lima"]', 'web_fill escribe cada campo en orden');
    assert(Array.isArray(filled.unconfirmed) && filled.note, 'web_fill señala los campos cuyo valor no pudo confirmar');

    const scrolled = await browser.run('web_scroll', { direction: 'down' });
    assert(scrolled.scrolled === 800 && scrolled.page, 'web_scroll desplaza y devuelve la página');
    pageText = 'cargando';
    const timedOut = await browser.run('web_wait', { text: 'Listo', timeout_ms: 250 });
    assert(timedOut.met === false && timedOut.note.includes('no la des por hecha'), 'web_wait avisa cuando la condición no se cumple');
    pageText = 'listo';
    const met = await browser.run('web_wait', { text: 'Listo', timeout_ms: 250 });
    assert(met.met === true && met.waited_ms === 0, 'web_wait termina en cuanto se cumple la condición');
    const noCondition = await failure('web_wait', {});
    assert(noCondition && noCondition.message === 'Indica text, gone o url', 'web_wait exige una condición');
  } finally { timers.restore(); browser.close(); }
}

main().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
