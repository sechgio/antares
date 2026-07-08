const { getValidTokens, refreshAccessToken } = require('./google-sheets-service');
const { fetchWithRetry } = require('./autoimg-google-fetch');
const nis = require('./autoimg-nis');

// Prefer MIME image/*, also catch common photo extensions when Drive marks them as octet-stream.
const IMAGE_QUERY =
  "(mimeType contains 'image/' or name contains '.jpg' or name contains '.jpeg' or name contains '.png' or name contains '.webp' or name contains '.JPG' or name contains '.JPEG' or name contains '.PNG')";
const FOLDER_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;
const FILE_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;

const DRIVE_SHARED_PARAMS = {
  supportsAllDrives: 'true',
  includeItemsFromAllDrives: 'true',
};

async function _driveRequest(path, { method = 'GET', params = {}, body } = {}, retried = false) {
  const tokens = await getValidTokens();
  if (!tokens) throw new Error('No autenticado con Google');
  const qs = new URLSearchParams({ ...DRIVE_SHARED_PARAMS, ...params });
  const url = `https://www.googleapis.com/drive/v3/${path}?${qs.toString()}`;
  const headers = { Authorization: `Bearer ${tokens.access_token}` };
  const options = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetchWithRetry(url, options, {
    rateLimitMessage: 'Rate limit excedido en Drive API',
  });
  if (res.status === 401 && !retried && tokens.refresh_token) {
    await refreshAccessToken(tokens);
    return _driveRequest(path, { method, params, body }, true);
  }
  if (!res.ok) throw new Error(`Drive API error (${res.status}): ${await res.text()}`);
  if (res.status === 204) return {};
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

async function _driveFetch(path, params = {}) {
  return _driveRequest(path, { method: 'GET', params });
}

function parseFolderId(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;
  if (FOLDER_ID_RE.test(trimmed) && !trimmed.includes('/')) return trimmed;
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/drive\/u\/\d+\/folders\/([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && FOLDER_ID_RE.test(match[1])) return match[1];
  }
  return null;
}

function assertValidFolderId(input) {
  const id = parseFolderId(input);
  if (!id) throw new Error('ID de carpeta de Drive inválido');
  return id;
}

async function listFolder(folderId, { onPage } = {}) {
  const safeId = assertValidFolderId(folderId);
  const files = [];
  let pageToken = '';
  do {
    const data = await _driveFetch('files', {
      q: `'${safeId}' in parents and trashed=false and ${IMAGE_QUERY}`,
      fields: 'nextPageToken,files(id,name,modifiedTime,mimeType)',
      pageSize: '200',
      ...(pageToken ? { pageToken } : {}),
    });
    const pageFiles = data.files || [];
    for (const f of pageFiles) {
      files.push({ id: f.id, name: f.name, modifiedTime: f.modifiedTime });
    }
    if (onPage) {
      onPage({
        pageFiles,
        totalSoFar: files.length,
        hasMore: Boolean(data.nextPageToken),
      });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function scanNis(folderId, folderName = '') {
  const files = await listFolder(folderId);
  return { nis_map: nis.buildNisMap(files, folderName) };
}

async function assertDriveFolder(input) {
  const folderId = assertValidFolderId(input);
  const meta = await _driveFetch(`files/${folderId}`, { fields: 'id,name,mimeType' });
  if (meta.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('El ID no corresponde a una carpeta de Drive');
  }
  return { folder_id: meta.id, name: meta.name || '' };
}

async function verifyFolder(input) {
  const folderId = assertValidFolderId(input);
  const meta = await _driveFetch(`files/${folderId}`, { fields: 'id,name,mimeType' });
  if (meta.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('El ID no corresponde a una carpeta de Drive');
  }
  const files = await listFolder(folderId);
  return {
    accessible: true,
    folder_id: meta.id,
    name: meta.name,
    image_count: files.length,
    sample_files: files.slice(0, 5).map((f) => f.name),
  };
}

/**
 * Copia un archivo a otra carpeta con nuevo nombre (no mueve el original).
 * Requiere scope Drive de escritura (no solo drive.readonly).
 */
async function copyFileToFolder(fileId, destFolderId, newName) {
  const id = String(fileId || '').trim();
  if (!FILE_ID_RE.test(id)) throw new Error('ID de archivo de Drive inválido');
  const dest = assertValidFolderId(destFolderId);
  const name = String(newName || '').trim();
  if (!name) throw new Error('Nombre de destino vacío');

  return _driveRequest(`files/${encodeURIComponent(id)}/copy`, {
    method: 'POST',
    params: {
      supportsAllDrives: 'true',
      fields: 'id,name,parents',
    },
    body: {
      name,
      parents: [dest],
    },
  });
}

function escapeDriveQueryValue(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Busca una subcarpeta por nombre exacto bajo parent; si no existe, la crea.
 * @returns {{ folder_id: string, name: string, created: boolean }}
 */
async function findOrCreateSubfolder(parentFolderId, folderName) {
  const parent = assertValidFolderId(parentFolderId);
  const name = String(folderName || '').trim();
  if (!name) throw new Error('Nombre de subcarpeta vacío');

  const q =
    `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' ` +
    `and name='${escapeDriveQueryValue(name)}' and trashed=false`;

  const existing = await _driveFetch('files', {
    q,
    fields: 'files(id,name)',
    pageSize: '5',
    spaces: 'drive',
  });
  const hit = (existing.files || [])[0];
  if (hit?.id) {
    return { folder_id: hit.id, name: hit.name || name, created: false };
  }

  const created = await _driveRequest('files', {
    method: 'POST',
    params: {
      supportsAllDrives: 'true',
      fields: 'id,name',
    },
    body: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parent],
    },
  });
  if (!created?.id) throw new Error(`No se pudo crear la carpeta "${name}"`);
  return { folder_id: created.id, name: created.name || name, created: true };
}

async function getDriveStatus() {
  const tokens = await getValidTokens();
  return { connected: !!tokens };
}

module.exports = {
  listFolder,
  scanNis,
  assertDriveFolder,
  verifyFolder,
  copyFileToFolder,
  findOrCreateSubfolder,
  escapeDriveQueryValue,
  getDriveStatus,
  parseFolderId,
  assertValidFolderId,
  ...nis,
};
