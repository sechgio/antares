'use strict';

const { assert, finish } = require('./helpers/harness');
const { shared } = require('../electron/agent-shared');
const { projectMessages, notifyChanged } = require('../electron/agent-projection');

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

  const notices = [];
  shared.notify = (method, params) => notices.push([method, params]);
  shared.convToSession.set('conversation-stream', 'session-stream');
  shared.live.set('conversation-stream', {
    generation: { message: { role: 'assistant', content: [{ type: 'text', text: 'Hola parcial' }] } },
    tools: [],
    inbox: [],
  });
  notifyChanged('conversation-stream', [{ type: 'message_update' }]);
  await new Promise((resolve) => setTimeout(resolve, 130));
  const streamed = notices.find(([, params]) => params.session_id === 'session-stream')?.[1];
  assert(
    streamed?.stream?.partial === 'Hola parcial',
    'un delta de texto se notifica con el parcial sin exigir otra proyección completa',
  );

  notices.length = 0;
  notifyChanged('conversation-stream', [{ type: 'message_update' }]);
  notifyChanged('conversation-stream', [{ type: 'tool_execution_start' }]);
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert(
    notices.some(([, params]) => params.session_id === 'session-stream' && !params.stream),
    'mezclar un cambio estructural degrada la notificación a recarga completa',
  );

  notices.length = 0;
  notifyChanged('conversation-stream', [{ type: 'message_start' }]);
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert(
    notices.some(([, params]) => params.session_id === 'session-stream' && !params.stream),
    'el inicio de una respuesta sigue recargando para cerrar el mensaje anterior',
  );
  finish();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
