#!/usr/bin/env node
// Lee los JSONL de telemetría (%LOCALAPPDATA%\Antares\logs por defecto).
//   node scripts/read-logs.js [--dir DIR] [--event X] [--level L] [--method M]
//      [--component C] [--session ID] [--since ISO] [--tail N] [--stats]
// Sin --stats imprime los eventos filtrados como JSONL (últimos --tail, por defecto 50).
// Con --stats agrega por evento y, para ipc.request, por método (conteo, errores, p50/p95/max).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { redactText } = require('../electron/app-log');

const MANAGED_JSONL_RE = /^antares-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/;
const SENSITIVE_EVENT_FIELD_RE = /authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token|cookie/i;

function parseArgs(argv) {
  const args = { tail: 50, stats: false };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'stats') {
      args.stats = true;
    } else {
      args[key] = argv[++i];
    }
  }
  return args;
}

function defaultLogsDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), 'Antares', 'logs');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Antares', 'logs');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Antares', 'logs');
}

function compareLogFileNames(first, second) {
  const firstParts = /^antares-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/.exec(first);
  const secondParts = /^antares-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/.exec(second);
  return firstParts[1].localeCompare(secondParts[1])
    || Number(firstParts[2] || 0) - Number(secondParts[2] || 0);
}

function redactEvent(value, key = '') {
  if (SENSITIVE_EVENT_FIELD_RE.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactEvent(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactEvent(child, childKey)]));
  }
  return value;
}

function readEvents(logsDir) {
  const files = fs.readdirSync(logsDir)
    .filter((name) => MANAGED_JSONL_RE.test(name))
    .sort(compareLogFileNames);
  const events = [];
  for (const name of files) {
    const filePath = path.join(logsDir, name);
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
  }
  return events;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function matches(event, args) {
  if (args.event && event.event !== args.event) return false;
  if (args.level && event.level !== args.level.toUpperCase()) return false;
  if (args.method && event.method !== args.method) return false;
  if (args.component && event.component !== args.component) return false;
  if (args.session && event.session_id !== args.session) return false;
  if (args.since && String(event.timestamp || '') < args.since) return false;
  return true;
}

function printStats(events) {
  const byEvent = new Map();
  const ipcByMethod = new Map();
  let dropped = 0;
  for (const e of events) {
    if (typeof e.dropped_events === 'number') dropped += e.dropped_events;
    const bucket = byEvent.get(e.event) || { total: 0, levels: {}, outcomes: {} };
    bucket.total += 1;
    bucket.levels[e.level] = (bucket.levels[e.level] || 0) + 1;
    if (e.outcome) bucket.outcomes[e.outcome] = (bucket.outcomes[e.outcome] || 0) + 1;
    byEvent.set(e.event, bucket);
    if (e.event === 'ipc.request' && e.method) {
      const m = ipcByMethod.get(e.method) || { total: 0, errors: 0, durations: [] };
      m.total += 1;
      if (e.outcome !== 'success') m.errors += 1;
      if (typeof e.duration_ms === 'number') m.durations.push(e.duration_ms);
      ipcByMethod.set(e.method, m);
    }
  }

  console.log('== eventos ==');
  for (const [name, b] of [...byEvent.entries()].sort((a, b2) => b2[1].total - a[1].total)) {
    const outcomes = Object.entries(b.outcomes).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`${b.total.toString().padStart(6)}  ${name.padEnd(28)} ${outcomes}`);
  }
  console.log(`\ndropped_events acumulados: ${dropped}`);

  if (ipcByMethod.size) {
    console.log('\n== ipc.request por método ==');
    const rows = [...ipcByMethod.entries()].sort((a, b) => b[1].total - a[1].total);
    console.log('total  err%    p50ms  p95ms  maxms  método');
    for (const [method, m] of rows) {
      m.durations.sort((a, b) => a - b);
      const errPct = ((m.errors * 100) / m.total).toFixed(1);
      console.log(
        `${m.total.toString().padStart(5)}  ${errPct.padStart(5)}  ` +
        `${String(percentile(m.durations, 50) ?? '-').padStart(6)}  ` +
        `${String(percentile(m.durations, 95) ?? '-').padStart(6)}  ` +
        `${String(m.durations[m.durations.length - 1] ?? '-').padStart(6)}  ${method}`,
      );
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const logsDir = args.dir || defaultLogsDir();
  if (!fs.existsSync(logsDir)) {
    console.error(`No existe el directorio de logs: ${logsDir}`);
    process.exit(1);
  }
  const events = readEvents(logsDir).map((event) => redactEvent(event)).filter((e) => matches(e, args));
  if (args.stats) {
    printStats(events);
    return;
  }
  for (const e of events.slice(-Number(args.tail))) {
    console.log(JSON.stringify(e));
  }
}

main();
