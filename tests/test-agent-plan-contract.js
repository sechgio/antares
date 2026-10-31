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

console.log('[PASS] contrato del plan: estados, límites y normalización compartidos coinciden.');
