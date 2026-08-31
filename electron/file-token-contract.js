/**
 * Explicit read-file locations in renderer -> backend payloads.
 *
 * Keep this schema narrow. These payloads also contain user-controlled
 * filenames, labels, base64 data and other strings that must never be
 * interpreted as filesystem paths by a recursive walker.
 */
const READ_FILE_TOKEN_SCHEMAS = Object.freeze({
  scalarKeys: Object.freeze([
    'path',
    'file_path',
    'filepath',
    'excelPath',
    'mapping_path',
    'pdf_path',
    'stamp_path',
  ]),
  arrayKeys: Object.freeze(['files']),
  mapKeys: Object.freeze(['image_paths']),
  nestedPathArrayKeys: Object.freeze(['images']),
  nestedPathMapKeys: Object.freeze(['images_by_id']),
  localImageMapKeys: Object.freeze(['localImagePaths']),
  tokenScalarKeys: Object.freeze([
    'file_token',
    'fileToken',
    'excel_file_token',
    'spreadsheet_token',
    'result_file_token',
    'cache_token',
  ]),
  tokenArrayKeys: Object.freeze(['file_tokens']),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatReadLocation(pathSegments) {
  return pathSegments.reduce((label, segment, index) => {
    if (index === 0) return String(segment);
    return typeof segment === 'number' ? `${label}[${segment}]` : `${label}.${segment}`;
  }, '');
}

/** Visit only declared read-token values; never recursively scan arbitrary data. */
function forEachReadLocation(params, visitor) {
  if (!isRecord(params)) return;

  for (const key of READ_FILE_TOKEN_SCHEMAS.scalarKeys) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const path = [key];
      visitor({ kind: 'scalar', key, path, label: formatReadLocation(path), value: params[key] });
    }
  }

  for (const key of READ_FILE_TOKEN_SCHEMAS.tokenScalarKeys) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const path = [key];
      visitor({ kind: 'scalar-token', key, path, label: formatReadLocation(path), value: params[key] });
    }
  }

  for (const key of READ_FILE_TOKEN_SCHEMAS.arrayKeys) {
    if (!Array.isArray(params[key])) continue;
    params[key].forEach((value, index) => {
      visitor({
        kind: 'array',
        key,
        path: [key, index],
        label: formatReadLocation([key, index]),
        index,
        value,
      });
    });
  }

  for (const key of READ_FILE_TOKEN_SCHEMAS.tokenArrayKeys) {
    if (!Array.isArray(params[key])) continue;
    params[key].forEach((value, index) => {
      visitor({
        kind: 'token-array',
        key,
        path: [key, index],
        label: formatReadLocation([key, index]),
        index,
        value,
      });
    });
  }

  for (const key of READ_FILE_TOKEN_SCHEMAS.mapKeys) {
    if (!isRecord(params[key])) continue;
    for (const [entryKey, value] of Object.entries(params[key])) {
      visitor({
        kind: 'map',
        key,
        path: [key, entryKey],
        label: formatReadLocation([key, entryKey]),
        entryKey,
        value,
      });
    }
  }

  for (const key of READ_FILE_TOKEN_SCHEMAS.nestedPathArrayKeys) {
    if (!Array.isArray(params[key])) continue;
    params[key].forEach((entry, index) => {
      if (!isRecord(entry) || !Object.prototype.hasOwnProperty.call(entry, 'path')) return;
      visitor({
        kind: 'nested-array',
        key,
        path: [key, index, 'path'],
        label: formatReadLocation([key, index, 'path']),
        index,
        entry,
        value: entry.path,
      });
    });
  }

  for (const key of READ_FILE_TOKEN_SCHEMAS.localImageMapKeys) {
    if (!isRecord(params[key])) continue;
    for (const [entryKey, value] of Object.entries(params[key])) {
      visitor({
        kind: 'local-map',
        key,
        path: [key, entryKey],
        label: formatReadLocation([key, entryKey]),
        entryKey,
        value,
      });
    }
  }

  for (const key of READ_FILE_TOKEN_SCHEMAS.nestedPathMapKeys) {
    if (!isRecord(params[key])) continue;
    for (const [groupKey, entries] of Object.entries(params[key])) {
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, index) => {
        if (!isRecord(entry) || !Object.prototype.hasOwnProperty.call(entry, 'path')) return;
        visitor({
          kind: 'nested',
          key,
          path: [key, groupKey, index, 'path'],
          label: formatReadLocation([key, groupKey, index, 'path']),
          groupKey,
          index,
          entry,
          value: entry.path,
        });
      });
    }
  }
}

function cloneContainer(value) {
  return Array.isArray(value) ? [...value] : { ...value };
}

/**
 * Map declared read locations without mutating the caller's payload. Containers
 * are cloned once per branch, so large file arrays do not become quadratic.
 */
function mapReadLocations(params, mapValue) {
  if (!isRecord(params)) return params;

  const changes = [];
  forEachReadLocation(params, (location) => {
    const nextValue = mapValue(location);
    if (!Object.is(nextValue, location.value)) changes.push({ location, nextValue });
  });
  if (changes.length === 0) return params;

  const next = { ...params };
  const clones = new WeakMap([[params, next]]);

  for (const { location, nextValue } of changes) {
    let source = params;
    let target = next;
    const segments = location.path;
    for (const segment of segments.slice(0, -1)) {
      const sourceChild = source[segment];
      let targetChild = clones.get(sourceChild);
      if (!targetChild) {
        targetChild = cloneContainer(sourceChild);
        clones.set(sourceChild, targetChild);
      }
      target[segment] = targetChild;
      source = sourceChild;
      target = targetChild;
    }
    target[segments[segments.length - 1]] = nextValue;
  }

  return next;
}

module.exports = {
  READ_FILE_TOKEN_SCHEMAS,
  forEachReadLocation,
  formatReadLocation,
  isRecord,
  mapReadLocations,
};
