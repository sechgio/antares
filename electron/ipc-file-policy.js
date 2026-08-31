const fs = require('fs');
const path = require('path');

// These legacy backend handlers use `path` for a destination. All other
// absolute read paths must already be approved by a native file dialog.
const RAW_OUTPUT_PATH_METHODS = new Set([
  'db_export',
  'db_template',
  'panel_aviso_corte_template',
  'spreadsheet_export_volantes_template',
]);
const RAW_OUTPUT_PATH_KEYS = new Set(['path']);

// Read paths are declared at the IPC boundary instead of inferred from every
// arbitrary object key. This keeps flexible document payloads intact while
// making filesystem reads explicit and consistently resolvable.
const READ_FILE_TOKEN_SCHEMAS = new Map([
  ['process_start', [['files', '*'], ['mapping_path']]],
  ['preview', [['files', '*'], ['mapping_path']]],
  ['is_video', [['path']]],
  ['db_detect_key_column', [['files', '*']]],
  ['db_import', [['path']]],
  ['db_parse_mapping', [['path'], ['files', '*']]],
  ['db_validate_mapping', [['files', '*']]],
  ['spreadsheet_parse', [['file_token'], ['path'], ['excelPath']]],
  ['spreadsheet_get_rows', [['result_file_token'], ['cache_token']]],
  ['generar_ubicaciones', [['excelPath']]],
  ['preview_ubicacion', [['excelPath']]],
  ['panel_aviso_corte_render_pdf', [['image_paths', '*']]],
  ['evidencia_volanteo_render', [['image_paths', '*']]],
  ['informes_v2_render_html', [['images', '*', 'path']]],
  ['informes_v2_render_consolidated_html', [['images_by_id', '*', '*', 'path']]],
  ['canvas_export_cmyk_pdf', [['localImagePaths', '*']]],
  ['html_to_pdf', [['localImagePaths', '*']]],
  ['local_thumbnail', [['path']]],
  ['local_image_data_url', [['path']]],
  ['sellador_inspect_pdf', [['pdf_path']]],
  ['sellador_render_page', [['pdf_path']]],
  ['sellador_apply', [['pdf_path'], ['stamp_path']]],
]);

const READ_TOKEN_RE = /^antares-read_[A-Za-z0-9]+$/;
const LEGACY_READ_TOKEN_KEYS = [
  'file_token',
  'fileToken',
  'excel_file_token',
  'excelPath',
  'spreadsheet_token',
  'result_file_token',
  'cache_token',
];

function schemaTransform(value, segments, transform, keyPath = []) {
  if (segments.length === 0) return transform(value, keyPath);
  const [segment, ...rest] = segments;
  if (segment === '*') {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((child, index) => {
        const transformed = schemaTransform(child, rest, transform, [...keyPath, String(index)]);
        changed ||= transformed !== child;
        return transformed;
      });
      return changed ? next : value;
    }
    if (value && typeof value === 'object') {
      let changed = false;
      const next = { ...value };
      for (const [key, child] of Object.entries(value)) {
        const transformed = schemaTransform(child, rest, transform, [...keyPath, key]);
        changed ||= transformed !== child;
        next[key] = transformed;
      }
      return changed ? next : value;
    }
    return value;
  }
  if (!value || typeof value !== 'object' || !(segment in value)) return value;
  const child = value[segment];
  const transformed = schemaTransform(child, rest, transform, [...keyPath, segment]);
  return transformed === child ? value : { ...value, [segment]: transformed };
}

function collectSchemaValues(value, segments, values) {
  if (segments.length === 0) {
    values.push(value);
    return;
  }
  const [segment, ...rest] = segments;
  if (segment === '*') {
    if (Array.isArray(value)) {
      for (const child of value) collectSchemaValues(child, rest, values);
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) collectSchemaValues(child, rest, values);
    }
    return;
  }
  if (value && typeof value === 'object' && segment in value) {
    collectSchemaValues(value[segment], rest, values);
  }
}

function resolveReadPathValue(
  value,
  label,
  webContentsId,
  { allowLogical = false, allowRegistered = false } = {},
) {
  if (value === undefined || value === null || value === '') return value;
  if (typeof value !== 'string') throw new Error(`file token required for ${label}`);
  if (READ_TOKEN_RE.test(value)) {
    try {
      return require('./file-capabilities').resolveCapability(value, 'read', webContentsId).path;
    } catch (err) {
      throw new Error(`invalid file token for ${label}: ${err.message}`);
    }
  }
  if (
    allowLogical
    && (value.startsWith('canvas-asset:') || value.startsWith('data:') || value.startsWith('antares-local-image:'))
  ) {
    return value;
  }
  if (allowRegistered && path.isAbsolute(value)) {
    try {
      return require('./path-allowlist').assertAllowedReadPath(value);
    } catch {
      throw new Error(`raw read path not allowed for ${label}; use file token`);
    }
  }
  throw new Error(`raw read path not allowed for ${label}; use file token`);
}

function maybeResolveFileTokens(params, win, method) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const { _assertNoRawAbsolutePaths } = require('./file-capabilities');
  const allowRawAbsolutePathKeys = RAW_OUTPUT_PATH_METHODS.has(method)
    ? RAW_OUTPUT_PATH_KEYS
    : undefined;
  _assertNoRawAbsolutePaths(params, {
    // Native dialogs already approve their returned paths. Keep accepting
    // those paths while callers migrate to staged read tokens.
    allowRegisteredReadPaths: true,
    allowRawAbsolutePathKeys,
  });
  const webContentsId = win && win.webContents ? win.webContents.id : null;
  const schemas = READ_FILE_TOKEN_SCHEMAS.get(method) || [];
  let next = params;
  for (const schema of schemas) {
    const allowLogical = schema[0] === 'localImagePaths' || schema[0] === 'images' || schema[0] === 'images_by_id';
    next = schemaTransform(
      next,
      schema,
      (value, keyPath) => resolveReadPathValue(
        value,
        keyPath.join('.'),
        webContentsId,
        { allowLogical, allowRegistered: true },
      ),
    );
  }

  // Preserve the spreadsheet/result-file internal contract: handlers consume
  // a real path through this private field, while the renderer sees a token.
  for (const key of ['file_token', 'result_file_token', 'cache_token']) {
    const value = params[key];
    if (!READ_TOKEN_RE.test(String(value || ''))) continue;
    const cap = require('./file-capabilities').resolveCapability(value, 'read', webContentsId);
    if (next === params) next = { ...params };
    next._resolved_file_token_path = cap.path;
    if (cap.name) next._resolved_file_token_name = cap.name;
  }

  // localImagePaths may carry read tokens regardless of the method schema.
  const rawLocal = params.localImagePaths;
  if (rawLocal && typeof rawLocal === 'object' && !Array.isArray(rawLocal)) {
    const resolvedLocal = { ...rawLocal };
    let localMutated = false;
    for (const [key, value] of Object.entries(rawLocal)) {
      if (typeof value !== 'string' || !READ_TOKEN_RE.test(value)) continue;
      try {
        resolvedLocal[key] = require('./file-capabilities').resolveCapability(value, 'read', webContentsId).path;
        localMutated = true;
      } catch (err) {
        throw new Error(`invalid file token for localImagePaths.${key}: ${err.message}`);
      }
    }
    if (localMutated) {
      if (next === params) next = { ...params };
      next.localImagePaths = resolvedLocal;
    }
  }

  // Legacy token fields stay supported even when a method has no schema yet.
  let legacyMutated = false;
  for (const key of ['excelPath', 'fileToken', 'excel_file_token', 'spreadsheet_token']) {
    const value = next && typeof next === 'object' ? next[key] : undefined;
    if (typeof value !== 'string' || !READ_TOKEN_RE.test(value)) continue;
    try {
      const cap = require('./file-capabilities').resolveCapability(value, 'read', webContentsId);
      if (!legacyMutated) { next = { ...next }; legacyMutated = true; }
      next[key] = cap.path;
    } catch (err) {
      throw new Error(`invalid file token for ${key}: ${err.message}`);
    }
  }
  if (Array.isArray(next && next.file_tokens)) {
    const resolvedTokens = [];
    let tokensMutated = false;
    for (const token of next.file_tokens) {
      if (typeof token === 'string' && READ_TOKEN_RE.test(token)) {
        try {
          resolvedTokens.push(require('./file-capabilities').resolveCapability(token, 'read', webContentsId).path);
          tokensMutated = true;
        } catch (err) {
          throw new Error(`invalid file token in file_tokens: ${err.message}`);
        }
      } else {
        resolvedTokens.push(token);
      }
    }
    if (tokensMutated) {
      if (!legacyMutated) { next = { ...next }; legacyMutated = true; }
      next.file_tokens = resolvedTokens;
    }
  }
  return next;
}

function collectStagedTokens(method, params) {
  if (typeof method === 'string' && method.startsWith('file_token_')) return [];
  if (!params || typeof params !== 'object') return [];

  const candidates = [];
  for (const schema of READ_FILE_TOKEN_SCHEMAS.get(method) || []) {
    collectSchemaValues(params, schema, candidates);
  }
  for (const key of LEGACY_READ_TOKEN_KEYS) candidates.push(params[key]);
  if (Array.isArray(params.file_tokens)) candidates.push(...params.file_tokens);
  if (params.localImagePaths && typeof params.localImagePaths === 'object' && !Array.isArray(params.localImagePaths)) {
    candidates.push(...Object.values(params.localImagePaths));
  }

  const tokens = new Set();
  for (const value of candidates) {
    if (typeof value === 'string' && READ_TOKEN_RE.test(value)) tokens.add(value);
  }
  return [...tokens];
}

async function cleanupStagedTokens(tokens, webContentsId = null) {
  if (!tokens || tokens.length === 0) return;
  const { cleanupStagedCapability } = require('./file-capabilities');
  await Promise.all(tokens.map((token) => cleanupStagedCapability(token, webContentsId)));
}

function validateAndResolveWriteParams(params, win, method) {
  if (!params || typeof params !== 'object') return params;
  const legacyPathIsOutput = RAW_OUTPUT_PATH_METHODS.has(method) && typeof params.path === 'string';
  const needsWrite = 'output_path' in params
    || 'outputPath' in params
    || 'output_dir' in params
    || 'outputDir' in params
    || 'output_folder' in params
    || 'outputFolder' in params
    || legacyPathIsOutput;
  if (!needsWrite) return params;
  const outRaw = params.output_path
    || params.outputPath
    || params.output_dir
    || params.outputDir
    || params.output_folder
    || params.outputFolder
    || params.path;
  // Token format is `antares-write_<uuid>` (file-capabilities._newToken uses an
  // underscore separator). Match the exact prefix so a legitimate folder named
  // e.g. `antares-write-notes` is not mistaken for a token.
  if (typeof outRaw === 'string' && outRaw.startsWith('antares-write_')) {
    const { resolveCapability } = require('./file-capabilities');
    const webContentsId = win && win.webContents ? win.webContents.id : null;
    try {
      const cap = resolveCapability(outRaw, 'write', webContentsId);
      // Rewrite the raw field the backend reads (outputDir stays a real path
      // for handlers that consume it directly).
      const next = { ...params, _resolved_output_path: cap.path, _write_token: outRaw };
      if ('outputDir' in params) next.outputDir = cap.path;
      if ('output_dir' in params) next.output_dir = cap.path;
      return next;
    } catch (e) {
      throw new Error(`invalid write token: ${e.message}`);
    }
  }
  if (typeof outRaw === 'string' && outRaw.trim()) {
    const { isPathInside, isAllowedReadPath } = require('./path-allowlist');
    try {
      const resolved = path.resolve(outRaw);
      // Reject if the file itself is a symlink/reparse point.
      if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
        throw new Error('symlink no permitido en ruta de salida');
      }
      const dir = fs.existsSync(resolved)
        ? (fs.lstatSync(resolved).isDirectory() ? resolved : path.dirname(resolved))
        : path.dirname(resolved);
      let allowed = false;
      try {
        const { app } = require('electron');
        for (const name of ['documents', 'downloads']) {
          try {
            const stdRoot = app.getPath(name);
            if (stdRoot && isPathInside(stdRoot, dir)) { allowed = true; break; }
          } catch { /* ignore */ }
        }
      } catch { /* Electron unavailable in unit tests */ }
      if (!allowed) {
        // Folders chosen through native dialogs are registered write roots.
        const { isUnderAllowedWriteRoot } = require('./dialog-handlers');
        if (isUnderAllowedWriteRoot(dir)) allowed = true;
      }
      if (!allowed && !isAllowedReadPath(resolved) && !isAllowedReadPath(dir)) {
        throw new Error('La ruta de salida no está permitida. Usa el diálogo de guardado.');
      }
      const real = fs.realpathSync(dir);
      if (real !== dir) throw new Error('symlink no permitido en ruta de salida');
      // Also verify the full resolved path when it already exists.
      if (fs.existsSync(resolved) && fs.realpathSync(resolved) !== resolved) {
        throw new Error('symlink no permitido en ruta de salida');
      }
    } catch (e) {
      if (e.message.includes('no está permitida') || e.message.includes('symlink')) throw e;
      throw new Error(`ruta de salida no permitida: ${e.message}`);
    }
  }
  return params;
}

module.exports = {
  _maybeResolveFileTokens: maybeResolveFileTokens,
  _collectStagedTokens: collectStagedTokens,
  _cleanupStagedTokens: cleanupStagedTokens,
  _validateAndResolveWriteParams: validateAndResolveWriteParams,
};
