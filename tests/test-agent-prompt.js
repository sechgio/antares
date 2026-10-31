'use strict';

const assert = require('node:assert/strict');
const {
  CONVERSATION_GUIDE, SAFETY_GUIDE, EXECUTION_GUIDE, LEGACY_GUIDES, SYSTEM_PROMPT, legacyNotes,
} = require('../electron/agent-prompts');

const cases = {
  'todas las guías presentes': () => {
    assert.deepEqual(legacyNotes(LEGACY_GUIDES.join('\n')), []);
  },
  'ninguna guía presente': () => {
    assert.deepEqual(legacyNotes('Instrucciones de una conversación anterior'), LEGACY_GUIDES);
  },
  'solo faltan las guías ausentes': () => {
    assert.deepEqual(legacyNotes(`Cabecera\n${SAFETY_GUIDE}\nCierre`), [CONVERSATION_GUIDE, EXECUTION_GUIDE]);
  },
  'entrada vacía': () => {
    assert.deepEqual(legacyNotes(), LEGACY_GUIDES);
    assert.deepEqual(legacyNotes(null), LEGACY_GUIDES);
  },
  'el prompt base incluye cada guía una sola vez': () => {
    for (const guide of [CONVERSATION_GUIDE, SAFETY_GUIDE, EXECUTION_GUIDE]) {
      assert.equal(SYSTEM_PROMPT.split(guide).length, 2, 'el prompt base no duplica las guías');
    }
    assert(!SYSTEM_PROMPT.includes('El último tramo es obligatorio'), 'el prompt base no conserva la guía eliminada');
  },
};

let failed = false;
for (const [name, run] of Object.entries(cases)) {
  try { run(); console.log(`[PASS] ${name}`); }
  catch (error) { failed = true; console.error(`[FAIL] ${name}`, error); }
}
if (failed) process.exitCode = 1;
