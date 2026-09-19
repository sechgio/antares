#!/usr/bin/env node
/**
 * Auditoría de la política de revisión de un PR: intención, tamaño, tests, aprobación, taxonomía.
 *
 * Severidades: solo los checks `blocking` pueden tumbar el job. Bloquean la intención vacía y el
 * tamaño grande sin declarar (etiqueta `size/exempt`); el resto son señales para el revisor humano.
 * La puerta falla abierta ante problemas de infraestructura (sin `gh`, API caída, PR cerrado) y
 * falla cerrada ante errores de uso (repo o número de PR imposibles, `--fail-on` inválido).
 *
 *   node scripts/review-policy-check.js --pr 42 [--comment] [--json]
 *                                       [--fail-on blocking|advisory|never]
 *
 * `--enforce` es un alias de `--fail-on blocking`. Sin ninguna de las dos la auditoría informa y sale 0.
 * Exit 1 solo cuando `--fail-on` encuentra checks en su umbral, o ante un error de uso.
 */

const { parseCliArgs, detectRepo } = require('./lib/loop-utils');
const {
  COMMENT_MARKER,
  currentBranchPr,
  fetchPrData,
  ghErrorMessage,
  isMissingGh,
  upsertPolicyComment,
} = require('./lib/pr-audit');

const SIZE_WARN = 400;
const SIZE_LARGE = 2000;
const MAX_NEW_FILE_LINES = 500;
const MIN_BODY_CHARS = 120;
const EXEMPT_LABEL = 'size/exempt';
const COMMENT_PREFIXES = ['blocking', 'suggestion', 'nit', 'question', 'praise'];
const TAXONOMY_TARGET = 0.8;
const BLOCKING = 'blocking';
const ADVISORY = 'advisory';
const FAIL_MODES = [BLOCKING, 'advisory', 'never'];
const STATUS_ICON = { pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭️' };
const VERDICT_ICON = { blocked: '❌', warning: '⚠️', ok: '✅' };
const GENERATED_PATHS = [
  /(^|\/)(package-lock\.json|uv\.lock|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /(^|\/)(dist|build|release|coverage|node_modules|vendor|__pycache__)\//,
];

function classifySize(changedLines) {
  if (!Number.isFinite(changedLines)) return 'unknown';
  if (changedLines <= SIZE_WARN) return 'ok';
  if (changedLines < SIZE_LARGE) return 'warn';
  return 'block';
}

function isTestPath(filePath) {
  const p = (filePath || '').replace(/\\/g, '/');
  return (
    /(^|\/)(tests?|__tests__)\//.test(p) ||
    /\.test\.[cm]?[jt]sx?$/.test(p) ||
    /\.spec\.[cm]?[jt]sx?$/.test(p) ||
    /(^|\/)test_[a-z0-9_]+\.py$/.test(p)
  );
}

function isGeneratedPath(filePath) {
  const p = (filePath || '').replace(/\\/g, '/');
  return GENERATED_PATHS.some((re) => re.test(p));
}

function isNewFile(file) {
  const status = String(file.status || '').toLowerCase();
  if (status) return status === 'added';
  // Payloads sin `status` (pruebas unitarias): un archivo puramente nuevo no tiene borrados.
  return (Number(file.deletions) || 0) === 0;
}

function effectiveBodyLength(body) {
  return String(body || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return (
        t.length > 0 &&
        !/^#{1,6}\s/.test(t) &&
        !/^- \[[ xX]\]/.test(t) &&
        !/^([-*_]\s*){3,}$/.test(t) &&
        !/^>/.test(t)
      );
    })
    .join('')
    .replace(/\s+/g, '').length;
}

function isBot(user) {
  if (!user) return false;
  return Boolean(
    user.is_bot || user.type === 'Bot' || /\[bot\]$/i.test(String(user.login || '')),
  );
}

function hasThirdPartyApproval(pr) {
  const author = pr && pr.author && pr.author.login;
  return ((pr && pr.reviews) || []).some(
    (r) => r && r.state === 'APPROVED' && r.author && r.author.login && r.author.login !== author && !isBot(r.author),
  );
}

function humanComments(comments) {
  return (comments || []).filter(
    (c) =>
      c &&
      c.body &&
      String(c.body).trim().length > 0 &&
      !isBot(c.author) &&
      !String(c.body).includes(COMMENT_MARKER),
  );
}

function taxonomyCompliance(comments) {
  const list = humanComments(comments);
  if (list.length === 0) return { total: 0, prefixed: 0, ratio: 1 };
  const prefixed = list.filter((c) => {
    const head = String(c.body).trim().toLowerCase();
    return COMMENT_PREFIXES.some((p) => head.startsWith(`${p}:`));
  }).length;
  return { total: list.length, prefixed, ratio: prefixed / list.length };
}

function summarizeFiles(files) {
  let generatedLines = 0;
  const bigNewFiles = [];
  for (const f of files) {
    const lines = (Number(f.additions) || 0) + (Number(f.deletions) || 0);
    if (isGeneratedPath(f.path)) {
      generatedLines += lines;
    } else if (isNewFile(f) && (Number(f.additions) || 0) > MAX_NEW_FILE_LINES && !isTestPath(f.path)) {
      bigNewFiles.push(f);
    }
  }
  bigNewFiles.sort((a, b) => (Number(b.additions) || 0) - (Number(a.additions) || 0));
  return { generatedLines, bigNewFiles };
}

function evaluatePolicy(pr, meta = {}) {
  const data = pr || {};
  const files = data.files || [];
  const body = String(data.body || '').trim();
  const isDraft = Boolean(data.isDraft);
  const labels = (data.labels || []).map((l) => (l && l.name) || l).filter(Boolean);
  const changedLines = (Number(data.additions) || 0) + (Number(data.deletions) || 0);
  const changedFiles = Number(data.changedFiles) || files.length;
  const sizeUnknown = Boolean(meta.partial) && files.length < changedFiles;
  const { generatedLines, bigNewFiles } = summarizeFiles(files);
  const effectiveLines = files.length > 0 ? Math.max(0, changedLines - generatedLines) : changedLines;
  const sizeExempt = labels.includes(EXEMPT_LABEL);
  const checks = [];

  // Un check no bloqueante nunca produce `fail`; un borrador tampoco.
  const add = (id, label, status, detail, blocking = false) => {
    const fails = blocking && status === 'fail' && !isDraft;
    checks.push({
      id,
      label,
      severity: blocking ? BLOCKING : ADVISORY,
      status: fails ? 'fail' : status === 'fail' ? 'warn' : status,
      detail,
    });
  };

  const intentLen = effectiveBodyLength(body);
  const intentOk = intentLen >= MIN_BODY_CHARS;
  add(
    'intencion',
    'Intención declarada',
    intentOk ? 'pass' : 'fail',
    intentOk
      ? `${intentLen} caracteres de contenido`
      : `${intentLen} caracteres efectivos (mínimo ${MIN_BODY_CHARS}; la plantilla sin rellenar no cuenta). Explica el *por qué* en "What / Why".`,
    true,
  );

  const sizeDetail =
    generatedLines > 0 ? `${effectiveLines} efectivas (${generatedLines} generadas excluidas)` : `${effectiveLines} líneas`;
  const size = classifySize(effectiveLines);
  if (sizeUnknown) {
    add(
      'tamano',
      'Tamaño del PR',
      'skip',
      `Listado de archivos incompleto (${files.length}/${changedFiles}): no se puede medir ni bloquear por tamaño.`,
    );
  } else if (size === 'ok') {
    add('tamano', 'Tamaño del PR', 'pass', `${sizeDetail} en ${files.length} archivo(s)`);
  } else if (size === 'warn') {
    add('tamano', 'Tamaño del PR', 'warn', `${sizeDetail} (>${SIZE_WARN}): considera partirlo en PRs apilados.`);
  } else if (sizeExempt) {
    add('tamano', 'Tamaño del PR', 'warn', `${sizeDetail} (≥${SIZE_LARGE}) declarado con la etiqueta \`${EXEMPT_LABEL}\`.`);
  } else {
    add(
      'tamano',
      'Tamaño del PR',
      'fail',
      `${sizeDetail} (≥${SIZE_LARGE}). Parte el cambio o aplica la etiqueta \`${EXEMPT_LABEL}\` para declarar que es deliberadamente grande.`,
      true,
    );
  }

  const oversized = bigNewFiles.slice(0, 5).map((f) => `${f.path} (+${f.additions})`);
  if (bigNewFiles.length > oversized.length) oversized.push(`+${bigNewFiles.length - oversized.length} más`);
  add(
    'archivos',
    'Archivos nuevos asumibles',
    bigNewFiles.length === 0 ? 'pass' : 'fail',
    bigNewFiles.length === 0
      ? `Ningún archivo nuevo supera ${MAX_NEW_FILE_LINES} líneas`
      : `${oversized.join(', ')} superan ${MAX_NEW_FILE_LINES} líneas. Revisa su tamaño o divídelos.`,
  );

  const gate = (id, label, pass, passDetail, warnDetail) => {
    if (pass) add(id, label, 'pass', passDetail);
    else if (isDraft) add(id, label, 'skip', 'PR en borrador');
    else add(id, label, 'warn', warnDetail);
  };

  gate(
    'riesgo',
    'Sección de riesgo completada',
    /##\s*Risk/i.test(body) && /- \[[xX]\]/.test(body),
    'OK',
    'Falta la sección "Risk" de la plantilla marcada. Complétala antes de pedir revisión.',
  );

  const touchedTests = files.filter((f) => isTestPath(f.path));
  gate(
    'tests',
    'Tests incluidos',
    touchedTests.length > 0,
    `${touchedTests.length} archivo(s) de test`,
    'El diff no toca tests. Si es un cambio de comportamiento, añade uno que falle sin él.',
  );

  gate(
    'aprobacion',
    'Aprobación de un tercero',
    hasThirdPartyApproval(data),
    'OK',
    'Sin aprobación de alguien que no sea el autor. Objetivo: 100% de PRs con revisor distinto.',
  );

  const tax = taxonomyCompliance((data.reviews || []).concat(data.comments || []));
  if (tax.total === 0) {
    add('taxonomia', 'Taxonomía de comentarios', 'skip', 'Sin comentarios de revisión aún');
  } else {
    const pct = Math.round(tax.ratio * 100);
    add(
      'taxonomia',
      'Taxonomía de comentarios',
      tax.ratio >= TAXONOMY_TARGET ? 'pass' : 'warn',
      `${tax.prefixed}/${tax.total} comentarios con prefijo (${pct}%, objetivo ${Math.round(TAXONOMY_TARGET * 100)}%): \`blocking:\` / \`suggestion:\` / \`nit:\` / \`question:\` / \`praise:\``,
    );
  }

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  return {
    verdict: failed.length > 0 ? 'blocked' : warned.length > 0 ? 'warning' : 'ok',
    changedLines,
    checks,
    stats: {
      files: files.length,
      changedFiles,
      testsTouched: touchedTests.length,
      taxonomy: tax,
      sizeExempt,
      sizeUnknown,
      effectiveLines,
      generatedLines,
    },
  };
}

function checkRow(c) {
  return `| ${c.label} | ${STATUS_ICON[c.status]} ${c.status} | ${c.detail} |`;
}

function checkSection(title, checks) {
  if (checks.length === 0) return [];
  return ['', `### ${title}`, '', '| Check | Estado | Detalle |', '| --- | --- | --- |', ...checks.map(checkRow)];
}

function renderReport(pr, result, extra = {}) {
  const { checks, stats } = result;
  const blocked = checks.filter((c) => c.status === 'fail');
  const warnings = checks.filter((c) => c.status === 'warn');
  const resolved = checks.filter((c) => c.status === 'pass' || c.status === 'skip');
  const lines = [
    `## ${VERDICT_ICON[result.verdict]} Política de revisión — PR #${pr && pr.number ? pr.number : '?'}`,
    '',
    `**Veredicto:** \`${result.verdict}\` · **${stats.effectiveLines}** líneas efectivas en **${stats.files}** archivo(s)`,
    `Brutas: ${result.changedLines}${stats.generatedLines > 0 ? ` · generadas excluidas: ${stats.generatedLines}` : ''} · autor: @${(pr && pr.author && pr.author.login) || '?'}`,
  ];
  if (extra.headSha && pr) {
    lines.push(`Commit auditado: \`${String(extra.headSha).slice(0, 7)}\` · \`${pr.baseRefName || 'main'}\` ← \`${pr.headRefName || ''}\``);
  }
  lines.push(
    ...checkSection('Bloqueantes', blocked),
    ...checkSection('Avisos para el revisor', warnings),
    ...checkSection('Correctos', resolved),
    '',
    `> Solo la intención vacía y el tamaño sin \`${EXEMPT_LABEL}\` bloquean el job; el resto orienta la revisión humana.`,
    '',
    `<!-- ${COMMENT_MARKER}pr=${pr && pr.number ? pr.number : 'n/a'} -->`,
  );
  return lines.join('\n');
}

function annotate(result) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  for (const c of result.checks) {
    const detail = String(c.detail).replace(/\r?\n/g, ' ');
    if (c.status === 'fail') console.log(`::error title=Política de revisión · ${c.id}::${detail}`);
    if (c.status === 'warn') console.log(`::warning title=Política de revisión · ${c.id}::${detail}`);
  }
}

function shouldFail(result, mode) {
  if (mode === 'never') return false;
  if (result.verdict === 'blocked') return true;
  return mode === 'advisory' && result.verdict === 'warning';
}

function parseArgs(argv) {
  return parseCliArgs(argv, {
    defaults: { pr: null, comment: false, json: false, repo: null, failOn: 'never', enforce: false },
    flags: {
      '--enforce': { key: 'enforce' },
      '--comment': { key: 'comment' },
      '--json': { key: 'json' },
      '--pr': { key: 'pr', value: true },
      '--repo': { key: 'repo', value: true },
      '--fail-on': { key: 'failOn', value: true },
    },
  });
}

function usageError(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function run() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const mode = args.enforce ? BLOCKING : args.failOn;
  if (!FAIL_MODES.includes(mode)) usageError(`--fail-on vale ${FAIL_MODES.join(', ')}; recibido "${args.failOn}".`);

  const repo = args.repo || detectRepo();
  if (!repo) usageError('No se pudo determinar el repositorio. Usa --repo owner/name');

  const number = args.pr ? Number(args.pr) : await currentBranchPr(repo);
  if (!Number.isInteger(number) || number <= 0) {
    usageError(`No se encontró un PR para la rama actual en ${repo}. Usa --pr <numero>.`);
  }

  let data;
  try {
    data = await fetchPrData(number, repo);
  } catch (err) {
    const message = ghErrorMessage(err);
    const reason = isMissingGh(message) ? '`gh` no está disponible o sin acceso' : 'no se pudo leer el PR';
    console.warn(`⚠️  ${reason} (${repo}#${number}): ${message.split('\n').pop()}. Check omitido.`);
    process.exit(0);
  }

  const pr = data.pr;
  if (pr.state !== 'OPEN') {
    console.log(`⏭️  PR ${repo}#${pr.number} en estado ${pr.state.toLowerCase()}: política de revisión omitida.`);
    process.exit(0);
  }

  const result = evaluatePolicy(pr, { partial: data.partial });
  const report = renderReport(pr, result, { headSha: pr.headRefOid });
  const timingMs = Date.now() - startedAt;

  if (args.json) {
    console.log(
      JSON.stringify(
        { repo, pr: { number: pr.number, title: pr.title, url: pr.url, author: pr.author && pr.author.login }, ...result, timingMs },
        null,
        2,
      ),
    );
  } else {
    console.log(`\nPolítica de revisión — ${repo}#${pr.number}: ${pr.title}\n`);
    console.log(report);
    console.log(`\nAuditado en ${(timingMs / 1000).toFixed(1)} s · --fail-on=${mode}${data.partial ? ' · datos parciales' : ''}.`);
  }
  annotate(result);

  if (args.comment) {
    try {
      const action = await upsertPolicyComment(repo, pr, report);
      console.log(`Informe ${action} en el PR.`);
    } catch (err) {
      console.warn(`⚠️  No se pudo comentar en el PR: ${ghErrorMessage(err).split('\n').pop()}`);
    }
  }

  if (shouldFail(result, mode)) {
    const blockers = result.checks.filter(
      (c) => c.status === 'fail' || (mode === 'advisory' && c.status === 'warn'),
    );
    console.error(`\n✗ ${blockers.length} check(s) con modo --fail-on=${mode}: ${blockers.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
}

module.exports = {
  SIZE_WARN,
  SIZE_LARGE,
  MAX_NEW_FILE_LINES,
  MIN_BODY_CHARS,
  EXEMPT_LABEL,
  COMMENT_PREFIXES,
  GENERATED_PATHS,
  TAXONOMY_TARGET,
  BLOCKING,
  ADVISORY,
  classifySize,
  isTestPath,
  isGeneratedPath,
  isNewFile,
  effectiveBodyLength,
  isBot,
  hasThirdPartyApproval,
  humanComments,
  taxonomyCompliance,
  summarizeFiles,
  evaluatePolicy,
  renderReport,
  shouldFail,
};

if (require.main === module) run().catch((err) => usageError(ghErrorMessage(err)));
