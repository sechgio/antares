#!/usr/bin/env node
/**
 * Falla si type:ignore, any, dict[str, Any] sin allowlist en backend
 * o archivos grandes suben respecto al techo de .quality-baseline.json. Sin baseline sale 0.
 * El techo que se juzga es el commiteado en HEAD, no el del árbol de trabajo.
 *
 *   node scripts/quality-ratchet.js [--json]
 *   node scripts/quality-ratchet.js --update [--force]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT } = require('./lib/loop-utils');

const BASELINE_PATH = path.join(ROOT, '.quality-baseline.json');
const BASELINE_REL = path.relative(ROOT, BASELINE_PATH).split(path.sep).join('/');
const LARGE_FILE_LINES = 500;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'venv312', 'dist', 'dist-electron',
  'data', 'coverage', 'release', 'build', 'scratch', 'agent-tools',
  '.mypy_cache', '.ruff_cache', '.pytest_cache', '__pycache__',
  '.workbuddy-ai', '.worktrees', 'worktrees', '.superpowers',
  '.github', 'assets', 'formatos',
]);

const SOURCE_EXT = new Set(['.py', '.js', '.ts', '.tsx']);

const METRICS = [
  { id: 'typeIgnore', label: '`# type: ignore` en backend' },
  { id: 'anyInFrontend', label: '`any` explícitos en frontend/src' },
  { id: 'dictAnyBackend', label: '`dict[str, Any]` sin allowlist en backend' },
  { id: 'largeFiles', label: `archivos fuente > ${LARGE_FILE_LINES} líneas` },
];

const TYPE_IGNORE_RE = /#\s*type:\s*ignore/;
const ANY_RE = /:\s*any\b|<any>|[=,]\s*any\s*>|\bas\s+any\b/;
// Paridad con scripts/check_any_guard.py: ocurrencias por línea, exenta con allowlist/type: ignore/noqa.
const DICT_ANY_RE = /dict\[str,\s*Any\]/g;
const DICT_ANY_ALLOW_RE = /#\s*(allowlist|type:\s*ignore|noqa\b)/i;

function collectSourceFiles(rootDir = ROOT) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (SOURCE_EXT.has(path.extname(entry.name))) out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function countMatchingLines(files, pattern) {
  let total = 0;
  for (const file of files) {
    for (const line of readText(file).split('\n')) {
      if (pattern.test(line)) total++;
    }
  }
  return total;
}

function isBackendPython(file) {
  return path.extname(file) === '.py' && file.includes(`${path.sep}backend${path.sep}`);
}

function isFrontendTs(file) {
  const ext = path.extname(file);
  return (ext === '.ts' || ext === '.tsx') &&
    file.includes(`${path.sep}frontend${path.sep}src${path.sep}`);
}

function countTypeIgnore(files) {
  return countMatchingLines(files.filter(isBackendPython), TYPE_IGNORE_RE);
}

function countAny(files) {
  return countMatchingLines(files.filter(isFrontendTs), ANY_RE);
}

function countDictAnyBackend(files) {
  let total = 0;
  for (const file of files.filter(isBackendPython)) {
    for (const line of readText(file).split('\n')) {
      if (DICT_ANY_ALLOW_RE.test(line)) continue;
      const matches = line.match(DICT_ANY_RE);
      if (matches) total += matches.length;
    }
  }
  return total;
}

function countLargeFiles(files) {
  return files.filter((f) => readText(f).split('\n').length > LARGE_FILE_LINES).length;
}

function measure(rootDir = ROOT) {
  const files = collectSourceFiles(rootDir);
  return {
    typeIgnore: countTypeIgnore(files),
    anyInFrontend: countAny(files),
    dictAnyBackend: countDictAnyBackend(files),
    largeFiles: countLargeFiles(files),
  };
}

function compare(metric, current, baseline) {
  const previous = baseline && baseline.metrics && baseline.metrics[metric.id];
  if (!previous || !Number.isFinite(previous.value)) return 'nodata';
  if (current > previous.value) return 'regression';
  if (current < previous.value) return 'improved';
  return 'ok';
}

function evaluate(current, baseline) {
  return METRICS.map((metric) => {
    const previous = baseline && baseline.metrics && baseline.metrics[metric.id];
    const value = Number.isFinite(current[metric.id]) ? current[metric.id] : 0;
    return {
      id: metric.id,
      label: metric.label,
      value,
      baseline: previous && Number.isFinite(previous.value) ? previous.value : null,
      status: compare(metric, value, baseline),
    };
  });
}

function renderReport(rows, { baselineMissing = false, baselineSource = null } = {}) {
  const icon = { ok: '=', regression: '✗', improved: '↓', nodata: '?' };
  const lines = [
    '## Trinquete de calidad — Antares',
    '',
    '| Métrica | Hoy | Techo | Estado |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const techo = row.baseline === null ? '—' : String(row.baseline);
    lines.push(`| ${row.label} | ${row.value} | ${techo} | ${icon[row.status] || '?'} |`);
  }
  lines.push('');
  if (baselineMissing) {
    lines.push('> Sin baseline. Ejecuta `node scripts/quality-ratchet.js --update` para fijar los techos de hoy.');
  } else {
    if (baselineSource) lines.push(`> Techo leído de \`${baselineSource}\`.`);
    lines.push('> `=` igual · `↓` bajó · `✗` subió (bloquea) · `?` sin datos');
    lines.push('> Bajar un techo: `node scripts/quality-ratchet.js --update`. Subirlo exige `--force` y commit del baseline.');
  }
  return lines.join('\n');
}

function nextBaseline(current, previous, { force = false } = {}) {
  const metrics = {};
  const blocked = [];
  for (const metric of METRICS) {
    const value = Number.isFinite(current[metric.id]) ? current[metric.id] : 0;
    const before = previous && previous.metrics && previous.metrics[metric.id];
    const ceiling = before && Number.isFinite(before.value) ? before.value : null;
    if (ceiling !== null && value > ceiling && !force) {
      metrics[metric.id] = { value: ceiling, direction: 'max' };
      blocked.push({ id: metric.id, from: ceiling, to: value });
      continue;
    }
    metrics[metric.id] = { value, direction: 'max' };
  }
  return { baseline: { updatedAt: new Date().toISOString().slice(0, 10), metrics }, blocked };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readText(BASELINE_PATH));
  } catch {
    return null;
  }
}

function readCommittedBaseline() {
  try {
    const raw = execFileSync('git', ['show', `HEAD:${BASELINE_REL}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * El techo que juzga es el commiteado: si se leyera el archivo del árbol de
 * trabajo, subir un techo localmente bastaría para pasar la puerta sin que nadie
 * lo vea. El archivo local manda sólo cuando no hay baseline en HEAD.
 */
function chooseBaseline({ committed, local }) {
  if (committed) return { baseline: committed, source: 'HEAD' };
  if (local) return { baseline: local, source: 'worktree' };
  return { baseline: null, source: null };
}

function loosenedCeilings(committed, local) {
  const head = committed && committed.metrics;
  const here = local && local.metrics;
  if (!head || !here) return [];
  const out = [];
  for (const metric of METRICS) {
    const before = head[metric.id];
    const now = here[metric.id];
    if (
      before && now && Number.isFinite(before.value) &&
      Number.isFinite(now.value) && now.value > before.value
    ) {
      out.push({ id: metric.id, head: before.value, local: now.value });
    }
  }
  return out;
}

function committedBaseline() {
  return chooseBaseline({ committed: readCommittedBaseline(), local: loadBaseline() });
}

function loosenedInWorktree(committed) {
  return loosenedCeilings(committed, loadBaseline());
}

function run() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const update = argv.includes('--update');
  const force = argv.includes('--force');
  const current = measure(ROOT);
  const { baseline: ceiling, source } = committedBaseline();

  if (update) {
    const { baseline, blocked } = nextBaseline(current, ceiling, { force });
    if (blocked.length > 0) {
      console.error('\n✗ Estos techos subirían; usa --force sólo si es una decisión consciente:\n');
      for (const b of blocked) console.error(`  ${b.id}: ${b.from} → ${b.to}`);
      console.error('');
      process.exit(1);
    }
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(renderReport(evaluate(current, baseline), { baselineSource: source }));
    console.log(`\n✓ Baseline actualizado en ${path.relative(ROOT, BASELINE_PATH)}`);
    process.exit(0);
  }

  const rows = evaluate(current, ceiling);
  if (asJson) {
    console.log(
      JSON.stringify({ current, rows, baselineSource: source, baselineMissing: ceiling === null }, null, 2),
    );
  } else {
    console.log(renderReport(rows, { baselineMissing: ceiling === null, baselineSource: source }));
  }

  if (source === 'HEAD') {
    const loosened = loosenedInWorktree(ceiling);
    if (loosened.length > 0) {
      console.error(
        `\n⚠ El árbol de trabajo sube techos que HEAD no autoriza: ${loosened
          .map((l) => `${l.id} ${l.head} → ${l.local}`)
          .join(', ')}. Se juzga contra HEAD; súbelos en el mismo commit si es intencional.`,
      );
    }
  }

  if (ceiling === null) process.exit(0);
  const blocking = rows.filter((r) => r.status === 'regression');
  if (blocking.length > 0) {
    console.error(`\n✗ ${blocking.length} métrica(s) empeoraron: ${blocking.map((r) => r.id).join(', ')}`);
    console.error('  O corriges el aumento, o bajas el techo con --update tras una decisión explícita.\n');
    process.exit(1);
  }
  process.exit(0);
}

module.exports = {
  LARGE_FILE_LINES,
  SKIP_DIRS,
  METRICS,
  collectSourceFiles,
  countTypeIgnore,
  countAny,
  countDictAnyBackend,
  countLargeFiles,
  measure,
  compare,
  evaluate,
  renderReport,
  nextBaseline,
  loadBaseline,
  readCommittedBaseline,
  chooseBaseline,
  loosenedCeilings,
};

if (require.main === module) run();
