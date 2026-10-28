'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');
const tasks = require('../electron/agent-tasks');
const execution = require('../electron/agent-execution');
const { shared } = require('../electron/agent-shared');

async function until(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La espera no terminó a tiempo');
}

async function main() {
  const { fauxProvider, fauxAssistantMessage } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-delegation-choice-'));
  let seen = '';
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] });
  runtime._internal._providerOverrides.set('faux', faux.provider);
  faux.setResponses([(context) => {
    seen = JSON.stringify(context.messages || []);
    return fauxAssistantMessage('Listo');
  }]);
  const bridge = async (method) => {
    if (method === 'agent_internal_tools') return { tools: [] };
    if (method === 'agent_internal_provider') return { style: 'openai_chat', base_url: 'http://unused', api_key: 'test' };
    if (method === 'agent_internal_approvals_pending') return { approvals: [] };
    if (method === 'agent_internal_memory_context') return { context: '' };
    if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [], context: '' };
    if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
    if (method === 'agent_internal_activity') return { attention: {} };
    throw new Error(`Puente inesperado: ${method}`);
  };
  await runtime.open({ dir, storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), bridge, skipImport: true });
  try {
    assert.match(shared.DELEGATION_GUIDE, /agent_delegate[\s\S]*subagent_run/,
      'la guía nombra las dos delegaciones en orden');
    assert.match(shared.DELEGATION_GUIDE, /historial[\s\S]*este mismo turno/,
      'la guía distingue la conversación persistente del resultado inmediato');
    assert.ok(tasks.DELEGATE_TOOL.description.includes(shared.DELEGATION_GUIDE),
      'agent_delegate comparte la guía de elección');
    await runtime.handlers.agent_profile_save({ name: 'Asesor', instructions: 'Revisa el contrato', tools: null });
    const subagent = (await execution.allToolSpecs()).find((tool) => tool.name === 'subagent_run');
    assert.ok(subagent, 'subagent_run aparece en el catálogo con un perfil guardado');
    assert.ok(subagent.description.includes(shared.DELEGATION_GUIDE),
      'subagent_run comparte la guía de elección');
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Organiza la revisión' });
    await until(() => seen.includes(shared.DELEGATION_GUIDE));
    assert.ok(seen.includes(shared.DELEGATION_GUIDE), 'el prompt comparte la guía de elección');
    console.log('[PASS] elección de delegación: la misma guía explica cuándo usar agent_delegate y cuándo '
      + 'subagent_run en el prompt y en las dos descripciones.');
  } finally {
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
