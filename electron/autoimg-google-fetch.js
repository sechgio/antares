const SHEETS_WINDOW_MS = 60_000;
const SHEETS_MAX_PER_WINDOW = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 10_000;

const _sheetsTimestamps = [];
let _sheetsQueue = Promise.resolve();

function _isSheetsUrl(url) {
  return String(url).includes('sheets.googleapis.com');
}

function _abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('La solicitud fue cancelada');
  error.name = 'AbortError';
  return error;
}

function _throwIfAborted(signal) {
  if (signal?.aborted) throw _abortError(signal);
}

function _sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(_abortError(signal));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function _waitForSheetsSlot(signal) {
  _throwIfAborted(signal);
  const now = Date.now();
  while (_sheetsTimestamps.length && _sheetsTimestamps[0] <= now - SHEETS_WINDOW_MS) {
    _sheetsTimestamps.shift();
  }
  if (_sheetsTimestamps.length < SHEETS_MAX_PER_WINDOW) {
    _sheetsTimestamps.push(Date.now());
    return;
  }
  const wait = _sheetsTimestamps[0] + SHEETS_WINDOW_MS - now + 100;
  await _sleep(Math.max(wait, 250), signal);
  return _waitForSheetsSlot(signal);
}

async function _fetchWithTimeout(url, options = {}, timeoutMs) {
  const callerSignal = options.signal;
  _throwIfAborted(callerSignal);

  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const onCallerAbort = () => controller.abort(callerSignal.reason);
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(`La solicitud excedió el timeout de ${timeoutMs} ms`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

async function _fetchOnce(url, options, timeoutMs) {
  const request = () => _fetchWithTimeout(url, options, timeoutMs);
  if (_isSheetsUrl(url)) {
    return new Promise((resolve, reject) => {
      _sheetsQueue = _sheetsQueue
        .then(() => _waitForSheetsSlot(options?.signal))
        .then(request)
        .then(resolve, reject);
    });
  }
  return request();
}

function _isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function _isRetryableMethod(method, retryUnsafeMethods) {
  if (retryUnsafeMethods) return true;
  return ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PUT'].includes(method);
}

function _retryAfterMs(response, maxDelayMs) {
  const value = response?.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1_000, 0), maxDelayMs);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), maxDelayMs);
}

function _retryDelayMs(response, attempt, baseDelayMs, maxDelayMs) {
  const retryAfter = _retryAfterMs(response, maxDelayMs);
  if (retryAfter !== null) return retryAfter;
  const exponential = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  const jitter = Math.floor(Math.random() * Math.min(250, exponential));
  return Math.min(exponential + jitter, maxDelayMs);
}

async function fetchWithRetry(
  url,
  options = {},
  {
    retries = 2,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
    retryUnsafeMethods = false,
  } = {},
) {
  const method = String(options.method || 'GET').toUpperCase();
  const canRetry = _isRetryableMethod(method, retryUnsafeMethods);
  for (let attempt = 0; attempt <= retries; attempt++) {
    _throwIfAborted(options.signal);
    let res;
    try {
      res = await _fetchOnce(url, options, timeoutMs);
    } catch (error) {
      if (!canRetry || attempt === retries || options.signal?.aborted) throw error;
      await _sleep(_retryDelayMs(null, attempt, baseDelayMs, maxDelayMs), options.signal);
      continue;
    }
    if (!canRetry || !_isRetryableStatus(res.status) || attempt === retries) return res;
    await _sleep(_retryDelayMs(res, attempt, baseDelayMs, maxDelayMs), options.signal);
  }
  throw new Error('No se pudo completar la solicitud');
}

module.exports = { fetchWithRetry };
