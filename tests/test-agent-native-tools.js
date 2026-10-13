'use strict';

// Clasificación de las herramientas nativas que ve el agente: lecturas sin
// aprobación, efectos con aprobación y configuración humana fuera.

const { assert, finish } = require('./helpers/harness');
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

const { draftName } = require('../electron/agent-native-tools');
assert(draftName('informe') === 'informe.pdf' && draftName('a.PDF') === 'a.PDF', 'nombre de borrador con extensión .pdf');
for (const bad of ['', '..', 'sub/a.pdf', String.raw`C:\x\a.pdf`, 'a?.pdf']) {
  let threw = false;
  try { draftName(bad); } catch { threw = true; }
  assert(threw, `rechaza el nombre ${JSON.stringify(bad)}`);
}

async function exportTest() {
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
