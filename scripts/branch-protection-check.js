#!/usr/bin/env node
'use strict';

/**
 * Compara GitHub contra .github/branch-protection/<branch>.json.
 * Sin gh o sin config: sale 0.
 *
 *   node scripts/branch-protection-check.js [--repo o/n] [--branch main] [--apply] [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO_OWNER, REPO_NAME, BASE_BRANCH, detectRepo } = require('./lib/loop-utils');

const DEFAULT_REPO = `${REPO_OWNER}/${REPO_NAME}`;
const DEFAULT_BRANCH = BASE_BRANCH;
const CONFIG_DIR = path.join(__dirname, '..', '.github', 'branch-protection');

const FIELDS = [
  { key: 'requiredApprovingReviewCount', label: 'aprobaciones requeridas' },
  { key: 'dismissStaleReviews', label: 'descartar aprobaciones obsoletas' },
  { key: 'requireCodeOwnerReviews', label: 'revision de CODEOWNERS' },
  { key: 'requireLastPushApproval', label: 'aprobacion del ultimo push' },
  { key: 'enforceAdmins', label: 'aplicar a administradores' },
  { key: 'allowForcePushes', label: 'force push permitido' },
  { key: 'allowDeletions', label: 'borrado de rama permitido' },
  { key: 'requiredLinearHistory', label: 'historia lineal' },
  { key: 'requiredConversationResolution', label: 'resolucion de conversaciones' },
  { key: 'requiredStatusChecks', label: 'status checks requeridos' },
  { key: 'strictStatusChecks', label: 'rama al dia antes de mergear' },
];

function enabled(value) {
  if (value === true) return true;
  if (value && typeof value === 'object') return value.enabled === true;
  return false;
}

function sortedChecks(statusChecks) {
  if (!statusChecks) return [];
  return [...(statusChecks.contexts || [])].sort();
}

function reviewFlags(reviews) {
  if (!reviews) {
    return {
      requiredApprovingReviewCount: 0,
      dismissStaleReviews: false,
      requireCodeOwnerReviews: false,
      requireLastPushApproval: false,
    };
  }
  return {
    requiredApprovingReviewCount: reviews.required_approving_review_count || 0,
    dismissStaleReviews: reviews.dismiss_stale_reviews === true,
    requireCodeOwnerReviews: reviews.require_code_owner_reviews === true,
    requireLastPushApproval: reviews.require_last_push_approval === true,
  };
}

function snapshot(body, flag) {
  const src = body || {};
  const checks = src.required_status_checks || null;
  return {
    ...reviewFlags(src.required_pull_request_reviews),
    enforceAdmins: flag(src.enforce_admins),
    allowForcePushes: flag(src.allow_force_pushes),
    allowDeletions: flag(src.allow_deletions),
    requiredLinearHistory: flag(src.required_linear_history),
    requiredConversationResolution: flag(src.required_conversation_resolution),
    requiredStatusChecks: sortedChecks(checks),
    strictStatusChecks: checks ? checks.strict === true : false,
  };
}

function normalizeExpected(putBody) {
  return snapshot(putBody, (value) => value === true);
}

function normalizeActual(getBody) {
  if (!getBody || typeof getBody !== 'object') return snapshot(null, (value) => value === true);
  return snapshot(getBody, enabled);
}

function sameValue(a, b) {
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray) return a.length === b.length && a.every((value, index) => value === b[index]);
  return a === b;
}

function formatValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(ninguno)';
  return String(value);
}

function diffProtection(expectedBody, actualBody) {
  const expected = normalizeExpected(expectedBody);
  const actual = normalizeActual(actualBody);
  const diffs = [];
  for (const field of FIELDS) {
    const want = expected[field.key];
    const have = actual[field.key];
    if (!sameValue(want, have)) {
      diffs.push({ field: field.key, label: field.label, expected: want, actual: have });
    }
  }
  return diffs;
}

function renderReport(repo, branch, diffs, options) {
  const unprotected = (options || {}).unprotected === true;
  const lines = [`Proteccion de rama · ${repo}#${branch}`, ''];
  if (unprotected) {
    lines.push('Estado: RAMA SIN PROTEGER (GitHub responde 404).');
  } else if (diffs.length === 0) {
    lines.push('Estado: OK — GitHub coincide con el archivo versionado.');
  } else {
    lines.push(`Estado: DERIVA — ${diffs.length} campo(s) difieren del archivo versionado.`);
  }
  lines.push('');
  if (diffs.length > 0) {
    lines.push('Campo                          | Archivo            | GitHub');
    lines.push('-------------------------------|--------------------|--------------------');
    for (const diff of diffs) {
      lines.push(`${diff.label.slice(0, 30).padEnd(30)} | ${formatValue(diff.expected).padEnd(18)} | ${formatValue(diff.actual)}`);
    }
    lines.push('');
  }
  lines.push(`Fuente de verdad: .github/branch-protection/${branch}.json`);
  lines.push(unprotected || diffs.length > 0
    ? 'Correccion: node scripts/branch-protection-check.js --apply   (requiere permiso de admin)'
    : 'Nada que corregir.');
  return lines.join('\n');
}

function readConfig(branch) {
  const file = path.join(CONFIG_DIR, `${branch}.json`);
  return { file, body: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function fetchProtection(repo, branch) {
  try {
    const out = execFileSync('gh', ['api', `repos/${repo}/branches/${branch}/protection`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, protection: JSON.parse(out) };
  } catch (error) {
    const text = String((error && error.stderr) || (error && error.message) || '');
    if (/HTTP 404/.test(text)) return { ok: true, protection: null };
    const firstLine = text.trim().split('\n')[0] || '`gh` no disponible';
    return { ok: false, error: firstLine };
  }
}

function applyProtection(repo, branch, file) {
  execFileSync(
    'gh',
    ['api', '--method', 'PUT', `repos/${repo}/branches/${branch}/protection`, '--input', file],
    { stdio: 'inherit' },
  );
}

function parseArgs(argv) {
  const options = { repo: null, branch: DEFAULT_BRANCH, apply: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--repo') options.repo = argv[++index];
    else if (arg === '--branch') options.branch = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

function run(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(
      'Uso: node scripts/branch-protection-check.js [--repo owner/name] [--branch main] [--apply] [--json]\n',
    );
    return 0;
  }

  const repo = options.repo || detectRepo() || DEFAULT_REPO;

  let config;
  try {
    config = readConfig(options.branch);
  } catch {
    process.stdout.write(
      `⚠️  No hay configuracion versionada para '${options.branch}' ` +
        `(${path.join('.github', 'branch-protection', options.branch + '.json')}). Check omitido.\n`,
    );
    return 0;
  }

  if (options.apply) {
    try {
      applyProtection(repo, options.branch, config.file);
    } catch {
      process.stdout.write(
        `⚠️  No se pudo aplicar la proteccion en ${repo}#${options.branch}. ` +
          'Se requiere permiso de admin. Check omitido.\n',
      );
      return 0;
    }
    return 0;
  }

  const fetched = fetchProtection(repo, options.branch);
  if (!fetched.ok) {
    process.stdout.write(
      `⚠️  \`gh\` no disponible o sin acceso a ${repo}#${options.branch}. Check omitido.\n`,
    );
    return 0;
  }

  const unprotected = fetched.protection === null;
  const diffs = diffProtection(config.body, fetched.protection);
  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        { repo, branch: options.branch, unprotected, diffs, ok: diffs.length === 0 },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(renderReport(repo, options.branch, diffs, { unprotected }) + '\n');
  }
  return diffs.length === 0 ? 0 : 1;
}

module.exports = {
  DEFAULT_REPO,
  DEFAULT_BRANCH,
  FIELDS,
  enabled,
  normalizeExpected,
  normalizeActual,
  sameValue,
  diffProtection,
  renderReport,
  parseArgs,
  run,
};

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}
