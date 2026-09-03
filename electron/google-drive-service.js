const { getValidTokens, refreshAccessToken } = require('./google-sheets-service');
const { fetchWithRetry } = require('./autoimg-google-fetch');
const nis = require('./autoimg-nis');
const {
  getActiveUserSnapshot,
  isActiveUserSnapshotCurrent,
  onActiveUserChange,
} = require('./autoimg-user-scope');

const IMAGE_QUERY =
  "(mimeType contains 'image/' or name contains '.jpg' or name contains '.jpeg' or name contains '.png' or name contains '.webp' or name contains '.JPG' or name contains '.JPEG' or name contains '.PNG')";
const FOLDER_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;
const FILE_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;

const DRIVE_SHARED_PARAMS = {
  supportsAllDrives: 'true',
  includeItemsFromAllDrives: 'true',
};

const SESSION_CHANGED_MESSAGE = 'La sesión de Google cambió durante la operación.';

function _assertSessionCurrent(session) {
  if (!isActiveUserSnapshotCurrent(session)) throw new Error(SESSION_CHANGED_MESSAGE);
}

async function _driveRequest(
  path,
  { method = 'GET', params = {}, body } = {},
  retried = false,
  session = getActiveUserSnapshot(),
) {
  const tokens = await getValidTokens(session);
  if (!tokens) throw new Error('No autenticado con Google');
  _assertSessionCurrent(session);
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
    await refreshAccessToken(tokens, session);
    return _driveRequest(path, { method, params, body }, true, session);
  }
  if (!res.ok) throw new Error(`Drive API error (${res.status}): ${await res.text()}`);
  if (res.status === 204) {
    _assertSessionCurrent(session);
    return {};
  }
  const text = await res.text();
  if (!text) {
    _assertSessionCurrent(session);
    return {};
  }
  const result = JSON.parse(text);
  _assertSessionCurrent(session);
  return result;
}

async function _driveFetch(path, params = {}, session = getActiveUserSnapshot()) {
  return _driveRequest(path, { method: 'GET', params }, false, session);
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

async function listFolder(folderId, { onPage, collect = true } = {}) {
  const safeId = assertValidFolderId(folderId);
  const files = collect ? [] : null;
  let totalSoFar = 0;
  let pageToken = '';
  do {
    const data = await _driveFetch('files', {
      q: `'${safeId}' in parents and trashed=false and ${IMAGE_QUERY}`,
      fields: 'nextPageToken,files(id,name,modifiedTime,mimeType)',
      pageSize: '200',
      ...(pageToken ? { pageToken } : {}),
    });
    const pageFiles = (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
    }));
    totalSoFar += pageFiles.length;
    if (files) {
      for (const f of pageFiles) files.push(f);
    }
    if (onPage) {
      onPage({
        pageFiles,
        totalSoFar,
        hasMore: Boolean(data.nextPageToken),
      });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files || [];
}

async function scanNis(folderId, folderName = '') {
  const nisMap = {};
  await listFolder(folderId, {
    collect: false,
    onPage: ({ pageFiles }) => {
      nis.accumulateNisFiles(nisMap, pageFiles, folderName);
    },
  });
  return { nis_map: nis.finalizeNisMap(nisMap) };
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
  const data = await _driveFetch('files', {
    q: `'${folderId}' in parents and trashed=false and ${IMAGE_QUERY}`,
    fields: 'nextPageToken,files(name)',
    pageSize: '200',
  });
  const pageFiles = data.files || [];
  const hasMore = Boolean(data.nextPageToken);
  return {
    accessible: true,
    folder_id: meta.id,
    name: meta.name,
    image_count: pageFiles.length,
    has_more: hasMore,
    sample_files: pageFiles.slice(0, 5).map((f) => f.name || ''),
  };
}

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

const PREVIEW_LIMIT = 4;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const PREVIEW_CACHE_MAX = 30;
const previewCache = new Map();

function _previewCacheKey(session, folderId, pageSize) {
  return `${session.userKey || 'anonymous'}:${folderId}:${pageSize}`;
}

function _setPreviewCache(cacheKey, entry) {
  if (previewCache.has(cacheKey)) previewCache.delete(cacheKey);
  previewCache.set(cacheKey, entry);
  while (previewCache.size > PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    previewCache.delete(oldest);
  }
}

onActiveUserChange(() => {
  previewCache.clear();
});

function shrinkThumbnailUrl(url) {
  const raw = String(url || '');
  if (!raw) return raw;
  if (/=s\d+$/.test(raw)) return raw.replace(/=s\d+$/, '=s96');
  if (/=w\d+/.test(raw)) return raw.replace(/=w\d+(-h\d+)?/, '=s96');
  return `${raw}=s96`;
}

async function fetchThumbnailDataUrl(thumbnailLink, accessToken) {
  const url = shrinkThumbnailUrl(thumbnailLink);
  let res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    res = await fetchWithRetry(url);
  }
  if (!res.ok) throw new Error(`Thumb HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 250_000) throw new Error('Thumb demasiado grande');
  const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function previewFolder(input, { limit = PREVIEW_LIMIT, force = false } = {}) {
  const folderId = assertValidFolderId(input);
  const session = getActiveUserSnapshot();
  const tokens = await getValidTokens(session);
  if (!tokens) throw new Error('No autenticado con Google');
  _assertSessionCurrent(session);

  const pageSize = Math.min(Math.max(1, Number(limit) || PREVIEW_LIMIT), PREVIEW_LIMIT);
  const cacheKey = _previewCacheKey(session, folderId, pageSize);
  const cached = previewCache.get(cacheKey);
  if (!force && cached) {
    if (Date.now() - cached.at < PREVIEW_TTL_MS) {
      previewCache.delete(cacheKey);
      previewCache.set(cacheKey, cached);
      return cached.result;
    }
    previewCache.delete(cacheKey);
  }

  const data = await _driveFetch('files', {
    q: `'${folderId}' in parents and trashed=false and ${IMAGE_QUERY}`,
    fields: 'files(id,name,thumbnailLink)',
    pageSize: String(pageSize),
  }, session);
  const files = (data.files || []).slice(0, pageSize);

  const thumbs = await Promise.all(
    files.map(async (f) => {
      if (!f.thumbnailLink) return { id: f.id, name: f.name || '', dataUrl: null };
      try {
        const dataUrl = await fetchThumbnailDataUrl(f.thumbnailLink, tokens.access_token);
        return { id: f.id, name: f.name || '', dataUrl };
      } catch {
        return { id: f.id, name: f.name || '', dataUrl: null };
      }
    }),
  );

  _assertSessionCurrent(session);
  const result = { folder_id: folderId, thumbs };
  _setPreviewCache(cacheKey, { at: Date.now(), result });
  return result;
}

function invalidateFolderPreview(folderId) {
  const id = String(folderId || '').trim();
  if (!id) return;
  const prefix = `${getActiveUserSnapshot().userKey || 'anonymous'}:${id}:`;
  for (const key of previewCache.keys()) {
    if (key.startsWith(prefix)) previewCache.delete(key);
  }
}

async function getFileMetadata(fileId, fields = 'id,name,modifiedTime,version') {
  const id = String(fileId || '').trim();
  if (!FILE_ID_RE.test(id)) throw new Error('ID de archivo de Drive inválido');
  return _driveFetch(`files/${encodeURIComponent(id)}`, { fields });
}

module.exports = {
  listFolder,
  scanNis,
  assertDriveFolder,
  verifyFolder,
  previewFolder,
  invalidateFolderPreview,
  getFileMetadata,
  copyFileToFolder,
  findOrCreateSubfolder,
  getDriveStatus,
  assertValidFolderId,
  ...nis,
};
