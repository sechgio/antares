'use strict';

const cloud = require('./cloud-connector-common');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ITEM_FIELDS = 'id,name,size,eTag,cTag,lastModifiedDateTime,file,folder,parentReference,webUrl';
const READ = ['Files.Read', 'Files.ReadWrite', 'Files.Read.All', 'Files.ReadWrite.All'];
const WRITE = ['Files.ReadWrite', 'Files.ReadWrite.All'];
const PERSONAL = 'Las APIs de libro de Excel no admiten OneDrive personal: descarga el archivo con onedrive_download, '
  + 'léelo con file_read y sube el cambio con onedrive_upload indicando su eTag';
const ITEM = { type: 'object', properties: { item_id: { type: 'string' } }, required: ['item_id'] };
const TOOLS = {
  onedrive_search: ['Buscar o listar archivos de OneDrive', {
    type: 'object', properties: {
      query: { type: 'string', description: 'Texto a buscar' },
      folder_id: { type: 'string', description: 'Carpeta cuyo contenido listar' },
      page_size: { type: 'integer', minimum: 1, maximum: 100 },
      next_page: { type: 'string', description: 'next_page de la consulta anterior' },
    },
  }, false, READ],
  onedrive_get: ['Consultar metadatos y eTag de un archivo de OneDrive', ITEM, false, READ],
  onedrive_download: ['Descargar un archivo de OneDrive a los borradores', {
    type: 'object', properties: { item_id: { type: 'string' }, filename: { type: 'string' } }, required: ['item_id'],
  }, false, READ],
  onedrive_upload: ['Subir un borrador a OneDrive o reemplazar un archivo concreto', {
    type: 'object', properties: {
      draft: { type: 'string', description: 'Nombre del borrador (drafts_list)' },
      folder_id: { type: 'string', description: 'Carpeta de destino de un archivo nuevo; vacío = raíz' },
      name: { type: 'string', description: 'Nombre del archivo nuevo' },
      replace_item_id: { type: 'string', description: 'Archivo que se reemplaza' },
      expected_etag: { type: 'string', description: 'eTag leído con onedrive_get; obligatorio al reemplazar' },
    },
    required: ['draft'],
  }, true, WRITE],
  excel_worksheets: ['Listar hojas de un libro de Excel en OneDrive de trabajo o escuela', ITEM, false, READ],
  excel_read_range: ['Leer un rango de un libro de Excel en OneDrive de trabajo o escuela', {
    type: 'object', properties: { item_id: { type: 'string' }, worksheet: { type: 'string' }, range: { type: 'string', description: 'Dirección A1, p. ej. A1:D20' } },
    required: ['item_id', 'worksheet', 'range'],
  }, false, READ],
  excel_update_range: ['Actualizar un rango concreto de un libro de Excel en OneDrive de trabajo o escuela', {
    type: 'object', properties: {
      item_id: { type: 'string' }, worksheet: { type: 'string' }, range: { type: 'string' },
      values: { type: 'array', maxItems: 5000, items: { type: 'array', items: {} } },
      expected_etag: { type: 'string', description: 'eTag leído con onedrive_get' },
    },
    required: ['item_id', 'worksheet', 'range', 'values', 'expected_etag'],
  }, true, WRITE],
};

function _id(value, label) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9!_.-]{3,200}$/.test(id)) throw new Error(`${label} de OneDrive no válido`);
  return encodeURIComponent(id);
}

function _literal(value) {
  return encodeURIComponent(String(value).replace(/'/g, "''"));
}

function _request(url, options, fetchOptions) {
  if (!url.startsWith(`${GRAPH}/`)) throw new Error('Dirección de Microsoft Graph no permitida');
  return cloud.request('microsoft', 'Microsoft', url, options, fetchOptions);
}

async function context(name) {
  return cloud.accountContext('microsoft', 'Microsoft', TOOLS[name][3]);
}

function _item(itemId) {
  return _request(`${GRAPH}/me/drive/items/${_id(itemId, 'Archivo')}?$select=${ITEM_FIELDS}`);
}

async function _workbook(itemId) {
  const drive = await _request(`${GRAPH}/me/drive?$select=driveType`);
  if (drive.driveType === 'personal') throw new Error(PERSONAL);
  return `${GRAPH}/me/drive/items/${_id(itemId, 'Archivo')}/workbook`;
}

function _range(base, worksheet, range) {
  return `${base}/worksheets/${_literal(worksheet)}/range(address='${_literal(range)}')`;
}

async function search(params) {
  const top = Math.max(1, Math.min(100, Number(params.page_size) || 25));
  let url;
  if (params.next_page) {
    url = String(params.next_page);
  } else if (params.query) {
    url = `${GRAPH}/me/drive/root/search(q='${_literal(params.query)}')?$top=${top}&$select=${ITEM_FIELDS}`;
  } else {
    const parent = params.folder_id ? `items/${_id(params.folder_id, 'Carpeta')}` : 'root';
    url = `${GRAPH}/me/drive/${parent}/children?$top=${top}&$select=${ITEM_FIELDS}`;
  }
  const body = await _request(url);
  return { items: body.value || [], next_page: body['@odata.nextLink'] || null };
}

async function download(params, { dir }) {
  const item = await _item(params.item_id);
  if (!item.file) throw new Error('Solo se descargan archivos, no carpetas');
  cloud.assertSize(Number(item.size || 0));
  const res = await _request(`${GRAPH}/me/drive/items/${_id(item.id, 'Archivo')}/content`, {}, { raw: true });
  const draft = await cloud.saveDraft(dir, params.filename || item.name, Buffer.from(await res.arrayBuffer()));
  return { ...draft, source: { provider: 'microsoft', item_id: item.id, name: item.name, etag: item.eTag,
    modified_time: item.lastModifiedDateTime } };
}

async function upload(params, { dir }) {
  const draft = await cloud.readDraft(dir, params.draft);
  const replace = params.replace_item_id ? String(params.replace_item_id) : null;
  if (replace && !params.expected_etag) throw new Error('Indica expected_etag (onedrive_get) para reemplazar el archivo');
  const name = String(params.name || draft.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const parent = params.folder_id ? `items/${_id(params.folder_id, 'Carpeta')}` : 'root';
  const url = replace
    ? `${GRAPH}/me/drive/items/${_id(replace, 'Archivo')}/content`
    : `${GRAPH}/me/drive/${parent}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=fail`;
  const item = await cloud.write(
    () => _request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...(replace ? { 'If-Match': String(params.expected_etag) } : {}) },
      body: draft.bytes,
    }),
    async () => {
      const current = replace ? await _item(replace)
        : await _request(`${GRAPH}/me/drive/${parent}:/${encodeURIComponent(name)}?$select=${ITEM_FIELDS}`);
      const sha1 = current.file?.hashes?.sha1Hash;
      return sha1 && sha1.toLowerCase() === draft.sha1 ? current : null;
    },
  );
  return { item, replaced: Boolean(replace), draft: draft.name, sha256: draft.sha256 };
}

async function updateRange(params) {
  const values = cloud.matrix(params.values);
  const current = await _item(params.item_id);
  if (current.eTag !== params.expected_etag) {
    throw new Error('El libro cambió en OneDrive desde que se consultó; vuelve a leerlo y pide una nueva aprobación');
  }
  const base = await _workbook(params.item_id);
  const target = _range(base, params.worksheet, params.range);
  const json = { 'Content-Type': 'application/json' };
  const session = await _request(`${base}/createSession`, { method: 'POST', headers: json, body: JSON.stringify({ persistChanges: true }) });
  const headers = { ...json, 'workbook-session-id': String(session.id) };
  try {
    const body = await cloud.write(
      () => _request(target, { method: 'PATCH', headers, body: JSON.stringify({ values }) }),
      async () => {
        const read = await _request(`${target}?$select=address,values`);
        return cloud.sameValues(read.values, values) ? { address: read.address } : null;
      },
    );
    return { item_id: String(params.item_id), address: body.address, ...(body.reconciled ? { reconciled: true } : {}) };
  } finally {
    await _request(`${base}/closeSession`, { method: 'POST', headers, body: '{}' }).catch(() => {});
  }
}

async function run(name, params = {}, options = {}) {
  switch (name) {
    case 'onedrive_search': return search(params);
    case 'onedrive_get': return { item: await _item(params.item_id) };
    case 'onedrive_download': return download(params, options);
    case 'onedrive_upload': return upload(params, options);
    case 'excel_worksheets': {
      const body = await _request(`${await _workbook(params.item_id)}/worksheets?$select=id,name,position,visibility`);
      return { item_id: String(params.item_id), worksheets: body.value || [] };
    }
    case 'excel_read_range': {
      const body = await _request(`${_range(await _workbook(params.item_id), params.worksheet, params.range)}?$select=address,values,rowCount,columnCount`);
      return { item_id: String(params.item_id), address: body.address, values: body.values || [] };
    }
    case 'excel_update_range': return updateRange(params);
    default: throw new Error(`Herramienta de Microsoft no disponible: ${name}`);
  }
}

module.exports = { TOOLS, context, run };
