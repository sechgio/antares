'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MAX_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 30_000;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_JITTER_RATIO = 0.25;

function _ipv4Private(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0)
    || (a === 192 && b === 0 && parts[2] === 2) || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && parts[2] === 100) || (a === 203 && b === 0 && parts[2] === 113) || a >= 224;
}

function _ipv6Private(address) {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9')
    || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff')) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? _ipv4Private(mapped[1]) : false;
}

function _private(address) {
  if (net.isIPv4(address)) return _ipv4Private(address);
  if (net.isIPv6(address)) return _ipv6Private(address);
  return true;
}

function _parse(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new Error('La URL de espera no es válida');
  }
  if (url.username || url.password) throw new Error('La URL de espera no admite credenciales');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('La espera HTTP solo admite https (o http local)');
  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK.has(host);
  if (url.protocol === 'http:' && !loopback) throw new Error('La espera HTTP solo usa http en localhost; fuera de local usa https');
  return { url, host, loopback };
}

function _headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? null : headers[key];
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function clampRetryAfterMs(value, maxDelayMs = MAX_RETRY_AFTER_MS) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), maxDelayMs);
}

function retryAfterMs(headers, maxDelayMs = MAX_RETRY_AFTER_MS, now = Date.now()) {
  const raw = _headerValue(headers, 'retry-after');
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return clampRetryAfterMs(seconds * 1_000, maxDelayMs);
  const date = Date.parse(String(raw));
  if (!Number.isFinite(date)) return null;
  return clampRetryAfterMs(date - now, maxDelayMs);
}

function retryDelayMs(attempt, options = {}) {
  const {
    retryAfter = null,
    baseDelayMs = RETRY_BASE_DELAY_MS,
    maxDelayMs = MAX_RETRY_AFTER_MS,
    random = Math.random,
  } = options;
  if (retryAfter !== null && retryAfter !== undefined && Number.isFinite(retryAfter)) {
    return clampRetryAfterMs(retryAfter, maxDelayMs);
  }
  const step = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const exponential = Math.min(baseDelayMs * 2 ** step, maxDelayMs);
  const jitter = Math.floor(random() * Math.min(exponential * RETRY_JITTER_RATIO, maxDelayMs - exponential));
  return Math.min(exponential + jitter, maxDelayMs);
}

async function validate(raw) {
  const { url, host, loopback } = _parse(raw);
  if (loopback) return url.toString();
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new Error('No se pudo resolver el host de la URL de espera');
  if (addresses.some((item) => _private(item.address))) {
    throw new Error('La URL de espera apunta a una dirección privada o no permitida');
  }
  return url.toString();
}

async function probe(raw, options = {}) {
  const url = await validate(raw);
  const method = options.method === 'GET' ? 'GET' : 'HEAD';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(MAX_TIMEOUT_MS, Number(options.timeout_ms) || MAX_TIMEOUT_MS));
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      headers: { Accept: '*/*', 'User-Agent': 'Antares-Agent' },
      signal: controller.signal,
    });
    if (response.body) response.body.cancel().catch(() => {});
    return { status: response.status, latency_ms: Date.now() - started,
      redirect: response.status >= 300 && response.status < 400 };
  } catch {
    return { status: null, latency_ms: Date.now() - started, error: 'Sin respuesta del destino' };
  } finally {
    clearTimeout(timer);
  }
}

async function check(raw, options = {}) {
  const max = Number(options.timeout_ms) || MAX_TIMEOUT_MS;
  const result = await probe(raw, { ...options, timeout_ms: max });
  const expected = Number(options.expect_status) || 200;
  return { ...result, expected, ready: result.status === expected };
}

module.exports = {
  check,
  validate,
  _private,
  MAX_RETRY_AFTER_MS,
  isRetryableStatus,
  retryAfterMs,
  retryDelayMs,
  clampRetryAfterMs,
};
