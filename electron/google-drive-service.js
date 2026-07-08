const { getValidTokens, refreshAccessToken } = require('./google-sheets-service');
const { fetchWithRetry } = require('./autoimg-google-fetch');
const nis = require('./autoimg-nis');

const IMAGE_MIME = "mimeType contains 'image/'";
const FOLDER_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;

const DRIVE_SHARED_PARAMS = {
  supportsAllDrives: 'true',
  includeItemsFromAllDrives: 'true',
};

async function _driveFetch(path, params = {}, retried = false) {
  const tokens = await getValidTokens();
  if (!tokens) throw new Error('No autenticado con Google');
  const qs = new URLSearchParams({ ...DRIVE_SHARED_PARAMS, ...params });
  const url = `https://www.googleapis.com/drive/v3/${path}?${qs.toString()}`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }, { rateLimitMessage: 'Rate limit excedido en Drive API' });
  if (res.status === 401 && !retried && tokens.refresh_token) {
    await refreshAccessToken(tokens);
    return _driveFetch(path, params, true);
  }
  if (!res.ok) throw new Error(`Drive API error (${res.status}): ${await res.text()}`);
  return res.json();
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
      q: `'${safeId}' in parents and trashed=false and ${IMAGE_MIME}`,
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

async function getDriveStatus() {
  const tokens = await getValidTokens();
  return { connected: !!tokens };
}

module.exports = {
  listFolder,
  scanNis,
  assertDriveFolder,
  verifyFolder,
  getDriveStatus,
  parseFolderId,
  assertValidFolderId,
  ...nis,
};