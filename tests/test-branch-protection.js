#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const core = require(path.join(root, 'scripts', 'branch-protection-check.js'));

let assertions = 0;
let failures = 0;

function assert(condition, message) {
  assertions += 1;
  if (!condition) {
    failures += 1;
    process.stdout.write(`  ✗ ${message}\n`);
  }
}

function eq(actual, expected, message) {
  assert(
    actual === expected,
    `${message} (esperado: ${JSON.stringify(expected)}, obtenido: ${JSON.stringify(actual)})`
  );
}

const ACTUAL_PROTECTED = {
  url: 'https://api.github.com/repos/sechgio/antares/branches/main/protection',
  required_pull_request_reviews: {
    url: 'https://api.github.com/repos/sechgio/antares/branches/main/protection/required_pull_request_reviews',
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    require_last_push_approval: false,
    required_approving_review_count: 1,
  },
  required_signatures: { enabled: false },
  enforce_admins: { enabled: false },
  required_linear_history: { enabled: false },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  block_creations: { enabled: false },
  required_conversation_resolution: { enabled: false },
  lock_branch: { enabled: false },
  allow_fork_syncing: { enabled: false },
};

const EXPECTED = JSON.parse(
  fs.readFileSync(path.join(root, '.github', 'branch-protection', 'main.json'), 'utf8')
);

function testEnabled() {
  process.stdout.write('enabled()\n');
  eq(core.enabled(true), true, 'booleano true');
  eq(core.enabled(false), false, 'booleano false');
  eq(core.enabled({ enabled: true }), true, 'objeto enabled:true');
  eq(core.enabled({ enabled: false }), false, 'objeto enabled:false');
  eq(core.enabled({ enabled: false, url: 'x' }), false, 'objeto con url extra');
  eq(core.enabled(undefined), false, 'undefined');
  eq(core.enabled(null), false, 'null');
  eq(core.enabled('true'), false, 'string no se interpreta como true');
}

function testNormalizeExpected() {
  process.stdout.write('normalizeExpected()\n');
  const flat = core.normalizeExpected(EXPECTED);

  eq(flat.requiredApprovingReviewCount, 1, 'aprobaciones requeridas');
  eq(flat.dismissStaleReviews, true, 'descarta aprobaciones obsoletas');
  eq(flat.requireCodeOwnerReviews, false, 'no exige CODEOWNERS');
  eq(flat.requireLastPushApproval, false, 'no exige aprobacion del ultimo push');
  eq(flat.enforceAdmins, false, 'no aplica a administradores');
  eq(flat.allowForcePushes, false, 'prohibe force push');
  eq(flat.allowDeletions, false, 'prohibe borrar la rama');
  eq(flat.requiredStatusChecks.length, 0, 'sin status checks requeridos');
  eq(flat.strictStatusChecks, false, 'strict desactivado');

  const empty = core.normalizeExpected(null);
  eq(empty.requiredApprovingReviewCount, 0, 'cuerpo nulo => cero aprobaciones');
  eq(empty.enforceAdmins, false, 'cuerpo nulo => no aplica a admins');
}

function testNormalizeExpectedWithChecks() {
  process.stdout.write('normalizeExpected() con status checks\n');
  const flat = core.normalizeExpected({
    required_status_checks: { strict: true, contexts: ['Lint, audit, and test', 'build'] },
    required_pull_request_reviews: { required_approving_review_count: 2 },
  });
  eq(flat.strictStatusChecks, true, 'strict activado');
  eq(flat.requiredStatusChecks.length, 2, 'dos checks');
  eq(flat.requiredStatusChecks[0], 'Lint, audit, and test', 'checks ordenados alfabeticamente');
  eq(flat.requiredApprovingReviewCount, 2, 'dos aprobaciones');
}

function testNormalizeActual() {
  process.stdout.write('normalizeActual()\n');
  const flat = core.normalizeActual(ACTUAL_PROTECTED);

  eq(flat.requiredApprovingReviewCount, 1, 'aprobaciones requeridas');
  eq(flat.dismissStaleReviews, true, 'descarta aprobaciones obsoletas');
  eq(flat.enforceAdmins, false, 'enforce_admins se lee desde .enabled');
  eq(flat.allowForcePushes, false, 'allow_force_pushes se lee desde .enabled');
  eq(flat.allowDeletions, false, 'allow_deletions se lee desde .enabled');
  eq(flat.requiredStatusChecks.length, 0, 'sin status checks');

  const unprotected = core.normalizeActual(null);
  eq(unprotected.requiredApprovingReviewCount, 0, 'sin proteger => cero aprobaciones');
  eq(unprotected.allowForcePushes, false, 'sin proteger => force push en default');
}

function testSameValue() {
  process.stdout.write('sameValue()\n');
  eq(core.sameValue(true, true), true, 'booleanos iguales');
  eq(core.sameValue(true, false), false, 'booleanos distintos');
  eq(core.sameValue([], []), true, 'arrays vacios');
  eq(core.sameValue(['a', 'b'], ['a', 'b']), true, 'arrays iguales');
  eq(core.sameValue(['a', 'b'], ['b', 'a']), false, 'arrays en distinto orden');
  eq(core.sameValue(['a'], ['a', 'b']), false, 'arrays de distinto largo');
  eq(core.sameValue([], false), false, 'array contra booleano');
}

function testDiffClean() {
  process.stdout.write('diffProtection(): sin deriva\n');
  const diffs = core.diffProtection(EXPECTED, ACTUAL_PROTECTED);
  eq(diffs.length, 0, 'el archivo versionado coincide con la respuesta real');
}

function testDiffIgnoresExtraFields() {
  process.stdout.write('diffProtection(): ignora campos que no estan en la politica\n');
  const withExtras = Object.assign({}, ACTUAL_PROTECTED, {
    required_signatures: { enabled: true },
    block_creations: { enabled: true },
    lock_branch: { enabled: true },
  });
  const diffs = core.diffProtection(EXPECTED, withExtras);
  eq(diffs.length, 0, 'los campos fuera de FIELDS no generan deriva');
}

function testDiffUnprotected() {
  process.stdout.write('diffProtection(): rama sin proteger\n');
  const diffs = core.diffProtection(EXPECTED, null);
  assert(diffs.length > 0, 'una rama sin proteger siempre produce deriva');
  const approvals = diffs.filter((d) => d.field === 'requiredApprovingReviewCount');
  eq(approvals.length, 1, 'difieren las aprobaciones requeridas');
  eq(approvals[0].expected, 1, 'el archivo pide 1 aprobacion');
  eq(approvals[0].actual, 0, 'GitHub tiene 0');
}

function testDiffRelaxedReview() {
  process.stdout.write('diffProtection(): alguien relaja las aprobaciones\n');
  const relaxed = JSON.parse(JSON.stringify(ACTUAL_PROTECTED));
  relaxed.required_pull_request_reviews.required_approving_review_count = 0;
  const diffs = core.diffProtection(EXPECTED, relaxed);
  eq(diffs.length, 1, 'una sola diferencia');
  eq(diffs[0].field, 'requiredApprovingReviewCount', 'el campo es aprobaciones requeridas');
}

function testDiffForcePushEnabled() {
  process.stdout.write('diffProtection(): alguien habilita force push\n');
  const tampered = JSON.parse(JSON.stringify(ACTUAL_PROTECTED));
  tampered.allow_force_pushes = { enabled: true };
  const diffs = core.diffProtection(EXPECTED, tampered);
  eq(diffs.length, 1, 'una sola diferencia');
  eq(diffs[0].field, 'allowForcePushes', 'el campo es force push');
  eq(diffs[0].actual, true, 'GitHub lo tiene habilitado');
  eq(diffs[0].expected, false, 'el archivo lo prohíbe');
}

function testDiffStatusChecks() {
  process.stdout.write('diffProtection(): status checks requeridos\n');
  const expectedWithChecks = JSON.parse(JSON.stringify(EXPECTED));
  expectedWithChecks.required_status_checks = {
    strict: false,
    contexts: ['Lint, audit, and test'],
  };

  const stillEmpty = core.diffProtection(expectedWithChecks, ACTUAL_PROTECTED);
  eq(stillEmpty.length, 1, 'falta el check en GitHub');
  eq(stillEmpty[0].field, 'requiredStatusChecks', 'el campo es status checks');

  const githubChecks = JSON.parse(JSON.stringify(ACTUAL_PROTECTED));
  githubChecks.required_status_checks = {
    strict: false,
    contexts: ['Lint, audit, and test'],
  };
  const matched = core.diffProtection(expectedWithChecks, githubChecks);
  eq(matched.length, 0, 'mismo check en ambos lados => sin deriva');

  const strictOn = JSON.parse(JSON.stringify(githubChecks));
  strictOn.required_status_checks.strict = true;
  const strictDiff = core.diffProtection(expectedWithChecks, strictOn);
  eq(strictDiff.length, 1, 'strict difiere');
  eq(strictDiff[0].field, 'strictStatusChecks', 'el campo es strict');
}

function testDiffEnforceAdmins() {
  process.stdout.write('diffProtection(): enforce_admins\n');
  const hardened = JSON.parse(JSON.stringify(ACTUAL_PROTECTED));
  hardened.enforce_admins = { enabled: true };
  const diffs = core.diffProtection(EXPECTED, hardened);
  eq(diffs.length, 1, 'una sola diferencia');
  eq(diffs[0].field, 'enforceAdmins', 'el campo es enforce_admins');
  eq(diffs[0].actual, true, 'GitHub lo tiene activo');
  eq(diffs[0].expected, false, 'el archivo lo mantiene en false mientras haya un solo dev');
}

function testRenderReport() {
  process.stdout.write('renderReport()\n');

  const clean = core.renderReport('sechgio/antares', 'main', [], { unprotected: false });
  assert(clean.includes('OK'), 'estado limpio dice OK');
  assert(clean.includes('sechgio/antares'), 'incluye el repo');
  assert(clean.includes('main.json'), 'cita el archivo fuente de verdad');

  const drift = core.renderReport('sechgio/antares', 'main', [
    { field: 'allowForcePushes', label: 'force push permitido', expected: false, actual: true },
  ], { unprotected: false });
  assert(drift.includes('DERIVA'), 'con diferencias dice DERIVA');
  assert(drift.includes('force push permitido'), 'nombra el campo afectado');
  assert(drift.includes('--apply'), 'sugiere el comando de correccion');

  const unprotected = core.renderReport('sechgio/antares', 'main', [], { unprotected: true });
  assert(unprotected.includes('RAMA SIN PROTEGER'), 'rama sin proteger se reporta explicitamente');
  assert(unprotected.includes('--apply'), 'sugiere aplicar');
}

function testParseArgs() {
  process.stdout.write('parseArgs()\n');

  const defaults = core.parseArgs([]);
  eq(defaults.repo, null, 'repo se resuelve en run(), no en parseArgs');
  eq(defaults.branch, 'main', 'rama por defecto');
  eq(defaults.apply, false, 'no aplica por defecto');
  eq(defaults.json, false, 'no imprime JSON por defecto');

  const custom = core.parseArgs(['--repo', 'acme/app', '--branch', 'develop', '--apply', '--json']);
  eq(custom.repo, 'acme/app', 'repo sobrescrito');
  eq(custom.branch, 'develop', 'rama sobrescrita');
  eq(custom.apply, true, '--apply activa el modo aplicar');
  eq(custom.json, true, '--json activa la salida JSON');
}

function testConfigFileSanity() {
  process.stdout.write('archivo versionado\n');
  assert(fs.existsSync(path.join(root, '.github', 'branch-protection', 'main.json')),
    'existe .github/branch-protection/main.json');
  eq(typeof EXPECTED, 'object', 'el archivo parsea como objeto');
  eq(EXPECTED.required_pull_request_reviews.required_approving_review_count, 1,
    'exige una aprobacion');
  eq(EXPECTED.enforce_admins, false,
    'enforce_admins en false: con un solo desarrollador GitHub no permite autoaprobacion');
  eq(EXPECTED.allow_force_pushes, false, 'prohibe force push');
  eq(EXPECTED.allow_deletions, false, 'prohibe borrar la rama');
}

function run() {
  testEnabled();
  testNormalizeExpected();
  testNormalizeExpectedWithChecks();
  testNormalizeActual();
  testSameValue();
  testDiffClean();
  testDiffIgnoresExtraFields();
  testDiffUnprotected();
  testDiffRelaxedReview();
  testDiffForcePushEnabled();
  testDiffStatusChecks();
  testDiffEnforceAdmins();
  testRenderReport();
  testParseArgs();
  testConfigFileSanity();

  process.stdout.write(`\n${assertions - failures}/${assertions} aserciones correctas\n`);
  if (failures > 0) {
    process.stdout.write(`✗ ${failures} asercion(es) fallida(s)\n`);
    process.exit(1);
  }
  process.stdout.write('✓ tests de proteccion de rama OK\n');
}

run();
