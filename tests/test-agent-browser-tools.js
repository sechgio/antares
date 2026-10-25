'use strict';

const { assert, finish, stubModule, installInertTimers } = require('./helpers/harness');
const { nativeToolSpecs } = require('../electron/agent-native-tools');
const browser = require('../electron/agent-browser');

const specs = nativeToolSpecs();
const web = specs.filter((s) => s.name.startsWith('web_'));
assert(web.length === 15 && web.every((s) => s.module === 'computer'), 'las herramientas del navegador pertenecen al módulo Equipo');
assert(web.filter((s) => s.gated).map((s) => s.name).sort().join() === 'web_click,web_download,web_key,web_type,web_upload',
  'leer y navegar es automático; clic, escribir, teclas, descargar y subir requieren aprobación');
assert(web.filter((s) => !s.gated).map((s) => s.name).sort().join()
  === 'web_back,web_console,web_forward,web_handover,web_network,web_open,web_read,web_reload,web_screenshot,web_text',
  'texto, consola, red, captura, cesión del control y navegación se usan sin aprobación');

async function main() {
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
  } finally { timers.restore(); browser.close(); }
}

main().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
