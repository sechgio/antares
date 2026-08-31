const {
  forEachReadLocation,
  isRecord,
  mapReadLocations,
} = require('./file-token-contract');

const TOKEN_METADATA_KEYS = new Set(['file_token', 'result_file_token', 'cache_token']);
const LEGACY_OUTPUT_PATH_METHODS = new Set([
  'db_export',
  'db_template',
  'spreadsheet_export_volantes_template',
  'panel_aviso_corte_template',
]);

function isReadFileToken(value) {
  return typeof value === 'string' && value.startsWith('antares-read_');
}

function resolveReadToken(value, label, resolveCapability, webContentsId) {
  if (!isReadFileToken(value)) return { value, capability: null };
  try {
    const capability = resolveCapability(value, 'read', webContentsId);
    return { value: capability.path, capability };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid file token for ${label}: ${message}`);
  }
}

function maybeResolveFileTokens(params, win, method) {
  if (!isRecord(params)) return params;

  const { resolveCapability, _assertNoRawAbsolutePaths } = require('./file-capabilities');
  _assertNoRawAbsolutePaths(params, {
    pathIsWriteTarget: LEGACY_OUTPUT_PATH_METHODS.has(method),
  });
  const webContentsId = win && win.webContents ? win.webContents.id : null;
  let metadata = null;

  const next = mapReadLocations(params, (location) => {
    const resolved = resolveReadToken(location.value, location.label, resolveCapability, webContentsId);
    if (resolved.capability && location.path.length === 1 && TOKEN_METADATA_KEYS.has(location.key)) {
      metadata = resolved.capability;
    }
    return resolved.value;
  });

  if (!metadata) return next;
  return {
    ...next,
    _resolved_file_token_path: metadata.path,
    ...(metadata.name ? { _resolved_file_token_name: metadata.name } : {}),
  };
}

function collectStagedTokens(method, params) {
  if (typeof method === 'string' && method.startsWith('file_token_')) return [];
  if (!isRecord(params)) return [];

  const tokens = new Set();
  forEachReadLocation(params, ({ value }) => {
    if (isReadFileToken(value)) tokens.add(value);
  });
  return [...tokens];
}

async function cleanupStagedTokens(tokens, webContentsId = null) {
  if (!tokens || tokens.length === 0) return;
  const { cleanupStagedCapability } = require('./file-capabilities');
  await Promise.all(tokens.map((token) => cleanupStagedCapability(token, webContentsId)));
}

module.exports = { maybeResolveFileTokens, collectStagedTokens, cleanupStagedTokens };
