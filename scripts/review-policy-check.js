#!/usr/bin/env node
/**
 * Intención, tamaño, tests, aprobación, taxonomía.
 * Sin gh o sin PR: sale 0. --enforce sale 1 si algún check bloquea.
 * En borrador los checks de bloqueo degradan a aviso.
 *
 *   node scripts/review-policy-check.js --pr 42 [--enforce] [--comment] [--json]
 */

const { execFileSync } = require('child_process');
const { ROOT, detectRepo } = require('./lib/loop-utils');

const SIZE_WARN = 400;
const SIZE_BLOCK = 1000;
const MAX_NEW_FILE_LINES = 500;
const MIN_BODY_CHARS = 120;
const EXEMPT_LABEL = 'size/exempt';
const COMMENT_PREFIXES = ['blocking', 'suggestion', 'nit', 'question', 'praise'];
const TAXONOMY_TARGET = 0.8;
const REVIEW_TIMEOUT_MS = 20000;
const COMMENT_MARKER = 'antares-review-policy:';
const GENERATED_PATHS = [
  /(^|\/)(package-lock\.json|uv\.lock|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock)$/,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.min\.(js|css)$/,
];
const ICON = { pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭️' };

function classifySize(changedLines) {
  if (!Number.isFinite(changedLines)) return 'unknown';
  if (changedLines <= SIZE_WARN) return 'ok';
  if (changedLines < SIZE_BLOCK) return 'warn';
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
  return !!(user && (user.is_bot || /\[bot\]$/i.test(String(user.login || ''))));
}

function hasThirdPartyApproval(pr) {
  const author = pr && pr.author && pr.author.login;
  return ((pr && pr.reviews) || []).some(
    (r) => r && r.state === 'APPROVED' && r.author && r.author.login && r.author.login !== author && !isBot(r.author),
  );
}

function humanComments(comments) {
  return (comments || []).filter(
    (c) => c && c.body && String(c.body).trim().length > 0 && !isBot(c.author),
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

function evaluatePolicy(pr) {
  const data = pr || {};
  const files = data.files || [];
  const body = String(data.body || '').trim();
  const labels = (data.labels || []).map((l) => (l && l.name) || l).filter(Boolean);
  const changedLines = (Number(data.additions) || 0) + (Number(data.deletions) || 0);
  const generatedLines = files.reduce(
    (acc, f) => acc + (isGeneratedPath(f.path) ? (Number(f.additions) || 0) + (Number(f.deletions) || 0) : 0),
    0,
  );
  const effectiveLines = files.length > 0 ? Math.max(0, changedLines - generatedLines) : changedLines;
  const sizeExempt = labels.includes(EXEMPT_LABEL);
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  const block = (status) => (data.isDraft && status === 'fail' ? 'warn' : status);

  const intentLen = effectiveBodyLength(body);
  add(
    'intencion',
    'Intención declarada',
    block(intentLen >= MIN_BODY_CHARS ? 'pass' : 'fail'),
    intentLen >= MIN_BODY_CHARS
      ? `${intentLen} caracteres de contenido`
      : `Descripción efectiva de ${intentLen} caracteres (mínimo ${MIN_BODY_CHARS}; la plantilla sin rellenar no cuenta). Explica el *por qué*.`,
  );

  const sizeDetail = generatedLines > 0
    ? `${effectiveLines} líneas efectivas (${generatedLines} generadas excluidas)`
    : `${effectiveLines} líneas`;
  const size = classifySize(effectiveLines);
  if (size === 'ok') {
    add('tamano', 'Tamaño del PR', 'pass', sizeDetail);
  } else if (size === 'warn') {
    add('tamano', 'Tamaño del PR', 'warn', `${sizeDetail} (>${SIZE_WARN}). Considera partirlo en PRs apilados.`);
  } else if (sizeExempt) {
    add('tamano', 'Tamaño del PR', 'warn', `${sizeDetail} (≥${SIZE_BLOCK}) con exención \`${EXEMPT_LABEL}\`.`);
  } else {
    add('tamano', 'Tamaño del PR', block('fail'), `${sizeDetail} (≥${SIZE_BLOCK}). Parte el cambio o aplica la etiqueta \`${EXEMPT_LABEL}\`.`);
  }

  const bigNew = files.filter(
    (f) =>
      (Number(f.additions) || 0) > MAX_NEW_FILE_LINES &&
      (Number(f.deletions) || 0) === 0 &&
      !isGeneratedPath(f.path) &&
      !isTestPath(f.path),
  );
  if (bigNew.length === 0) {
    add('archivos', 'Sin archivos nuevos > 500 líneas', 'pass', 'OK');
  } else if (sizeExempt) {
    add('archivos', 'Sin archivos nuevos > 500 líneas', 'warn', `${bigNew.map((f) => f.path).join(', ')} (exentos)`);
  } else {
    add('archivos', 'Sin archivos nuevos > 500 líneas', block('fail'), bigNew.map((f) => `${f.path} (+${f.additions})`).join(', '));
  }

  const gate = (id, label, pass, passDetail, warnDetail) => {
    if (pass) add(id, label, 'pass', passDetail);
    else if (data.isDraft) add(id, label, 'skip', 'PR en borrador');
    else add(id, label, 'warn', warnDetail);
  };

  gate(
    'riesgo',
    'Sección de riesgo completada',
    /##\s*Risk/i.test(body) && /- \[[xX]\]/.test(body),
    'OK',
    'No se detectó la sección de riesgo de la plantilla. Complétala antes de pedir revisión.',
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
    add('taxonomia', 'Taxonomía de comentarios', 'skip', 'Sin comentarios aún');
  } else {
    const pct = Math.round(tax.ratio * 100);
    add(
      'taxonomia',
      'Taxonomía de comentarios',
      tax.ratio >= TAXONOMY_TARGET ? 'pass' : 'warn',
      `${tax.prefixed}/${tax.total} comentarios con prefijo (${pct}%, objetivo ${Math.round(TAXONOMY_TARGET * 100)}%)`,
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
      testsTouched: touchedTests.length,
      taxonomy: tax,
      sizeExempt,
      effectiveLines,
      generatedLines,
    },
  };
}

function renderReport(pr, result) {
  return [
    '## Revisión de código — política automática',
    '',
    `**Veredicto:** \`${result.verdict}\` · **${result.changedLines}** líneas cambiadas${
      result.stats.generatedLines > 0 ? ` (**${result.stats.effectiveLines}** efectivas tras excluir generadas)` : ''
    } en **${result.stats.files}** archivo(s)`,
    '',
    '| Check | Estado | Detalle |',
    '| --- | --- | --- |',
    ...result.checks.map((c) => `| ${c.label} | ${ICON[c.status]} ${c.status} | ${c.detail} |`),
    '',
    '> Un check automático que nadie puede esquivar vale más que una norma escrita.',
    '',
    `<!-- ${COMMENT_MARKER}pr=${pr ? pr.number : 'n/a'} -->`,
  ].join('\n');
}

function parseArgs(argv) {
  const args = { pr: null, enforce: false, comment: false, json: false, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--enforce') args.enforce = true;
    else if (a === '--comment') args.comment = true;
    else if (a === '--json') args.json = true;
    else if (a === '--pr') args.pr = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
  }
  return args;
}

function currentBranchPr(repo) {
  try {
    const out = execFileSync(
      'gh',
      ['pr', 'view', '--json', 'number', ...(repo ? ['--repo', repo] : [])],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: REVIEW_TIMEOUT_MS },
    );
    return JSON.parse(out).number;
  } catch {
    return null;
  }
}

function fetchPr(number, repo) {
  const fields = 'number,title,body,additions,deletions,reviews,comments,labels,author,isDraft,state';
  const out = execFileSync(
    'gh',
    ['pr', 'view', String(number), '--json', fields, ...(repo ? ['--repo', repo] : [])],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: REVIEW_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

function ghApi(args) {
  return execFileSync('gh', ['api', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: REVIEW_TIMEOUT_MS,
    maxBuffer: 40 * 1024 * 1024,
  });
}

function fetchPrFiles(number, repo) {
  const out = ghApi([`repos/${repo}/pulls/${number}/files?per_page=100`, '--paginate', '--slurp']);
  return JSON.parse(out || '[]')
    .flat()
    .map((f) => ({ path: f.filename, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 }));
}

function selectPolicyComment(comments) {
  const marked = (comments || [])
    .filter((c) => c && c.id && String(c.body || '').includes(COMMENT_MARKER))
    .sort((a, b) => Number(a.id) - Number(b.id));
  return { update: marked[marked.length - 1] || null, remove: marked.slice(0, -1) };
}

function upsertPolicyComment(repo, prNumber, report) {
  const out = ghApi([`repos/${repo}/issues/${prNumber}/comments?per_page=100`, '--paginate', '--slurp']);
  const { update, remove } = selectPolicyComment(JSON.parse(out || '[]').flat());
  for (const stale of remove) {
    ghApi(['-X', 'DELETE', `repos/${repo}/issues/comments/${stale.id}`]);
  }
  if (update) {
    ghApi(['-X', 'PATCH', `repos/${repo}/issues/comments/${update.id}`, '-f', `body=${report}`]);
    return 'actualizado';
  }
  ghApi(['-X', 'POST', `repos/${repo}/issues/${prNumber}/comments`, '-f', `body=${report}`]);
  return 'creado';
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || detectRepo();

  if (!repo) {
    console.error('✗ No se pudo determinar el repositorio. Usa --repo owner/name');
    process.exit(args.enforce ? 1 : 0);
  }

  const number = args.pr ? Number(args.pr) : currentBranchPr(repo);
  if (!number) {
    console.error('✗ No se encontró un PR. Usa --pr <numero>');
    process.exit(args.enforce ? 1 : 0);
  }

  let pr;
  try {
    pr = fetchPr(number, repo);
    pr.files = fetchPrFiles(number, repo);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (/command failed|ENOENT|not found|Could not resolve/i.test(msg)) {
      console.warn(`⚠️  \`gh\` no disponible o sin acceso a ${repo}#${number}. Check omitido.`);
      process.exit(0);
    }
    console.error(`✗ No se pudo leer el PR ${repo}#${number}: ${msg.split('\n')[0]}`);
    process.exit(args.enforce ? 1 : 0);
  }

  const result = evaluatePolicy(pr);
  const report = renderReport(pr, result);

  if (args.json) {
    console.log(JSON.stringify({ repo, pr: pr.number, ...result }, null, 2));
  } else {
    console.log(`\nPolítica de revisión — ${repo}#${pr.number}: ${pr.title}\n`);
    console.log(report);
    console.log('');
  }

  if (args.comment) {
    try {
      const action = upsertPolicyComment(repo, pr.number, report);
      console.log(`Informe ${action} en el PR.`);
    } catch (err) {
      console.warn(`⚠️  No se pudo comentar en el PR: ${String(err.message).split('\n')[0]}`);
    }
  }

  if (args.enforce && result.verdict === 'blocked') {
    const failed = result.checks.filter((c) => c.status === 'fail');
    console.error(`\n✗ ${failed.length} check(s) bloquean el PR: ${failed.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }

  process.exit(0);
}

module.exports = {
  SIZE_WARN,
  SIZE_BLOCK,
  MAX_NEW_FILE_LINES,
  MIN_BODY_CHARS,
  EXEMPT_LABEL,
  COMMENT_PREFIXES,
  COMMENT_MARKER,
  GENERATED_PATHS,
  TAXONOMY_TARGET,
  classifySize,
  isTestPath,
  isGeneratedPath,
  effectiveBodyLength,
  isBot,
  hasThirdPartyApproval,
  humanComments,
  taxonomyCompliance,
  evaluatePolicy,
  renderReport,
  selectPolicyComment,
};

if (require.main === module) run();
