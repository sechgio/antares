'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_LOG_PATH = './.orbs/turns.jsonl';
const DEFAULT_MAX_MB = 10;
const REDACTED = '[redacted]';
const STATUSES = new Set(['ok', 'error', 'failed']);

const SECRET_KEY_RE =
  /pass(?:word|phrase)?|passwd|pwd|secret|token|api[-_]?key|authorization|bearer|credential|cookie|private[-_]?key/i;

const SECRET_VALUE_PATTERNS = [
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, repl: REDACTED },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, repl: REDACTED },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, repl: REDACTED },
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, repl: REDACTED },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, repl: REDACTED },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, repl: `Bearer ${REDACTED}` },
  {
    re: /\b(password|passwd|pwd|secret|token|api[-_]?key)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    repl: `$1$2${REDACTED}`,
  },
];

function redactString(value) {
  let out = value;
  for (const { re, repl } of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, repl);
  }
  return out;
}

function redactValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (depth >= 8) return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redactValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

function toIso(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function hasEvidence(toolCall) {
  if (!toolCall || !toolCall.verified || typeof toolCall.verified !== 'object') return false;
  return Boolean(toolCall.verified.kind) || toolCall.verified.value !== undefined;
}

function normalizeToolCall(raw) {
  if (!raw || typeof raw !== 'object') {
    return { name: String(raw ?? ''), applied: false, verified: null };
  }
  const call = {
    name: String(raw.name ?? ''),
    applied: raw.applied === true,
    verified: raw.verified && typeof raw.verified === 'object' ? { ...raw.verified } : null,
  };
  if (raw.args !== undefined) call.args = raw.args;
  return call;
}

function normalizeEntry(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const toolCalls = Array.isArray(source.tool_calls) ? source.tool_calls.map(normalizeToolCall) : [];
  let status = STATUSES.has(source.status) ? source.status : 'error';
  let error = source.error == null ? null : String(source.error);
  if (status === 'error' && source.status != null && source.status !== '' && !STATUSES.has(source.status)) {
    error = error ?? `invalid status: ${String(source.status)}`;
  }
  if (status === 'ok') {
    const unverified = toolCalls.find((call) => !hasEvidence(call));
    if (unverified) {
      status = 'error';
      error = error ?? `unverified tool call: ${unverified.name || '<unnamed>'}`;
    }
  }
  const entry = {
    turn_id: typeof source.turn_id === 'string' && source.turn_id ? source.turn_id : `turn_${crypto.randomUUID()}`,
    session_id: String(source.session_id ?? ''),
    agent: String(source.agent ?? ''),
    started_at: toIso(source.started_at) ?? new Date().toISOString(),
    ended_at: toIso(source.ended_at) ?? new Date().toISOString(),
    status,
    tool_calls: toolCalls,
    input_summary: String(source.input_summary ?? ''),
    output_summary: String(source.output_summary ?? ''),
    error,
  };
  return redactValue(entry);
}

function resolveLogPath(overrides = {}) {
  const candidate = overrides.logPath || process.env.TURN_LOG_PATH || DEFAULT_LOG_PATH;
  return path.resolve(String(candidate));
}

function resolveMaxBytes(overrides = {}) {
  const raw = overrides.maxMb ?? process.env.TURN_LOG_MAX_MB;
  const parsed = raw == null || raw === '' ? DEFAULT_MAX_MB : Number(raw);
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_MB;
  return Math.max(1, Math.floor(mb * 1024 * 1024));
}

function rotatedPath(logPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.dirname(logPath);
  const stem = path.basename(logPath).replace(/\.jsonl$/i, '');
  let target = path.join(dir, `${stem}-${stamp}.jsonl`);
  let suffix = 1;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${stem}-${stamp}-${suffix}.jsonl`);
    suffix += 1;
  }
  return target;
}

function rotateIfNeeded(logPath, incomingBytes, maxBytesCap) {
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return null;
  }
  if (size + incomingBytes <= maxBytesCap) return null;
  const target = rotatedPath(logPath);
  fs.renameSync(logPath, target);
  return target;
}

function appendTurn(rawEntry, overrides = {}) {
  const entry = normalizeEntry(rawEntry);
  const line = `${JSON.stringify(entry)}\n`;
  const logPath = resolveLogPath(overrides);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  rotateIfNeeded(logPath, Buffer.byteLength(line), resolveMaxBytes(overrides));
  const fd = fs.openSync(logPath, 'a');
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return entry;
}

function listLogFiles(logPath) {
  const dir = path.dirname(logPath);
  const base = path.basename(logPath);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const stem = base.replace(/\.jsonl$/i, '');
  const related = names.filter(
    (name) => name === base || (name.startsWith(`${stem}-`) && name.endsWith('.jsonl')),
  );
  return related.sort().map((name) => path.join(dir, name));
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function rotationStampMs(name, base, stem) {
  if (name === base || !name.startsWith(`${stem}-`) || !name.endsWith('.jsonl')) return null;
  const middle = name.slice(stem.length + 1, -'.jsonl'.length).replace(/-\d+$/, '');
  const parts = middle.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!parts) return null;
  const parsed = Date.parse(`${parts[1]}:${parts[2]}:${parts[3]}.${parts[4]}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

async function listTurns(filters = {}, overrides = {}) {
  const since = filters.since != null ? Date.parse(filters.since) : null;
  if (filters.since != null && !Number.isFinite(since)) {
    throw new Error(`invalid since: ${filters.since}`);
  }
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : null;
  const logPath = resolveLogPath(overrides);
  const base = path.basename(logPath);
  const stem = base.replace(/\.jsonl$/i, '');
  const matches = [];
  for (const filePath of listLogFiles(logPath)) {
    if (limit != null && matches.length >= limit) break;
    // Todo lo escrito en un rotado terminó antes de su instante de rotación:
    // si ese instante es anterior a --since, ninguna entrada puede pasar el filtro.
    const stamp = Number.isFinite(since) ? rotationStampMs(path.basename(filePath), base, stem) : null;
    if (stamp != null && stamp < since) continue;
    try {
      const lines = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        const entry = parseLine(line);
        if (!entry) continue;
        if (filters.session != null && entry.session_id !== filters.session) continue;
        if (filters.status != null && entry.status !== filters.status) continue;
        if (Number.isFinite(since)) {
          const endedAt = Date.parse(entry.ended_at ?? entry.started_at);
          if (!Number.isFinite(endedAt) || endedAt < since) continue;
        }
        matches.push(entry);
        if (limit != null && matches.length >= limit) break;
      }
    } catch { }
  }
  return matches;
}

module.exports = { appendTurn, listTurns, DEFAULT_LOG_PATH, DEFAULT_MAX_MB };
