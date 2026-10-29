'use strict';

const assert = require('node:assert/strict');
const { shared } = require('../electron/agent-shared');
const runtime = require('../electron/agent-runtime');

async function main() {
  const calls = [];
  shared.state = { SessionsDoc: {}, harness: { snapshot: async () => ({ sessions: { s1: { id: 's1' } } }) } };
  shared.deps = { chord: { BACKGROUND_CONTEXT: {} }, bridge: async (method, params) => {
    calls.push({ method, params });
    return { kind: 'text', name: 'a.txt', text: 'Hola' };
  } };
  const preview = runtime.handlers.agent_file_preview;
  await preview({ session_id: 's1', resource: 'informe.pdf', selected_file: 'C:\\secret.txt', page: 1 });
  assert.deepEqual(calls.pop(), { method: 'agent_internal_file_preview', params: {
    session_id: 's1', resource: 'informe.pdf', page: 1, sheet: 0,
  } });
  shared.attachments.set('a1', { path: 'C:\\chosen.xlsx', kind: 'files', created: Date.now() });
  await preview({ session_id: 's1', attachment_id: 'a1', page: 2, sheet: 1 });
  assert.deepEqual(calls.pop().params, { session_id: 's1', selected_file: 'C:\\chosen.xlsx', page: 2, sheet: 1 });
  assert(shared.attachments.has('a1'), 'previsualizar no consume el adjunto');
  shared.attachments.set('old', { path: 'C:\\old.txt', kind: 'files', created: 0 });
  shared.attachments.set('folder', { path: 'C:\\folder', kind: 'folder', created: Date.now() });
  for (const args of [
    { session_id: 'missing', resource: 'a.pdf' }, { session_id: 's1', attachment_id: 'unknown' },
    { session_id: 's1', attachment_id: 'old' }, { session_id: 's1', attachment_id: 'folder' },
    { session_id: 's1' }, { session_id: 's1', resource: 'a.pdf', attachment_id: 'a1' },
    { session_id: 's1', resource: 'a.pdf', page: -1 }, { session_id: 's1', resource: 'a.pdf', sheet: true },
    { session_id: 's1', resource: 'a.pdf', attachment_id: 1 }, { session_id: 's1', resource: 'a.pdf', page: 1e30 },
  ]) await assert.rejects(() => preview(args));
  assert.equal(calls.length, 0, 'las solicitudes inválidas no alcanzan el backend');
  console.log('Vista previa nativa: permisos, adjuntos, expiración y parámetros verificados.');
}

main().catch((error) => { console.error(error); process.exit(1); });
