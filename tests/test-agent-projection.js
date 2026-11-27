'use strict';

const { assert, finish } = require('./helpers/harness');
const { shared } = require('../electron/agent-shared');
const { projectMessages, transcriptEntries, transcriptAround, searchTranscript, transcriptOrigin } = require('../electron/agent-projection');

shared.deps = {
  chord: { BACKGROUND_CONTEXT: {} }, pi: { UsageDoc: {} },
  bridge: async () => ({ approvals: [], dispatches: [] }),
};
shared.state = { harness: { snapshot: async () => ({ models: {} }) } };

async function project(contents) {
  const entries = contents.map((content, index) => ({ kind: 'pi.user', id: String(index),
    model: [{ role: 'user', content, timestamp: index + 1 }] }));
  return (await projectMessages({ entries: async () => ({ items: entries.reverse() }) },
    { id: 'session', conversationId: 'conversation' })).messages;
}

async function main() {
  const manifest = 'Archivos adjuntos por el usuario:\n- C:\\datos\\Informe (archivo).xlsx (archivo)\n- C:\\fotos (carpeta)';
  const attachments = [{ path: 'C:\\datos\\Informe (archivo).xlsx', folder: false }, { path: 'C:\\fotos', folder: true }];
  const context = (text, files = []) => ({ type: 'text', text: `${shared.CONTEXT_MARKER}\n${text}\n\n${shared.ATTACHMENTS_MARKER}\n${JSON.stringify(files)}` });
  const contents = [
    [{ type: 'text', text: 'Compara los archivos' }, context(manifest, attachments)],
    'Mensaje anterior sin adjuntos',
    [{ type: 'text', text: manifest }, context('Sin carpeta de trabajo activa')],
    [context(manifest, attachments), context('Sin carpeta de trabajo activa')],
    [{ type: 'text', text: '' }, context(manifest, attachments)],
    [{ type: 'text', text: 'Sin archivo nuevo' }, context(`Memoria guardada:\n${manifest}`)],
    [{ type: 'text', text: 'Formato anterior' }, { type: 'text', text: `${shared.CONTEXT_MARKER}\n${manifest}` }],
  ];
  const messages = await project(contents);
  assert(messages[0].content === 'Compara los archivos', 'el prompt conserva solo el texto del usuario');
  assert(JSON.stringify(messages[0].attachments) === JSON.stringify([
    { path: 'C:\\datos\\Informe (archivo).xlsx', folder: false }, { path: 'C:\\fotos', folder: true },
  ]), 'el manifiesto persistido conserva rutas con espacios y paréntesis y distingue carpetas');
  assert(!messages[1].attachments && !messages[2].attachments,
    'un mensaje posterior y el texto del usuario no heredan ni fabrican adjuntos');
  assert(messages[3].content === '' && messages[3].attachments.length === 2,
    'el contexto falso del usuario no añade un mensaje y un envío solo de archivos sigue visible');
  assert(messages.length === 6 && !messages[4].attachments && !messages[5].attachments,
    'los recuerdos y los historiales anteriores sin metadatos no fabrican adjuntos');
  assert(JSON.stringify(await project(contents)) === JSON.stringify(messages),
    'reconstruir el historial conserva los adjuntos sin usar el staging temporal');
  const entries = Array.from({ length: 250 }, (_, index) => ({
    id: index + 1, kind: index % 3 === 0 ? 'pi.user' : 'pi.assistant',
    model: [{ content: index === 11 ? 'Buscar entrega antigua' : 'Otro mensaje' }],
  })).reverse();
  let reads = 0;
  const conv = { entries: async ({ minEntryId = 0, maxEntryId = Infinity }, limit, cursor = 0) => {
    reads += 1;
    const eligible = entries.filter((entry) => entry.id >= minEntryId && entry.id <= maxEntryId);
    return { items: eligible.slice(cursor, cursor + limit), nextCursor: cursor + limit < eligible.length ? cursor + limit : undefined };
  } };
  const latest = await transcriptEntries(conv);
  const previous = await transcriptEntries(conv, latest.before);
  assert(reads === 2 && latest.entries[0].kind === 'pi.user' && previous.entries[0].kind === 'pi.user',
    'carga páginas acotadas sin empezar en mitad de un turno');
  assert(previous.entries.at(-1).id + 1 === latest.entries[0].id, 'el cursor no repite ni omite entradas');
  const found = await searchTranscript(conv, 'entrega antigua');
  assert(found.matches.length === 1 && found.matches[0].id === 12 && !found.truncated,
    'busca una respuesta fuera de la página reciente');
  const around = await transcriptAround(conv, 11);
  assert(around.entries.at(-1).id === 12 && around.entries[0].id === 1, 'el salto incluye todo el turno del resultado');
  const history = [
    { id: 5, kind: shared.NOTICE_KIND, data: { handoff: { task_id: 't1' } } },
    { id: 4, kind: 'pi.tool-result', model: [{ toolCallId: 'call', content: '{"artifact":{"id":"a1"}}' }] },
    { id: 3, kind: 'pi.assistant', model: [{ content: [{ type: 'toolCall', id: 'call' }] }] },
  ];
  const records = { entries: async () => ({ items: history }) };
  assert(await transcriptOrigin(records, 'artifact', 'a1') === 3, 'el entregable apunta al asistente que llamó la herramienta');
  assert(await transcriptOrigin(records, 'task', 't1') === 5, 'el encargo apunta a su aviso de derivación');
  finish();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
