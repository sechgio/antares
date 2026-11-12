'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { assert, finish, counters } = require('./helpers/harness');
const { importLegacySessions } = require('../electron/agent-import');

async function run() {
  // agent-tools-browser-cua-018: la importación de exportaciones legacy no
  // resucita estados pendientes; todo lo que quedó "pending" entra como
  // denegado y el turno nuevo vuelve a pedir su aprobación.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-import-'));
  const messagesDir = path.join(dir, 'messages');
  fs.mkdirSync(messagesDir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'sessions.json'),
    JSON.stringify({
      'sess-1': { id: 'sess-1', provider: 'faux', model: 'faux-1', created_at: 1, updated_at: 2, title: 'T' },
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'approvals.json'),
    JSON.stringify({
      'ap-1': { status: 'pending', call_id: 'call-pending' },
      'ap-2': { status: 'done', call_id: 'call-done' },
    }),
  );
  fs.writeFileSync(
    path.join(messagesDir, 'sess-1.json'),
    JSON.stringify([
      { role: 'user', content: 'hola', ts: 1 },
      {
        role: 'assistant',
        ts: 2,
        tool_calls: [
          { id: 'call-pending', name: 'fs_read', status: 'pending', params: {} },
          { id: 'call-done', name: 'canvas_list', status: 'done', result: { ok: true } },
        ],
      },
    ]),
  );

  const submitted = [];
  const runtime = {
    dir,
    ctx: {},
    SessionsDoc: {},
    convIndex: new Map(),
    harness: {
      snapshot: async () => ({ sessions: {} }),
      createConversation: async () => ({ id: 'conv-1' }),
      conversation: async () => ({
        submit: async (payload) => {
          submitted.push(payload.entry);
        },
      }),
      commit: async (fn) => {
        await fn({ doc: async () => ({ sessions: {} }) });
      },
    },
  };

  const result = await importLegacySessions(runtime, dir);
  assert(result.imported === 1, 'la sesión legacy se importa');

  const assistant = submitted.find((entry) => entry && entry.kind === 'pi.assistant');
  assert(assistant, 'entra la entrada del asistente importado');
  const statuses = {};
  for (const call of assistant.data.tool_calls) statuses[call.id] = call.status;
  assert(
    statuses['call-pending'] === 'denied',
    'la aprobación pendiente de la exportación se deniega al importar (cua-018)',
  );
  assert(statuses['call-done'] === 'done', 'la llamada ya terminada no se toca');
  assert(
    !JSON.stringify(submitted).includes('"status":"pending"'),
    'ningún estado pendiente sobrevive a la importación',
  );

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
  finish();
}

run();
