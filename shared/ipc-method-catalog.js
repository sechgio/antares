const CATALOG = require('./ipc-method-catalog.json');

const METHODS = CATALOG.methods;
const TIMEOUTS = CATALOG.timeouts;

const METHOD_NAMES = new Set(Object.keys(METHODS));

const BACKEND_METHODS = Object.keys(METHODS).filter((m) => METHODS[m].handler.startsWith('backend:'));
const NATIVE_METHODS = Object.keys(METHODS).filter((m) => METHODS[m].handler === 'native:dialog');

const LONG_RUNNING_METHODS = new Set(
  Object.keys(METHODS).filter((m) => (METHODS[m].timeout || 'normal') !== 'normal'),
);
const HEAVY_TIMEOUT_METHODS = new Set(
  Object.keys(METHODS).filter((m) => METHODS[m].timeout === 'heavy'),
);
const SYNC_METHODS = new Set(
  Object.keys(METHODS).filter((m) => METHODS[m].lane === 'sync'),
);
const IDEMPOTENT_METHODS = new Set(
  Object.keys(METHODS).filter((m) => METHODS[m].idempotent === true),
);
const RAW_OUTPUT_PATH_METHODS = new Set(
  Object.keys(METHODS).filter((m) => METHODS[m].rawOutputPath === true),
);
const READ_FILE_TOKEN_SCHEMAS = new Map(
  Object.keys(METHODS)
    .filter((m) => Array.isArray(METHODS[m].fileTokens))
    .map((m) => [m, METHODS[m].fileTokens]),
);
const METHOD_OUTPUT_PATH_KEYS = new Map(
  Object.keys(METHODS)
    .filter((m) => Array.isArray(METHODS[m].writePathKeys))
    .map((m) => [m, new Set(METHODS[m].writePathKeys)]),
);

function nativeMethods(bucket) {
  return new Set(
    Object.keys(METHODS).filter((m) => METHODS[m].handler === `native:${bucket}`),
  );
}

function nativeDispatchFor(method) {
  const handler = METHODS[method] && METHODS[method].handler;
  return typeof handler === 'string' && handler.startsWith('native:')
    ? handler.slice('native:'.length)
    : null;
}

function timeoutMsFor(method) {
  const entry = METHODS[method];
  const tier = (entry && entry.timeout) || 'normal';
  return TIMEOUTS[tier] || TIMEOUTS.normal;
}

function isIdempotent(method) {
  if (typeof method !== 'string') return false;
  const entry = METHODS[method];
  return entry !== undefined && entry.idempotent === true;
}

module.exports = {
  CATALOG,
  METHODS,
  TIMEOUTS,
  METHOD_NAMES,
  BACKEND_METHODS,
  NATIVE_METHODS,
  LONG_RUNNING_METHODS,
  HEAVY_TIMEOUT_METHODS,
  SYNC_METHODS,
  IDEMPOTENT_METHODS,
  RAW_OUTPUT_PATH_METHODS,
  READ_FILE_TOKEN_SCHEMAS,
  METHOD_OUTPUT_PATH_KEYS,
  nativeMethods,
  nativeDispatchFor,
  timeoutMsFor,
  isIdempotent,
};
