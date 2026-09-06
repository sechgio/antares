#!/usr/bin/env node
/**
 * Métricas sobre PRs mergeados. Sin gh: sale 0.
 *
 *   node scripts/review-metrics.js [--days 14] [--strict] [--json] [--repo o/n]
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const { ROOT, detectRepo } = require('./lib/loop-utils');
const { SIZE_WARN, isBot, hasThirdPartyApproval, taxonomyCompliance } = require('./review-policy-check.js');

const FIRST_REVIEW_TARGET_H = 4;
const RUBBER_STAMP_SECONDS = 60;
const REWORK_ROUNDS = 2;

const TARGETS = {
  size: SIZE_WARN,
  firstReviewHours: FIRST_REVIEW_TARGET_H,
  reviewCoverage: 100,
  rubberStamp: 5,
  rework: 20,
  taxonomy: 80,
  authorConcentration: 70,
};

function median(values) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function hoursBetween(from, to) {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 36e5;
}

function firstReviewSignal(pr) {
  const authorLogin = pr.author && pr.author.login;
  const stamps = [];
  for (const r of pr.reviews || []) {
    if (isBot(r.author) || (r.author && r.author.login === authorLogin)) continue;
    if (r.submittedAt) stamps.push(r.submittedAt);
  }
  for (const c of pr.comments || []) {
    if (isBot(c.author)) continue;
    if (c.createdAt) stamps.push(c.createdAt);
  }
  if (stamps.length === 0) return null;
  stamps.sort((a, b) => Date.parse(a) - Date.parse(b));
  return hoursBetween(pr.createdAt, stamps[0]);
}

function nonAuthorApprovals(pr) {
  const author = pr.author && pr.author.login;
  return (pr.reviews || []).filter(
    (r) => r.state === 'APPROVED' && r.author && r.author.login !== author && !isBot(r.author),
  );
}

function pct(part, total, digits = 1) {
  if (total === 0) return null;
  return Number(((part / total) * 100).toFixed(digits));
}

function computeMetrics(prs) {
  const list = Array.isArray(prs) ? prs : [];
  const n = list.length;
  const metric = (id, label, value, unit, target, op, ok, detail) =>
    ({ id, label, value, unit, target, op, ok, detail });

  const medianSize = median(list.map((pr) => (Number(pr.additions) || 0) + (Number(pr.deletions) || 0)));
  const firstReview = list.map(firstReviewSignal).filter((v) => v !== null);
  const medianFirst = median(firstReview);
  const covered = list.filter(hasThirdPartyApproval).length;
  const coverage = pct(covered, n);
  const stamps = list.filter((pr) =>
    nonAuthorApprovals(pr).some((r) => {
      const delta = hoursBetween(pr.createdAt, r.submittedAt);
      return delta !== null && delta * 3600 < RUBBER_STAMP_SECONDS;
    }),
  ).length;
  const stampRate = pct(stamps, n);
  const reworked = list.filter(
    (pr) => (pr.reviews || []).filter((r) => r.state === 'CHANGES_REQUESTED').length > REWORK_ROUNDS,
  ).length;
  const reworkRate = pct(reworked, n);
  const taxAcc = { prefixed: 0, total: 0 };
  for (const pr of list) {
    const tax = taxonomyCompliance([...(pr.reviews || []), ...(pr.comments || [])]);
    taxAcc.prefixed += tax.prefixed;
    taxAcc.total += tax.total;
  }
  const taxonomy = pct(taxAcc.prefixed, taxAcc.total);
  const byAuthor = new Map();
  for (const pr of list) {
    const login = (pr.author && pr.author.login) || 'desconocido';
    byAuthor.set(login, (byAuthor.get(login) || 0) + 1);
  }
  const topCount = byAuthor.size === 0 ? 0 : Math.max(...byAuthor.values());
  const concentration = pct(topCount, n);

  return [
    metric('size', 'Tamaño mediano de PR', medianSize, 'líneas', TARGETS.size, '<',
      medianSize !== null && medianSize < TARGETS.size, `${n} PRs analizados`),
    metric('firstReviewHours', 'Tiempo hasta la primera revisión',
      medianFirst === null ? null : Number(medianFirst.toFixed(2)), 'horas', TARGETS.firstReviewHours, '<',
      medianFirst !== null && medianFirst < TARGETS.firstReviewHours,
      firstReview.length === 0 ? 'sin señales de revisión' : `${firstReview.length} PRs con señal`),
    metric('reviewCoverage', 'Cobertura de revisión', coverage, '%', TARGETS.reviewCoverage, '>=',
      coverage !== null && coverage >= TARGETS.reviewCoverage,
      `${covered}/${n} PRs con aprobación de un tercero`),
    metric('rubberStamp', 'Tasa de rubber-stamp', stampRate, '%', TARGETS.rubberStamp, '<',
      stampRate !== null && stampRate < TARGETS.rubberStamp,
      `${stamps} PRs aprobados en <${RUBBER_STAMP_SECONDS}s`),
    metric('rework', 'Tasa de retrabajo', reworkRate, '%', TARGETS.rework, '<',
      reworkRate !== null && reworkRate < TARGETS.rework,
      `${reworked} PRs con >${REWORK_ROUNDS} rondas de cambios`),
    metric('taxonomy', 'Cumplimiento de taxonomía', taxonomy, '%', TARGETS.taxonomy, '>=',
      taxonomy === null || taxonomy >= TARGETS.taxonomy,
      taxAcc.total === 0 ? 'sin comentarios' : `${taxAcc.prefixed}/${taxAcc.total} con prefijo`),
    metric('authorConcentration', 'Concentración de autor (bus factor)', concentration, '%',
      TARGETS.authorConcentration, '<',
      concentration !== null && concentration < TARGETS.authorConcentration,
      `${byAuthor.size} autor(es); el principal concentró ${topCount}/${n}`),
  ];
}

function renderTarget(metric) {
  return `${metric.op === '>=' ? '≥' : '<'} ${metric.target}${metric.unit === '%' ? '%' : ''}`;
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return '—';
  return `${value}${unit === '%' ? '%' : ` ${unit}`}`;
}

function renderMarkdown(metrics, days) {
  return [
    `## Métricas de revisión de código — últimos ${days} días`,
    '',
    '| Métrica | Valor | Objetivo | Estado | Detalle |',
    '| --- | --- | --- | --- | --- |',
    ...metrics.map((m) =>
      `| ${m.label} | ${formatValue(m.value, m.unit)} | ${renderTarget(m)} | ${m.ok ? '✅' : '⚠️'} | ${m.detail} |`),
    '',
    '> Objetivos: tamaño < 400, primera review < 4 h, cobertura 100%, rubber-stamp < 5%.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { days: 14, strict: false, json: false, jsonFile: null, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') args.strict = true;
    else if (a === '--json') args.json = true;
    else if (a === '--json-file') args.jsonFile = argv[++i];
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--repo') args.repo = argv[++i];
  }
  return args;
}

function fetchMergedPrs(repo, days) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const out = execFileSync(
    'gh',
    [
      'pr', 'list', '--repo', repo, '--state', 'merged',
      '--search', `merged:>=${since}`, '--limit', '200',
      '--json', 'number,title,author,createdAt,mergedAt,additions,deletions,reviews,comments',
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 60000, maxBuffer: 40 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || detectRepo();

  if (!repo) {
    console.error('✗ No se pudo determinar el repositorio. Usa --repo owner/name');
    process.exit(args.strict ? 1 : 0);
  }

  let prs;
  try {
    prs = fetchMergedPrs(repo, args.days);
  } catch (err) {
    console.warn(`⚠️  No se pudieron leer los PRs de ${repo}: ${String(err.message).split('\n')[0]}`);
    process.exit(0);
  }

  const metrics = computeMetrics(prs);
  const payload = { repo, days: args.days, prCount: prs.length, metrics };
  if (args.jsonFile) fs.writeFileSync(args.jsonFile, `${JSON.stringify(payload, null, 2)}\n`);
  if (args.json && !args.jsonFile) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`\n${renderMarkdown(metrics, args.days)}\n`);
  }

  if (args.strict) {
    const missed = metrics.filter((m) => m.value !== null && !m.ok);
    if (missed.length > 0) {
      console.error(`✗ ${missed.length} objetivo(s) incumplidos: ${missed.map((m) => m.id).join(', ')}`);
      process.exit(1);
    }
  }
  process.exit(0);
}

module.exports = {
  TARGETS,
  renderTarget,
  median,
  hoursBetween,
  firstReviewSignal,
  nonAuthorApprovals,
  computeMetrics,
  renderMarkdown,
};

if (require.main === module) run();
