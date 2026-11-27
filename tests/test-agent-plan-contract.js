'use strict';

const assert = require('node:assert/strict');
const contract = require('../shared/agent-plan.json');
const { planFromParams } = require('../electron/agent-shared');
const { _internal } = require('../electron/agent-tasks');

assert.deepEqual([...contract.statuses], ['pending', 'in_progress', 'done', 'failed'],
  'el contrato compartido conserva los cuatro estados del plan');
assert.deepEqual(Object.keys(_internal.PLAN_STATUS).sort(), [...contract.statuses].sort(),
  'las etiquetas de delegación cubren todos los estados');

for (const status of contract.statuses) {
  const plan = planFromParams({ goal: '  meta  ', steps: [
    { title: '  paso  ', status, evidence: '  evidencia  ' },
  ] });
  assert.equal(plan.goal, 'meta', `el objetivo se recorta para ${status}`);
  assert.equal(plan.steps[0].title, 'paso', `el título se recorta para ${status}`);
  assert.equal(plan.steps[0].status, status, `el estado ${status} se conserva`);
  assert.equal(plan.steps[0].evidence, 'evidencia', `la evidencia se recorta para ${status}`);
}

const unknown = planFromParams({ goal: 'g', steps: [{ title: 'x', status: 'otro' }] });
assert.equal(unknown.steps[0].status, 'pending', 'un estado desconocido cae a pendiente');

const long = planFromParams({ goal: 'g', steps: Array.from({ length: contract.max_steps + 5 }, (_, index) => ({
  title: `${index} ${'x'.repeat(contract.max_title_chars + 10)}`,
  status: 'pending',
  evidence: 'e'.repeat(contract.max_evidence_chars + 10),
})) });
assert.equal(long.steps.length, contract.max_steps, 'el plan limita el número de pasos');
assert.equal(long.steps[0].title.length, contract.max_title_chars, 'el plan limita el título');
assert.equal(long.steps[0].evidence.length, contract.max_evidence_chars, 'el plan limita la evidencia');

assert.equal(planFromParams({ goal: 'g', steps: [] }), null, 'un plan sin pasos no se persiste');
assert.equal(planFromParams({ goal: 'g', steps: [{ title: '   ' }] }), null, 'un plan sin títulos no se persiste');

assert.equal(contract.max_id_chars, 64, 'el contrato limita los ids de los pasos');
assert.equal(contract.max_step_dependencies, 20, 'el contrato limita las dependencias por paso');

const identified = planFromParams({ goal: 'g', steps: [
  { id: 'revisar', title: 'Revisar', status: 'done', evidence: 'visto', dependencies: ['preparar', ''] },
] });
assert.equal(identified.steps[0].id, 'revisar', 'el id estable se conserva');
assert.deepEqual(identified.steps[0].dependencies, ['preparar'], 'las dependencias no vacías se conservan');
const capped = planFromParams({ goal: 'g', steps: [{
  id: 'x'.repeat(contract.max_id_chars + 10),
  title: 'Paso',
  status: 'pending',
  dependencies: Array.from({ length: contract.max_step_dependencies + 5 }, (_, index) => `d${index}`),
}] });
assert.equal(capped.steps[0].id.length, contract.max_id_chars, 'el id se recorta al tope');
assert.equal(capped.steps[0].dependencies.length, contract.max_step_dependencies, 'las dependencias se recortan al tope');
assert.equal('id' in planFromParams({ goal: 'g', steps: [{ title: 'x' }] }).steps[0], false,
  'sin id estable no se inventa uno');

assert.ok(Array.isArray(contract.evidence_ref_kinds) && contract.evidence_ref_kinds.includes('tool_call'),
  'el contrato declara los tipos de evidence_ref');
assert.equal(typeof contract.max_evidence_ref_chars, 'number', 'el contrato limita la referencia de evidencia');

const withRef = planFromParams({ goal: 'g', steps: [
  { title: 'Verificar', status: 'done', evidence: 'visto', evidence_ref: { kind: 'tool_call', ref: '  call-1  ' } },
] });
assert.deepEqual(withRef.steps[0].evidence_ref, { kind: 'tool_call', ref: 'call-1' },
  'una evidence_ref válida se conserva recortada');

const badKind = planFromParams({ goal: 'g', steps: [
  { title: 'Verificar', status: 'done', evidence: 'visto', evidence_ref: { kind: 'magia', ref: 'x' } },
] });
assert.equal('evidence_ref' in badKind.steps[0], false, 'un kind desconocido se descarta');

const emptyRef = planFromParams({ goal: 'g', steps: [
  { title: 'Verificar', status: 'done', evidence: 'visto', evidence_ref: { kind: 'file', ref: '  ' } },
] });
assert.equal('evidence_ref' in emptyRef.steps[0], false, 'una referencia vacía se descarta');

const longRef = planFromParams({ goal: 'g', steps: [
  { title: 'v', status: 'done', evidence: 'visto', evidence_ref: { kind: 'file', ref: 'r'.repeat(contract.max_evidence_ref_chars + 20) } },
] });
assert.equal(longRef.steps[0].evidence_ref.ref.length, contract.max_evidence_ref_chars,
  'la referencia se recorta al tope del contrato');

console.log('[PASS] contrato del plan: estados, límites y normalización compartidos coinciden.');
