const fs = require('fs');
const path = require('path');
const ipcCatalog = require('../shared/ipc-method-catalog');

const RAW_OUTPUT_PATH_METHODS = ipcCatalog.RAW_OUTPUT_PATH_METHODS;
const RAW_OUTPUT_PATH_KEYS = new Set(['path']);

const READ_FILE_TOKEN_SCHEMAS = ipcCatalog.READ_FILE_TOKEN_SCHEMAS;

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
    allowRegisteredReadPaths: true,
    allowRawAbsolutePathKeys,
    writePathKeys: ipcCatalog.METHOD_OUTPUT_PATH_KEYS.get(method),
  });
  const webContentsId = win && win.webContents ? win.webContents.id : null;
  let schemas;
  if (typeof method === 'string' && READ_FILE_TOKEN_SCHEMAS.has(method)) {
    schemas = READ_FILE_TOKEN_SCHEMAS.get(method);
  } else if (!method) {
    const seen = new Set();
    schemas = [];
    for (const v of READ_FILE_TOKEN_SCHEMAS.values()) {
      for (const s of v) {
        const key = JSON.stringify(s);
        if (!seen.has(key)) {
          seen.add(key);
          schemas.push(s);
        }
      }
    }
  } else {
    schemas = [];
  }
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

  // Token stays in place; backend handlers read the resolved path/name via _resolved_file_token_*.
  for (const key of ['file_token', 'result_file_token', 'cache_token']) {
    const value = params[key];
    if (!READ_TOKEN_RE.test(String(value || ''))) continue;
    const cap = require('./file-capabilities').resolveCapability(value, 'read', webContentsId);
    if (next === params) next = { ...params };
    next._resolved_file_token_path = cap.path;
    if (cap.name) next._resolved_file_token_name = cap.name;
  }

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
  const seenSchemas = new Set();
  for (const schemas of READ_FILE_TOKEN_SCHEMAS.values()) {
    for (const schema of schemas) {
      const key = JSON.stringify(schema);
      if (seenSchemas.has(key)) continue;
      seenSchemas.add(key);
      collectSchemaValues(params, schema, candidates);
    }
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

const GENERIC_OUTPUT_KEYS = [
  'output_path',
  'outputPath',
  'output_dir',
  'outputDir',
  'output_folder',
  'outputFolder',
];

function _assertAllowedRawOutputPath(outRaw) {
  const { isAllowedReadPath } = require('./path-allowlist');
  try {
    const resolved = path.resolve(outRaw);
    if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
      throw new Error('symlink no permitido en ruta de salida');
    }
    const dir = fs.existsSync(resolved)
      ? (fs.lstatSync(resolved).isDirectory() ? resolved : path.dirname(resolved))
      : path.dirname(resolved);
    const { isUnderAllowedWriteRoot } = require('./dialog-handlers');
    if (!isUnderAllowedWriteRoot(dir) && !isAllowedReadPath(resolved) && !isAllowedReadPath(dir)) {
      throw new Error('La ruta de salida no está permitida. Usa el diálogo de guardado.');
    }
    const { hasSymlinkAncestor } = require('./path-allowlist');
    if (hasSymlinkAncestor(resolved)) {
      throw new Error('symlink no permitido en ruta de salida');
    }
  } catch (e) {
    if (e.message.includes('no está permitida') || e.message.includes('symlink')) throw e;
    throw new Error(`ruta de salida no permitida: ${e.message}`);
  }
}

function validateAndResolveWriteParams(params, win, method) {
  if (!params || typeof params !== 'object') return params;
  if ('_resolved_output_path' in params || '_write_token' in params) {
    params = { ...params };
    delete params._resolved_output_path;
    delete params._write_token;
  }
  const outputKeys = [];
  const pushIfPresent = (key) => {
    const value = params[key];
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && !value.trim()) return;
    if (!outputKeys.includes(key)) outputKeys.push(key);
  };
  const methodOutputKeys = ipcCatalog.METHOD_OUTPUT_PATH_KEYS.get(method);
  if (methodOutputKeys) for (const key of methodOutputKeys) pushIfPresent(key);
  for (const key of GENERIC_OUTPUT_KEYS) pushIfPresent(key);
  if (RAW_OUTPUT_PATH_METHODS.has(method)) pushIfPresent('path');
  if (outputKeys.length === 0) return params;

  const webContentsId = win && win.webContents ? win.webContents.id : null;
  let resolvedOutputPath;
  let writeToken;
  for (const key of outputKeys) {
    const value = params[key];
    if (typeof value !== 'string') {
      throw new Error(`invalid output path for ${key}`);
    }
    if (!value.startsWith('antares-write_')) {
      _assertAllowedRawOutputPath(value);
      continue;
    }
    const { resolveCapability } = require('./file-capabilities');
    let cap;
    try {
      cap = resolveCapability(value, 'write', webContentsId);
    } catch (e) {
      throw new Error(`invalid write token: ${e.message}`);
    }
    if (resolvedOutputPath === undefined) {
      resolvedOutputPath = cap.path;
      writeToken = value;
    }
  }
  if (resolvedOutputPath === undefined) return params;
  const next = { ...params, _resolved_output_path: resolvedOutputPath, _write_token: writeToken };
  if ('outputDir' in params) next.outputDir = resolvedOutputPath;
  if ('output_dir' in params) next.output_dir = resolvedOutputPath;
  if (methodOutputKeys) {
    for (const key of methodOutputKeys) {
      if (key in params) next[key] = resolvedOutputPath;
    }
  }
  return next;
}

module.exports = {
  _maybeResolveFileTokens: maybeResolveFileTokens,
  _collectStagedTokens: collectStagedTokens,
  _cleanupStagedTokens: cleanupStagedTokens,
  _validateAndResolveWriteParams: validateAndResolveWriteParams,
};
