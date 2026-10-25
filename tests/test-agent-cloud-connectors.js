'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assert, finish } = require('./helpers/harness');

const cloud = require('../electron/cloud-connector-common');
const google = require('../electron/google-workspace-service');
const microsoft = require('../electron/microsoft-files-service');
const gmail = require('../electron/gmail-service');
const outlook = require('../electron/microsoft-mail-service');
const github = require('../electron/github-service');
const { nativeToolSpecs } = require('../electron/agent-native-tools');

const TOKEN = 'token-secreto-123';
const SCOPES = {
  google: 'openid https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.readonly',
  microsoft: 'User.Read Files.ReadWrite Mail.Read',
  github: 'repo read:user workflow',
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
    assert(specs.length === 21, 'veintiuna herramientas cloud registradas en Conexiones');
    assert(specs.filter((spec) => spec.gated).map((spec) => spec.name).sort().join() ===
      'excel_update_range,gdrive_upload,gsheets_append,gsheets_update_range,onedrive_upload', 'solo las escrituras requieren aprobación');

    setup([]);
    const ctx = await google.context('gsheets_update_range');
    assert(ctx.account === 'google@example.com' && ctx.scopes.length === 5, 'el contexto lleva cuenta y permisos concedidos');
    assert(!JSON.stringify(ctx).includes(TOKEN), 'el contexto no contiene el token');
    setup([], { ...SCOPES, google: 'openid https://www.googleapis.com/auth/drive.readonly' });
    assert(/spreadsheets/.test((await rejects(google.context('gsheets_update_range')))?.message || ''), 'sin permiso de escritura no hay contexto ni aprobación');
    assert((await google.context('gdrive_search')).account, 'la lectura sigue disponible con drive.readonly');
    setup([], { ...SCOPES, microsoft: 'User.Read' });
    assert(!!(await rejects(microsoft.context('onedrive_get'))), 'OneDrive exige Files.Read o Files.ReadWrite');
    setup([], { ...SCOPES, google: 'openid https://www.googleapis.com/auth/drive.readonly' });
    assert(/gmail/.test((await rejects(gmail.context('gmail_search')))?.message || ''), 'Gmail exige su permiso de solo lectura');

    let calls = setup([
      [has('/gmail/v1/users/me/messages?'), () => json({ messages: [{ id: 'msg01', threadId: 't1' }], nextPageToken: 'p2' })],
      [has('/messages/msg01?format=metadata'), () => json({
        id: 'msg01', threadId: 't1', internalDate: '1700000000000', snippet: 'Hola', labelIds: ['INBOX'],
        payload: { headers: [{ name: 'From', value: 'Banco <banco@example.com>' }, { name: 'Subject', value: 'Estado' }] },
      })],
      [has('/messages/msg01?format=full'), () => json({
        id: 'msg01', threadId: 't1', internalDate: '1700000000000', snippet: 'Hola',
        payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Estado' }], parts: [
          { mimeType: 'text/plain', body: { data: Buffer.from('Cuerpo del correo').toString('base64url') } },
          { mimeType: 'application/pdf', filename: 'estado.pdf', body: { attachmentId: 'a1' } },
        ] },
      })],
    ]);
    const foundMail = await gmail.run('gmail_search', { query: 'from:banco', max_results: 5 });
    assert(foundMail.messages[0].subject === 'Estado' && foundMail.messages[0].internal_date === 1_700_000_000_000,
      'la búsqueda devuelve metadatos y fecha interna');
    assert(new URL(calls[0].url).searchParams.get('q') === 'from:banco'
      && calls[0].headers.Authorization === `Bearer ${TOKEN}`, 'la consulta viaja como q y el token solo en la cabecera');
    const mail = await gmail.run('gmail_get', { id: 'msg01' });
    assert(mail.body === 'Cuerpo del correo' && mail.has_attachments === true, 'el cuerpo se lee y el adjunto solo se anuncia');
    assert(!JSON.stringify([foundMail, mail]).includes(TOKEN), 'los correos no contienen el token');

    setup([], { ...SCOPES, microsoft: 'User.Read Files.ReadWrite' });
    assert(/Mail.Read/.test((await rejects(outlook.context('outlook_search')))?.message || ''),
      'Microsoft Mail exige su permiso de solo lectura');

    const outlookMessage = {
      id: 'AAMkAD01', conversationId: 'c1', subject: 'Estado', from: { emailAddress: { name: 'Banco', address: 'banco@example.com' } },
      toRecipients: [{ emailAddress: { address: 'yo@example.com' } }], receivedDateTime: '2026-01-01T00:00:00Z',
      bodyPreview: 'Hola', hasAttachments: true, isRead: false,
    };
    calls = setup([
      [has('/me/messages?'), () => json({ value: [outlookMessage] })],
      [has('/me/messages/AAMkAD01?'), () => json({ ...outlookMessage, body: { contentType: 'html', content: '<p>Cuerpo <b>del</b> correo</p>' } })],
    ]);
    const foundOutlook = await outlook.run('outlook_search', { from: 'banco@example.com', since: '2026-01-01T00:00:00Z' });
    assert(foundOutlook.messages[0].subject === 'Estado' && foundOutlook.messages[0].received_ms === Date.parse('2026-01-01T00:00:00Z'),
      'la búsqueda de Microsoft devuelve metadatos y fecha');
    assert(new URL(calls[0].url).searchParams.get('$filter')?.includes('receivedDateTime ge')
      && new URL(calls[0].url).searchParams.get('$filter')?.includes("'banco@example.com'"),
      'la búsqueda filtra por remitente y fecha en Graph');
    const outlookMail = await outlook.run('outlook_get', { id: 'AAMkAD01' });
    assert(outlookMail.body === 'Cuerpo del correo' && outlookMail.has_attachments === true,
      'el cuerpo HTML se convierte a texto y el adjunto solo se anuncia');
    assert(!JSON.stringify([foundOutlook, outlookMail]).includes(TOKEN), 'los correos de Microsoft no contienen el token');

    setup([], { ...SCOPES, github: 'read:user' });
    assert(/repo|public_repo/.test((await rejects(github.context('github_run_get')))?.message || ''),
      'GitHub Actions exige su permiso de lectura de repositorios');

    const workflowRun = {
      id: 42, name: 'CI', workflow_id: 7, head_branch: 'main', head_sha: 'abc', event: 'push',
      status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/app/actions/runs/42',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:05:00Z', run_attempt: 1,
    };
    calls = setup([
      [has('/repos/acme/app/actions/runs?'), () => json({ workflow_runs: [workflowRun] })],
      [has('/repos/acme/app/actions/runs/42'), () => json(workflowRun)],
    ]);
    const workflowRuns = await github.run('github_workflow_runs', { repo: 'acme/app', limit: 5 });
    assert(workflowRuns.runs[0].id === 42 && workflowRuns.runs[0].conclusion === 'success',
      'las ejecuciones de GitHub devuelven estado y conclusión');
    assert(calls[0].headers.Authorization === `Bearer ${TOKEN}` && calls[0].headers['X-GitHub-Api-Version'] === '2022-11-28',
      'GitHub recibe el token y la versión de API en cabeceras');
    const workflowRunGet = await github.run('github_run_get', { repo: 'acme/app', run_id: '42' });
    assert(workflowRunGet.run.html_url.endsWith('/42') && !JSON.stringify(workflowRunGet).includes(TOKEN),
      'una ejecución concreta se consulta sin secretos');

    calls = setup([
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
