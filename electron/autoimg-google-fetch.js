const { appendLogEvent } = require('./app-log');
const { throwIfAborted, sleepAbortable } = require('./async-utils');

const SHEETS_WINDOW_MS = 60_000;
const SHEETS_MAX_PER_WINDOW = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 10_000;
const GOOGLE_API_SLOW_MS = 10_000;

const _sheetsTimestamps = [];
let _sheetsQueue = Promise.resolve();

function _isSheetsUrl(url) {
  return String(url).includes('sheets.googleapis.com');
}

// Endpoint label safe for logs: host + path with long/id-like segments masked.
// Never includes the query string (it may carry access tokens or API keys).
function _endpointLabel(url) {
  try {
    const u = new URL(String(url));
    const segments = u.pathname.split('/').map((seg) => {
      if (seg.length >= 16 || /^[-\d]+$/.test(seg)) return '*';
      return seg;
    });
    return `${u.hostname}${segments.join('/')}`;
  } catch {
    return 'unknown-endpoint';
  }
}

function _statusClass(status) {
  return Number.isInteger(status) ? `${Math.floor(status / 100)}xx` : undefined;
}

function _emitGoogleApi({ url, httpMethod, outcome, status, attempt, durationMs, reason }) {
  try {
    const endpoint = _endpointLabel(url);
    appendLogEvent(
      outcome === 'failed' || outcome === 'timeout'
        ? 'ERROR'
        : outcome === 'success'
          ? 'INFO'
          : 'WARN',
      'google.api',
      {
        component: 'electron',
        provider: 'google',
        outcome,
        attempt,
        duration_ms: durationMs,
        status_class: _statusClass(status),
        reason,
        message: `${httpMethod} ${endpoint}${Number.isInteger(status) ? ` -> ${status}` : ''}${reason ? ` (${reason})` : ''}`,
      },
    );
  } catch {
  }
}

function _emitRateLimitWait(waitMs) {
  try {
    appendLogEvent('INFO', 'google.rate_limit', {
      component: 'electron',
      provider: 'google',
      outcome: 'degraded',
      duration_ms: waitMs,
      reason: 'sheets_client_throttle',
      message: `Sheets client-side rate limit wait ${Math.round(waitMs)}ms`,
    });
  } catch {
  }
}

async function _waitForSheetsSlot(signal) {
  throwIfAborted(signal);
  const now = Date.now();
  while (_sheetsTimestamps.length && _sheetsTimestamps[0] <= now - SHEETS_WINDOW_MS) {
    _sheetsTimestamps.shift();
  }
  if (_sheetsTimestamps.length < SHEETS_MAX_PER_WINDOW) {
    _sheetsTimestamps.push(Date.now());
    return;
  }
  const wait = _sheetsTimestamps[0] + SHEETS_WINDOW_MS - now + 100;
  _emitRateLimitWait(Math.max(wait, 250));
  await sleepAbortable(Math.max(wait, 250), signal);
  return _waitForSheetsSlot(signal);
}

async function _fetchWithTimeout(url, options = {}, timeoutMs) {
  const callerSignal = options.signal;
  throwIfAborted(callerSignal);

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
  const startedAt = Date.now();
  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(options.signal);
    let res;
    try {
      res = await _fetchOnce(url, options, timeoutMs);
    } catch (error) {
      if (!canRetry || attempt === retries || options.signal?.aborted) {
        _emitGoogleApi({
          url,
          httpMethod: method,
          outcome: error?.name === 'AbortError' ? 'cancelled' : error?.name === 'TimeoutError' ? 'timeout' : 'failed',
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          reason: error?.name === 'AbortError' ? 'aborted' : error?.name === 'TimeoutError' ? 'timeout' : 'network_error',
        });
        throw error;
      }
      _emitGoogleApi({
        url,
        httpMethod: method,
        outcome: 'degraded',
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        reason: 'retry_scheduled',
      });
      await sleepAbortable(_retryDelayMs(null, attempt, baseDelayMs, maxDelayMs), options.signal);
      continue;
    }
    if (!canRetry || !_isRetryableStatus(res.status) || attempt === retries) {
      const elapsedMs = Date.now() - startedAt;
      if (res.ok) {
        if (attempt > 0 || elapsedMs >= GOOGLE_API_SLOW_MS) {
          _emitGoogleApi({
            url,
            httpMethod: method,
            outcome: 'success',
            status: res.status,
            attempt: attempt + 1,
            durationMs: elapsedMs,
            reason: attempt > 0 ? 'retried' : 'slow',
          });
        }
      } else {
        _emitGoogleApi({
          url,
          httpMethod: method,
          outcome: 'failed',
          status: res.status,
          attempt: attempt + 1,
          durationMs: elapsedMs,
          reason: 'http_error',
        });
      }
      return res;
    }
    _emitGoogleApi({
      url,
      httpMethod: method,
      outcome: 'degraded',
      status: res.status,
      attempt: attempt + 1,
      durationMs: Date.now() - startedAt,
      reason: res.status === 429 ? 'rate_limited' : 'retry_scheduled',
    });
    await sleepAbortable(_retryDelayMs(res, attempt, baseDelayMs, maxDelayMs), options.signal);
  }
  throw new Error('No se pudo completar la solicitud');
}

module.exports = { fetchWithRetry };
