'use strict';

const cloud = require('./cloud-connector-common');

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/';
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,version,md5Checksum,parents,webViewLink';
const EXPORTS = {
  'application/vnd.google-apps.document': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.presentation': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.drawing': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
};
const DRIVE_READ = ['drive.readonly', 'drive.file', 'drive'];
const SHEETS_READ = ['spreadsheets.readonly', 'spreadsheets', 'drive.readonly', 'drive'];
const TOOLS = {
  gdrive_search: ['Buscar o listar archivos de Google Drive', {
    type: 'object', properties: {
      query: { type: 'string', description: 'Texto contenido en el nombre' },
      folder_id: { type: 'string', description: 'Carpeta cuyo contenido listar' },
      page_size: { type: 'integer', minimum: 1, maximum: 100 },
      page_token: { type: 'string', description: 'next_page_token de la consulta anterior' },
    },
  }, false, DRIVE_READ],
  gdrive_get: ['Consultar metadatos y versión de un archivo de Drive', {
    type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'],
  }, false, DRIVE_READ],
  gdrive_download: ['Descargar o exportar un archivo de Drive a los borradores', {
    type: 'object', properties: { file_id: { type: 'string' }, filename: { type: 'string' } }, required: ['file_id'],
  }, false, DRIVE_READ],
  gdrive_upload: ['Subir un borrador a Drive o reemplazar un archivo concreto', {
    type: 'object', properties: {
      draft: { type: 'string', description: 'Nombre del borrador (drafts_list)' },
      folder_id: { type: 'string', description: 'Carpeta de destino para un archivo nuevo' },
      name: { type: 'string', description: 'Nombre del archivo nuevo en Drive' },
      replace_file_id: { type: 'string', description: 'Archivo que se reemplaza' },
      expected_version: { type: 'string', description: 'Versión leída con gdrive_get; obligatoria al reemplazar' },
    },
    required: ['draft'],
  }, true, ['drive.file', 'drive']],
  gsheets_metadata: ['Consultar pestañas de una hoja de Google', {
    type: 'object', properties: { spreadsheet_id: { type: 'string' } }, required: ['spreadsheet_id'],
  }, false, SHEETS_READ],
  gsheets_read: ['Leer un rango de una hoja de Google', {
    type: 'object', properties: { spreadsheet_id: { type: 'string' }, range: { type: 'string', description: 'Rango A1, p. ej. Hoja1!A1:D20' } },
    required: ['spreadsheet_id', 'range'],
  }, false, SHEETS_READ],
  gsheets_update_range: ['Actualizar un rango concreto de una hoja de Google', {
    type: 'object', properties: {
      spreadsheet_id: { type: 'string' }, range: { type: 'string' },
      values: { type: 'array', maxItems: 5000, items: { type: 'array', items: {} } },
    },
    required: ['spreadsheet_id', 'range', 'values'],
  }, true, ['spreadsheets', 'drive']],
  gsheets_append: ['Añadir filas al final de una tabla de una hoja de Google', {
    type: 'object', properties: {
      spreadsheet_id: { type: 'string' }, range: { type: 'string' },
      values: { type: 'array', maxItems: 5000, items: { type: 'array', items: {} } },
    },
    required: ['spreadsheet_id', 'range', 'values'],
  }, true, ['spreadsheets', 'drive']],
};

function _id(value, label) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(id)) throw new Error(`${label} de Google no válido`);
  return id;
}

function _q(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function _request(url, options, fetchOptions) {
  return cloud.request('google', 'Google', url, options, fetchOptions);
}

async function context(name) {
  return cloud.accountContext('google', 'Google', TOOLS[name][3].map((scope) => `${SCOPE}${scope}`));
}

async function _meta(fileId) {
  return _request(`${DRIVE}/files/${_id(fileId, 'Archivo')}?fields=${FILE_FIELDS}&supportsAllDrives=true`);
}

async function search(params) {
  const q = ['trashed = false'];
  if (params.folder_id) q.push(`'${_id(params.folder_id, 'Carpeta')}' in parents`);
  if (params.query) q.push(`name contains '${_q(params.query)}'`);
  const query = new URLSearchParams({
    q: q.join(' and '), fields: `nextPageToken,files(${FILE_FIELDS})`,
    pageSize: String(Math.max(1, Math.min(100, Number(params.page_size) || 25))),
    supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
  });
  if (params.page_token) query.set('pageToken', String(params.page_token));
  const body = await _request(`${DRIVE}/files?${query}`);
  return { files: body.files || [], next_page_token: body.nextPageToken || null };
}

async function download(params, { dir }) {
  const meta = await _meta(params.file_id);
  const exported = EXPORTS[meta.mimeType];
  if (!exported && String(meta.mimeType).startsWith('application/vnd.google-apps.')) {
    throw new Error(`Drive no permite descargar ${meta.mimeType}; elige un documento, hoja, presentación o archivo binario`);
  }
  if (!exported) cloud.assertSize(Number(meta.size || 0));
  const url = exported
    ? `${DRIVE}/files/${meta.id}/export?mimeType=${encodeURIComponent(exported[0])}`
    : `${DRIVE}/files/${meta.id}?alt=media&supportsAllDrives=true`;
  const res = await _request(url, {}, { raw: true });
  const name = params.filename || (exported ? `${meta.name}${exported[1]}` : meta.name);
  const draft = await cloud.saveDraft(dir, name, Buffer.from(await res.arrayBuffer()));
  return { ...draft, source: { provider: 'google', file_id: meta.id, name: meta.name, version: meta.version,
    modified_time: meta.modifiedTime, ...(exported ? { exported_as: exported[0] } : {}) } };
}

async function upload(params, { dir }) {
  const draft = await cloud.readDraft(dir, params.draft);
  const replace = params.replace_file_id ? _id(params.replace_file_id, 'Archivo') : null;
  if (replace) {
    if (!params.expected_version) throw new Error('Indica expected_version (gdrive_get) para reemplazar el archivo');
    const current = await _meta(replace);
    if (String(current.version) !== String(params.expected_version)) {
      throw new Error('El archivo cambió en Drive desde que se consultó; vuelve a leerlo y pide una nueva aprobación');
    }
  }
  const metadata = replace ? {} : {
    name: params.name || draft.name,
    ...(params.folder_id ? { parents: [_id(params.folder_id, 'Carpeta')] } : {}),
  };
  const started = Date.now();
  const verify = async () => {
    if (replace) {
      const after = await _meta(replace);
      return after.md5Checksum === draft.md5 ? after : null;
    }
    const q = [`name = '${_q(metadata.name)}'`, 'trashed = false', ...(metadata.parents ? [`'${metadata.parents[0]}' in parents`] : [])];
    const found = await _request(`${DRIVE}/files?${new URLSearchParams({ q: q.join(' and '), fields: `files(${FILE_FIELDS})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`);
    return (found.files || []).find((file) => file.md5Checksum === draft.md5 && Date.parse(file.modifiedTime) >= started - 60_000) || null;
  };
  const file = await cloud.write(async () => {
    const session = await _request(
      replace ? `${UPLOAD}/files/${replace}?uploadType=resumable&supportsAllDrives=true` : `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`,
      { method: replace ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(metadata) },
      { raw: true },
    );
    const location = session.headers.get('location') || '';
    if (!location.startsWith(`${UPLOAD}/`)) throw new Error('Drive no devolvió una sesión de subida válida');
    const done = await _request(location, { method: 'PUT', body: draft.bytes }, { raw: true });
    const body = await done.json();
    return _meta(body.id);
  }, verify);
  return { file, replaced: Boolean(replace), draft: draft.name, sha256: draft.sha256 };
}

async function sheetValues(spreadsheetId, range) {
  return _request(`${SHEETS}/${_id(spreadsheetId, 'Hoja')}/values/${encodeURIComponent(String(range))}?valueRenderOption=FORMATTED_VALUE`);
}

async function updateRange(params) {
  const id = _id(params.spreadsheet_id, 'Hoja');
  const values = cloud.matrix(params.values);
  const body = await cloud.write(
    () => _request(`${SHEETS}/${id}/values/${encodeURIComponent(String(params.range))}?valueInputOption=USER_ENTERED`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range: params.range, values }),
    }),
    async () => {
      const current = await sheetValues(id, params.range);
      return cloud.sameValues(current.values || [], values) ? { updatedRange: current.range } : null;
    },
  );
  return { spreadsheet_id: id, updated_range: body.updatedRange, updated_cells: body.updatedCells ?? null,
    ...(body.reconciled ? { reconciled: true } : {}) };
}

async function append(params) {
  const id = _id(params.spreadsheet_id, 'Hoja');
  // Un append perdido no se puede distinguir de un duplicado: sin
  // verificación, queda incierto y no se repite.
  const body = await cloud.write(() => _request(
    `${SHEETS}/${id}/values/${encodeURIComponent(String(params.range))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: cloud.matrix(params.values) }) },
  ));
  return { spreadsheet_id: id, updated_range: body.updates?.updatedRange || null, updated_rows: body.updates?.updatedRows ?? null };
}

async function run(name, params = {}, options = {}) {
  switch (name) {
    case 'gdrive_search': return search(params);
    case 'gdrive_get': return { file: await _meta(params.file_id) };
    case 'gdrive_download': return download(params, options);
    case 'gdrive_upload': return upload(params, options);
    case 'gsheets_metadata': {
      const body = await _request(`${SHEETS}/${_id(params.spreadsheet_id, 'Hoja')}?fields=spreadsheetId,properties.title,sheets.properties(sheetId,title,gridProperties)`);
      return { spreadsheet_id: body.spreadsheetId, title: body.properties?.title, sheets: (body.sheets || []).map((sheet) => sheet.properties) };
    }
    case 'gsheets_read': {
      const body = await sheetValues(params.spreadsheet_id, params.range);
      return { spreadsheet_id: String(params.spreadsheet_id), range: body.range, values: body.values || [] };
    }
    case 'gsheets_update_range': return updateRange(params);
    case 'gsheets_append': return append(params);
    default: throw new Error(`Herramienta de Google no disponible: ${name}`);
  }
}

module.exports = { TOOLS, context, run };
