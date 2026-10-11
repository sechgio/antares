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
assert(exportsSpecs.length === 3 && exportsSpecs.every((s) => !s.gated), 'las exportaciones a borrador no piden aprobación');
assert(JSON.stringify(exportsSpecs.map((s) => s.module)) === JSON.stringify(['technicalReports', 'informesV2', 'fichasTecnicas']),
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
  const expected = path.join(root, 'Antares', 'ai-agent', 'drafts', 'abc123', 'informe-7.pdf');
  assert(single.saved_path === expected && fs.readFileSync(expected, 'utf8') === '%PDF render', 'el PDF queda en los borradores de la conversación');
  assert(JSON.stringify(calls[0]) === JSON.stringify(['technical_reports_render_html', { id: '7' }]), 'usa el render HTML del backend');
  const all = await runNativeTool('fichas_tecnicas_export_pdf', { ids: ['a', 'b'], filename: 'fichas' }, { sessionId: 'abc123' });
  assert(all.count === 2 && JSON.stringify(calls[1]) === JSON.stringify(['fichas_tecnicas_render_consolidated_html', { ficha_ids: ['a', 'b'] }]),
    'el consolidado usa los ids del módulo');
  fs.rmSync(root, { recursive: true, force: true });
}

exportTest().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
