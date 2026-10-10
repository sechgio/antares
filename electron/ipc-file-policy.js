const fs = require('fs');
const path = require('path');
const { GENERIC_OUTPUT_PATH_KEYS } = require('./file-capabilities');
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

function resolveReadToken(token, webContentsId) {
  return require('./file-capabilities').resolveCapability(token, 'read', webContentsId);
}

function stripFlowExpressions(value) {
  if (typeof value === 'string' && value.startsWith('=')) return undefined;
  if (Array.isArray(value)) return value.map(stripFlowExpressions);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripFlowExpressions(v)]));
  return value;
}

function mergeFlowArgs(original, checked) {
  if (typeof original === 'string' && original.startsWith('=')) return original;
  if (Array.isArray(original)) return original.map((v, i) => mergeFlowArgs(v, checked?.[i]));
  if (original && typeof original === 'object') return Object.fromEntries(Object.entries({ ...original, ...checked }).map(([k]) => [k, mergeFlowArgs(original[k], checked?.[k])]));
  return checked === undefined ? original : checked;
}

function maybeResolveFileTokens(params, win, method, options = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  if ((method === 'flows_create' || method === 'flows_update') && params.graph && Array.isArray(params.graph.nodes)) {
    const outer = maybeResolveFileTokens({ ...params, graph: undefined }, win, method, options);
    return { ...outer, graph: { ...params.graph, nodes: params.graph.nodes.map((node) => {
      const config = { ...node.config };
      const verifiedGrants = options.verifiedFlowGrants?.[node.id];
      delete config._file_grants;
      if (node.kind !== 'tool_call') return { ...node, config };
      if (!config.args || typeof config.args !== 'object' || Array.isArray(config.args)) return { ...node, config };
      const readSchemas = READ_FILE_TOKEN_SCHEMAS.get(config.method) || [];
      let literal = stripFlowExpressions(config.args);
      if (verifiedGrants && Array.isArray(verifiedGrants.read)) {
        const webContentsId = win?.webContents?.id ?? null;
        const { createFileCapability } = require('./file-capabilities');
        for (const schema of readSchemas) {
          literal = schemaTransform(literal, schema, (value) => (
            typeof value === 'string' && verifiedGrants.read.includes(value)
              ? createFileCapability({
                filePath: value, mode: 'read', webContentsId,
              }).token
              : value
          ));
        }
      }
      const resolved = maybeResolveFileTokens(literal, win, config.method, { verifiedGrants });
      const written = validateAndResolveWriteParams(resolved, win, config.method, { verifiedWriteRoots: verifiedGrants?.write });
      const read = [];
      for (const schema of readSchemas) collectSchemaValues(written, schema, read);
      const write = [];
      for (const key of new Set([...GENERIC_OUTPUT_PATH_KEYS, ...(ipcCatalog.METHOD_OUTPUT_PATH_KEYS.get(config.method) || []), ...(RAW_OUTPUT_PATH_METHODS.has(config.method) ? ['path'] : [])])) {
        if (typeof written[key] === 'string' && written[key]) {
          write.push(fs.existsSync(written[key]) && fs.statSync(written[key]).isDirectory() ? written[key] : path.dirname(written[key]));
        }
      }
      config.args = mergeFlowArgs(config.args, written);
      if (read.length || write.length || written._flow_file_grants?.folders?.length) {
        config._file_grants = { ...written._flow_file_grants, read, write: [...new Set([...write, ...(written._flow_file_grants?.write || [])])] };
      }
      delete config.args._flow_file_grants;
      return { ...node, config };
    }) } };
  }
  if (method === 'flows_read_images' || method === 'flows_pdf_preview') {
    const { _isUnderRegisteredWriteRoot } = require('./write-roots');
    const { hasSymlinkAncestor } = require('./path-allowlist');
    const folders = [];
    for (const key of ['source_folder', 'output_folder']) {
      const value = params[key];
      if (!value) continue;
      const verifiedFolder = Array.isArray(options.verifiedGrants?.folders)
        && options.verifiedGrants.folders.includes(value);
      if (typeof value !== 'string' || !path.isAbsolute(value)
          || (!_isUnderRegisteredWriteRoot(value) && !verifiedFolder)
          || hasSymlinkAncestor(value) || (fs.existsSync(value) && fs.lstatSync(value).isSymbolicLink())) {
        throw new Error('Selecciona la carpeta con el diálogo de Antares');
      }
      folders.push(value);
    }
    const next = maybeResolveFileTokens({ ...params, source_folder: undefined, output_folder: undefined, spreadsheet_path: undefined, _flow_file_grants: undefined }, win, '_flows_read_images_files');
    if (params.spreadsheet_path) {
      const webContentsId = win?.webContents?.id ?? null;
      const value = options.verifiedGrants?.read?.includes(params.spreadsheet_path)
        ? require('./file-capabilities').createFileCapability({ filePath: params.spreadsheet_path, mode: 'read', webContentsId }).token
        : params.spreadsheet_path;
      next.spreadsheet_path = resolveReadPathValue(value, 'spreadsheet_path', webContentsId, { allowRegistered: true });
    }
    return { ...next, source_folder: params.source_folder, output_folder: params.output_folder,
      _flow_file_grants: { folders, read: next.spreadsheet_path ? [next.spreadsheet_path] : [], write: params.output_folder ? [params.output_folder] : [] } };
  }
  if ('_resolved_file_token_path' in params || '_resolved_file_token_name' in params) {
    params = { ...params };
    delete params._resolved_file_token_path;
    delete params._resolved_file_token_name;
  }
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
    const cap = resolveReadToken(value, webContentsId);
    if (next === params) next = { ...params };
    if (next._resolved_file_token_path && next._resolved_file_token_path !== cap.path) {
      throw new Error(`conflicting file tokens: ${key} resolves to a different path`);
    }
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
        resolvedLocal[key] = resolveReadToken(value, webContentsId).path;
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
      const cap = resolveReadToken(value, webContentsId);
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
          resolvedTokens.push(resolveReadToken(token, webContentsId).path);
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

// El fallback Documentos/Descargas rechaza archivos ejecutables para impedir
// que un renderer comprometido escriba código que Windows pueda ejecutar.
const FORBIDDEN_FALLBACK_EXTENSIONS = new Set([
  '.bat', '.cmd', '.com', '.cpl', '.dll', '.exe', '.hta', '.jar', '.js', '.jse',
  '.lnk', '.msc', '.msi', '.msp', '.ocx', '.ps1', '.psm1', '.reg', '.scr',
  '.sys', '.url', '.vbe', '.vbs', '.wsf', '.wsh',
]);

function _outputExtension(resolvedPath) {
  // Windows ignora puntos/espacios finales y trata ':' como stream alternativo:
  // "informe.exe." e "informe.exe:data" deben detectarse como ejecutables.
  const base = path.basename(resolvedPath).replace(/[ .]+$/, '');
  const colon = base.indexOf(':');
  const name = colon === -1 ? base : base.slice(0, colon);
  return path.extname(name).toLowerCase();
}

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
    const { _isUnderStandardUserDir } = require('./write-roots');
    if (!isUnderAllowedWriteRoot(dir) && !isAllowedReadPath(resolved) && !isAllowedReadPath(dir)) {
      if (!_isUnderStandardUserDir(dir)) {
        throw new Error('La ruta de salida no está permitida. Usa el diálogo de guardado.');
      }
      if (FORBIDDEN_FALLBACK_EXTENSIONS.has(_outputExtension(resolved))) {
        throw new Error('tipo de archivo no permitido en la ruta de salida');
      }
    }
    const { hasSymlinkAncestor } = require('./path-allowlist');
    if (hasSymlinkAncestor(resolved)) {
      throw new Error('symlink no permitido en ruta de salida');
    }
  } catch (e) {
    if (e.message.includes('no está permitida') || e.message.includes('no permitido') || e.message.includes('symlink')) {
      throw e;
    }
    throw new Error(`ruta de salida no permitida: ${e.message}`);
  }
}

function validateAndResolveWriteParams(params, win, method, options = {}) {
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
  for (const key of GENERIC_OUTPUT_PATH_KEYS) pushIfPresent(key);
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
      const { isPathInside, hasSymlinkAncestor } = require('./path-allowlist');
      const verifiedWrite = path.isAbsolute(value) && Array.isArray(options.verifiedWriteRoots)
        && options.verifiedWriteRoots.some((root) => (
          typeof root === 'string' && path.isAbsolute(root)
          && isPathInside(root, value)
        ));
      if (verifiedWrite) {
        if ((fs.existsSync(value) && fs.lstatSync(value).isSymbolicLink()) || hasSymlinkAncestor(value)) {
          throw new Error('symlink no permitido en ruta de salida');
        }
      } else {
        _assertAllowedRawOutputPath(value);
      }
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
