'use strict';

const assert = require('node:assert/strict');

const { shared } = require('../electron/agent-shared');
const execution = require('../electron/agent-execution');
const { basePromptEstimate } = require('../electron/agent-prompt-budget');
const BUDGETS = require('../shared/budgets.json');

const DEPS = { defaultToolNames: execution.defaultToolNames, reminderTexts: execution.reminderTexts };

const TOOL = (name, module, description, gated = false) => ({
  name,
  module,
  description: description || `Herramienta ${name}`,
  gated,
  inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
});

// Más de MAX_DEFAULT_TOOLS (100): activa la selección de núcleo que una conversación
// nueva aplica sobre el catálogo completo.
function fixtureSpecs({ extraCore = [] } = {}) {
  const core = [
    TOOL('fs_list', 'computer'), TOOL('fs_read', 'computer'), TOOL('document_generate', 'documents'),
    TOOL('drafts_list', 'drafts'), TOOL('task_plan', 'plan'), TOOL('memory_search', 'agent'),
    TOOL('tools_load', 'agent'), TOOL('task_schedule', 'agenda'),
  ];
  const filler = Array.from({ length: 105 }, (_, index) => TOOL(`otra_${index}`, 'otros', `Herramienta ajena al núcleo ${index}`));
  return [...core, ...filler, ...extraCore];
}

const cases = {
  'shared/budgets.json define un techo positivo para el prompt base': () => {
    const ceiling = Number(BUDGETS.agentPrompt && BUDGETS.agentPrompt.maxTokens);
    assert(Number.isFinite(ceiling) && ceiling > 0, 'falta agentPrompt.maxTokens o no es un techo válido');
    assert(ceiling >= 10_000, 'el techo debe permitir el prompt base vigente');
  },
  'defaultToolNames selecciona solo el núcleo con catálogo grande': () => {
    const specs = fixtureSpecs();
    const names = execution.defaultToolNames(specs);
    assert(names && names.length < specs.length, 'con más de MAX_DEFAULT_TOOLS herramientas debe filtrar');
    const allowed = new Set(['subagent_run', 'tools_load', 'task_schedule']);
    for (const spec of specs) {
      const inCore = ['computer', 'documents', 'drafts', 'agent', 'plan'].includes(spec.module) || allowed.has(spec.name);
      assert.equal(names.includes(spec.name), inCore, `selección inesperada para ${spec.name}`);
    }
  },
  'basePromptEstimate suma sistema, herramientas y avisos y no cambia entre llamadas': async () => {
    const specs = fixtureSpecs();
    const first = await basePromptEstimate(specs, DEPS);
    const second = await basePromptEstimate(specs, DEPS);
    assert.deepEqual(first, second, 'la estimación debe ser determinista');
    assert.equal(first.tokens, first.system + first.tools + first.reminders);
    assert(first.system > 1_000, 'el prompt de sistema es parte del total');
    assert(first.reminders > 100, 'los avisos fijos son parte del total');
    assert.equal(first.toolSelection, 'default');
    assert.equal(first.toolCount, execution.defaultToolNames(specs).length, 'usa la selección de conversación nueva');
    const grown = await basePromptEstimate(fixtureSpecs({
      extraCore: [TOOL('otro_nucleo', 'computer', 'x'.repeat(4_000))],
    }), DEPS);
    assert(grown.tokens > first.tokens, 'una herramienta del núcleo más grande sube la estimación');
  },
  'los avisos medidos son los que publican budgetWarning y planReminder': () => {
    const rounds = 33;
    const warned = execution.budgetWarning([
      { role: 'user', content: [] },
      { role: 'toolResult', toolName: 'fs_list', content: [{ type: 'text', text: 'listado' }] },
    ], rounds);
    assert.equal(warned[1].content.at(-1).text, execution.budgetWarningText(rounds));

    const turn = { remaining: ['paso'], sincePlan: 10, planReminderAt: 0, planNext: 'revisar planta' };
    const reminded = execution.planReminder([
      { role: 'user', content: [] },
      { role: 'toolResult', toolName: 'fs_list', content: [{ type: 'text', text: 'listado' }] },
    ], turn, 0);
    assert.equal(reminded[1].content.at(-1).text, execution.planReminderText(10, 'revisar planta'));
    for (const text of execution.reminderTexts()) {
      assert(!text.includes('{steps}') && !text.includes('{next}'), 'los avisos medidos no deben conservar plantillas');
    }
  },
  'allToolSpecs compone el catálogo real del puente más las herramientas locales': async () => {
    shared.deps = { bridge: async () => ({ tools: [TOOL('backend_lectura', 'conversion', 'Lectura del backend')] }),
      chord: { BACKGROUND_CONTEXT: {} } };
    shared.state = { harness: { snapshot: async () => ({}) } };
    try {
      const specs = await execution.allToolSpecs();
      const names = new Set(specs.map((spec) => spec.name));
      for (const expected of ['backend_lectura', 'tools_load', 'sessions_search', 'task_schedule']) {
        assert(names.has(expected), `falta ${expected} en el catálogo compuesto`);
      }
      assert(!names.has('subagent_run'), 'sin agentes guardados no debe haber delegación subagent_run');
      const estimate = await basePromptEstimate(specs, DEPS);
      assert(estimate.tokens > 0 && estimate.toolCount > 0, 'la estimación cubre el catálogo compuesto');
      assert.equal(estimate.toolSelection, 'default', 'el catálogo real supera MAX_DEFAULT_TOOLS');
    } finally {
      shared.deps = null;
      shared.state = null;
    }
  },
};

async function main() {
  let failed = false;
  for (const [name, run] of Object.entries(cases)) {
    try { await run(); console.log(`[PASS] ${name}`); }
    catch (error) { failed = true; console.error(`[FAIL] ${name}`, error); }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
