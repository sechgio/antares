'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assert, finish } = require('./helpers/harness');

const cloud = require('../electron/cloud-connector-common');
const google = require('../electron/google-workspace-service');
const microsoft = require('../electron/microsoft-files-service');
const { nativeToolSpecs } = require('../electron/agent-native-tools');

const TOKEN = 'token-secreto-123';
const SCOPES = {
  google: 'openid https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
  microsoft: 'User.Read Files.ReadWrite',
};

function setup(routes, scopes = SCOPES) {
  const calls = [];
  cloud._setDeps({
    session: {
      getValidTokens: async () => ({ access_token: TOKEN }),
      loadTokens: (provider) => ({ access_token: TOKEN, account: `${provider}@example.com`, scope: scopes[provider] }),
    },
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body });
      for (const [match, handler] of routes) {
        if (match(url, options)) return handler(url, options);
      }
      throw new Error(`ruta inesperada ${url}`);
    },
  });
  return calls;
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const has = (text, method = 'GET') => (url, options) => url.includes(text) && (options.method || 'GET') === method;

async function rejects(promise) {
  try { await promise; } catch (err) { return err; }
  return null;
}

async function main() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cloud-')));
  try {
    const specs = nativeToolSpecs().filter((spec) => spec.module === 'connections');
    assert(specs.length === 15, 'quince herramientas cloud registradas en Conexiones');
    assert(specs.filter((spec) => spec.gated).map((spec) => spec.name).sort().join() ===
      'excel_update_range,gdrive_upload,gsheets_append,gsheets_update_range,onedrive_upload', 'solo las escrituras requieren aprobación');

    setup([]);
    const ctx = await google.context('gsheets_update_range');
    assert(ctx.account === 'google@example.com' && ctx.scopes.length === 4, 'el contexto lleva cuenta y permisos concedidos');
    assert(!JSON.stringify(ctx).includes(TOKEN), 'el contexto no contiene el token');
    setup([], { ...SCOPES, google: 'openid https://www.googleapis.com/auth/drive.readonly' });
    assert(/spreadsheets/.test((await rejects(google.context('gsheets_update_range')))?.message || ''), 'sin permiso de escritura no hay contexto ni aprobación');
    assert((await google.context('gdrive_search')).account, 'la lectura sigue disponible con drive.readonly');
    setup([], { ...SCOPES, microsoft: 'User.Read' });
    assert(!!(await rejects(microsoft.context('onedrive_get'))), 'OneDrive exige Files.Read o Files.ReadWrite');

    let calls = setup([
      [has('/drive/v3/files?'), () => json({ files: [{ id: 'abcde1', name: 'datos.xlsx' }], nextPageToken: 'p2' })],
    ]);
    const found = await google.run('gdrive_search', { query: "it's", folder_id: 'folder01', page_size: 500 });
    const query = new URL(calls[0].url).searchParams;
    assert(found.files.length === 1 && found.next_page_token === 'p2', 'la búsqueda devuelve archivos y página siguiente');
    assert(query.get('q').includes("name contains 'it\\'s'") && query.get('q').includes("'folder01' in parents"), 'la consulta escapa el texto y limita la carpeta');
    assert(query.get('pageSize') === '100', 'el tamaño de página se acota');
    assert(calls[0].headers.Authorization === `Bearer ${TOKEN}`, 'el token viaja solo en la cabecera');

    calls = setup([
      [has('/files/abcde1?fields'), () => json({ id: 'abcde1', name: 'datos.csv', mimeType: 'text/csv', size: '5', version: '7' })],
      [has('/files/abcde1?alt=media'), () => new Response('a,b\n1')],
      [has('/files/gdoc01?fields'), () => json({ id: 'gdoc01', name: 'Informe', mimeType: 'application/vnd.google-apps.document', version: '3' })],
      [has('/files/gdoc01/export'), () => new Response('%PDF-1.4')],
    ]);
    const downloaded = await google.run('gdrive_download', { file_id: 'abcde1' }, { dir });
    assert(fs.readFileSync(downloaded.draft_path, 'utf8') === 'a,b\n1' && downloaded.source.version === '7', 'la descarga queda en borradores con su versión');
    assert(path.dirname(downloaded.draft_path) === dir && !('saved_path' in downloaded), 'la descarga es un borrador interno, no un artefacto PDF');
    const exported = await google.run('gdrive_download', { file_id: 'gdoc01' }, { dir });
    assert(exported.draft_name.endsWith('Informe.pdf') && exported.source.exported_as === 'application/pdf', 'un documento de Google se exporta a PDF');
    assert(!JSON.stringify([downloaded, exported]).includes(TOKEN), 'los resultados no contienen el token');

    fs.writeFileSync(path.join(dir, 'salida.pdf'), '%PDF-borrador');
    calls = setup([
      [has('/upload/drive/v3/files?uploadType=resumable', 'POST'), () => new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=xyz' } })],
      [has('upload_id=xyz', 'PUT'), () => json({ id: 'nuevo01' })],
      [has('/files/nuevo01?fields'), () => json({ id: 'nuevo01', name: 'salida.pdf', version: '1' })],
    ]);
    const created = await google.run('gdrive_upload', { draft: 'salida.pdf', folder_id: 'folder01' }, { dir });
    assert(created.file.id === 'nuevo01' && created.replaced === false, 'el borrador se sube como archivo nuevo');
    assert(JSON.parse(calls[0].body).parents[0] === 'folder01' && calls[1].body.toString() === '%PDF-borrador', 'sube el contenido exacto del borrador a la carpeta elegida');
    calls = setup([[has('/files/viejo01?fields'), () => json({ id: 'viejo01', version: '9' })]]);
    const stale = await rejects(google.run('gdrive_upload', { draft: 'salida.pdf', replace_file_id: 'viejo01', expected_version: '8' }, { dir }));
    assert(/cambió/.test(stale?.message || '') && calls.every((call) => call.method === 'GET'), 'una versión distinta impide reemplazar');
    assert(!!(await rejects(google.run('gdrive_upload', { draft: '../fuera.pdf' }, { dir }))), 'no se sube nada fuera de los borradores');
    calls = setup([
      [has('/upload/drive/v3/files?uploadType=resumable', 'POST'), () => new Response('', { headers: { location: 'https://evil.example.com/upload' } })],
    ]);
    assert(!!(await rejects(google.run('gdrive_upload', { draft: 'salida.pdf' }, { dir }))) && calls.length === 1, 'una sesión de subida fuera de Google se rechaza');

    calls = setup([
      [has('/values/Hoja1!A1%3AB1?valueInputOption', 'PUT'), () => { throw new Error('socket hang up'); }],
      [has('/values/Hoja1!A1%3AB1?valueRender'), () => json({ range: 'Hoja1!A1:B1', values: [['1', 'x']] })],
    ]);
    const reconciled = await google.run('gsheets_update_range', { spreadsheet_id: 'sheet0001', range: 'Hoja1!A1:B1', values: [[1, 'x']] });
    assert(reconciled.reconciled === true && calls.filter((c) => c.method === 'PUT').length === 1, 'la lectura confirma el cambio sin repetir la escritura');
    setup([
      [has(':append', 'POST'), () => new Response('error', { status: 503 })],
    ]);
    const lost = await rejects(google.run('gsheets_append', { spreadsheet_id: 'sheet0001', range: 'Hoja1!A:B', values: [['a']] }));
    assert(lost?.uncertain === true, 'un append sin respuesta queda incierto');
    setup([[has(':append', 'POST'), () => new Response('{}', { status: 403 })]]);
    const denied = await rejects(google.run('gsheets_append', { spreadsheet_id: 'sheet0001', range: 'Hoja1!A:B', values: [['a']] }));
    assert(denied && !denied.uncertain && /rechazó/.test(denied.message), 'un rechazo confirmado es un fallo, no una incertidumbre');
    assert(!!(await rejects(google.run('gsheets_update_range', { spreadsheet_id: 'sheet0001', range: 'A1', values: [[{}]] }))), 'valores no escalares se rechazan');

    calls = setup([[has('graph.microsoft.com'), () => json({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' })]]);
    assert((await microsoft.run('onedrive_search', { query: "o'k" })).next_page.startsWith('https://graph.microsoft.com/'), 'la búsqueda devuelve la página siguiente de Graph');
    assert(calls[0].url.includes(`search(q='${encodeURIComponent("o''k")}')`), 'la búsqueda usa el texto escapado');
    const foreign = await rejects(microsoft.run('onedrive_search', { next_page: 'https://evil.example.com/steal' }));
    assert(!!foreign && calls.length === 1, 'una página siguiente fuera de Graph no recibe el token');

    calls = setup([[has('/me/drive?$select=driveType'), () => json({ driveType: 'personal' })]]);
    const personal = await rejects(microsoft.run('excel_read_range', { item_id: 'item01', worksheet: 'Hoja1', range: 'A1:B2' }));
    assert(/onedrive_download/.test(personal?.message || '') && !calls.some((c) => c.url.includes('/workbook')), 'Excel personal explica el recorrido de descarga y no llama al libro');

    calls = setup([
      [has('/items/item01?$select'), () => json({ id: 'item01', eTag: '"e1"' })],
      [has('/me/drive?$select=driveType'), () => json({ driveType: 'business' })],
      [has('/workbook/createSession', 'POST'), () => json({ id: 'ses1' })],
      [has("range(address=", 'PATCH'), () => json({ address: 'Hoja1!A1:B1' })],
      [has('/workbook/closeSession', 'POST'), () => new Response(null, { status: 204 })],
    ]);
    const updated = await microsoft.run('excel_update_range', { item_id: 'item01', worksheet: 'Hoja1', range: 'A1:B1', values: [[1, 2]], expected_etag: '"e1"' });
    const patch = calls.find((c) => c.method === 'PATCH');
    assert(updated.address === 'Hoja1!A1:B1' && patch.headers['workbook-session-id'] === 'ses1', 'el cambio usa la sesión del libro');
    assert(calls.at(-1).url.endsWith('/workbook/closeSession'), 'la sesión del libro se cierra');
    calls = setup([[has('/items/item01?$select'), () => json({ id: 'item01', eTag: '"e2"' })]]);
    const changed = await rejects(microsoft.run('excel_update_range', { item_id: 'item01', worksheet: 'Hoja1', range: 'A1', values: [[1]], expected_etag: '"e1"' }));
    assert(/cambió/.test(changed?.message || '') && calls.length === 1, 'un libro modificado no se escribe');

    calls = setup([[has('/items/item01/content', 'PUT'), () => new Response('{}', { status: 412 })]]);
    const conflict = await rejects(microsoft.run('onedrive_upload', { draft: 'salida.pdf', replace_item_id: 'item01', expected_etag: '"e1"' }, { dir }));
    assert(calls[0].headers['If-Match'] === '"e1"' && conflict && !conflict.uncertain, 'el reemplazo exige el eTag aprobado y un conflicto no es incierto');
    const sha1 = require('node:crypto').createHash('sha1').update('%PDF-borrador').digest('hex');
    calls = setup([
      [has('/root:/salida.pdf:/content', 'PUT'), () => { throw new Error('timeout'); }],
      [has('/root:/salida.pdf?$select'), () => json({ id: 'item02', file: { hashes: { sha1Hash: sha1.toUpperCase() } } })],
    ]);
    const confirmed = await microsoft.run('onedrive_upload', { draft: 'salida.pdf' }, { dir });
    assert(confirmed.item.reconciled === true && calls[0].url.includes('conflictBehavior=fail'), 'una subida sin respuesta se confirma por su hash y nunca sobrescribe un archivo nuevo');
  } finally {
    cloud._setDeps(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  finish();
}

main().catch((err) => { console.error(err); process.exit(1); });
