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
assert(web.length === 7 && web.every((s) => s.module === 'computer'), 'las herramientas del navegador pertenecen al módulo Equipo');
assert(web.filter((s) => s.gated).map((s) => s.name).sort().join() === 'web_click,web_key,web_type',
  'leer páginas es automático; hacer clic, escribir o pulsar teclas requiere aprobación');
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
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false, getURL: () => 'https://example.com', getTitle: () => 'Página',
      isLoading: () => false, getZoomFactor: () => 1, setZoomFactor: () => {},
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      setWindowOpenHandler: () => {}, loadURL: async () => {}, close: () => contents.emit('destroyed'),
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
