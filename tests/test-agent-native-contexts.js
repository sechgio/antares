'use strict';

const { assert, finish, stubModule } = require('./helpers/harness');

// el navegador del agente resuelve el DNS de cada destino: en los tests
// toda resolución es pública
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node:dns') {
    return { promises: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { nativeToolSpecs, runNativeTool, nativeToolContext } = require('../electron/agent-native-tools');
const browser = require('../electron/agent-browser');

const specs = nativeToolSpecs();

async function contextTests() {
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

contextTests().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
