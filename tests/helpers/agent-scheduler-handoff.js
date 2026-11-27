'use strict';

const assert = require('node:assert/strict');
const { handlers } = require('../../electron/agent-runtime');
const scheduler = require('../../electron/agent-tasks');

module.exports = async function verifyHandoff({ faux, fauxAssistantMessage, until, future }) {
  const { session } = await handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
  const list = async () => (await handlers.agent_tasks_list({ session_id: session.id })).tasks;

  const askTask = await handlers.agent_tasks_save({
    session_id: session.id,
    content: 'Encargo que necesita un dato del usuario',
    due_at: future,
  });
  let replyContext = '';
  faux.setResponses([
    () =>
      fauxAssistantMessage(
        'Preparé el borrador pero falta un dato.\nNECESITA ENTRADA: ¿A qué mes corresponde el informe?',
      ),
    (context) => {
      replyContext = JSON.stringify(context.messages);
      return fauxAssistantMessage('Informe de marzo terminado');
    },
  ]);
  await handlers.agent_tasks_run({ id: askTask.scheduled.id });
  await until(async () => (await list()).find((task) => task.id === askTask.scheduled.id)?.status === 'needs_input');
  const asking = (await list()).find((task) => task.id === askTask.scheduled.id);
  assert.equal(asking.question, '¿A qué mes corresponde el informe?', 'la pregunta queda registrada en el encargo');
  assert.match(asking.output, /Preparé el borrador/, 'el resultado parcial queda visible sin abrir la sesión');
  assert.equal(asking.runs.at(-1).status, 'needs_input');
  await assert.rejects(
    handlers.agent_tasks_respond({ id: askTask.scheduled.id, response: '' }),
    /Indica el encargo y tu respuesta/,
  );
  await handlers.agent_tasks_respond({ id: askTask.scheduled.id, response: 'Marzo' });
  await until(async () => (await list()).find((task) => task.id === askTask.scheduled.id)?.status === 'to_verify');
  assert.match(
    replyContext,
    /¿A qué mes corresponde el informe\?/,
    'la respuesta reutiliza la entrega con la pregunta',
  );
  assert.match(replyContext, /Respuesta: Marzo/);
  assert.match(replyContext, /No es un encargo nuevo/);
  const answered = (await list()).find((task) => task.id === askTask.scheduled.id);
  assert.equal(answered.output, 'Informe de marzo terminado', 'el resultado final sustituye al parcial');
  assert.equal(answered.question, undefined, 'la pregunta se limpia al completarse');
  assert.deepEqual(
    answered.events.map((event) => event.to),
    ['delivering', 'needs_input', 'delivering', 'to_verify'],
    'el log de eventos registra cada transición',
  );
  await handlers.agent_tasks_verify({ id: askTask.scheduled.id });
  const verified = (await list()).find((task) => task.id === askTask.scheduled.id);
  assert.equal(verified.status, 'delivered', 'la verificación humana cierra el encargo');
  assert.equal(verified.events.at(-1).to, 'delivered');
  const reverified = await handlers.agent_tasks_verify({ id: askTask.scheduled.id });
  assert.equal(reverified.verified, true, 'verificar un encargo ya entregado es idempotente');
  await assert.rejects(
    handlers.agent_tasks_respond({ id: askTask.scheduled.id, response: 'Otra cosa' }),
    /no está esperando una respuesta/,
    'responder un encargo que ya no espera es un error de validación',
  );

  const blockedTask = await handlers.agent_tasks_save({
    session_id: session.id,
    content: 'Encargo que no puede continuar',
    due_at: future,
  });
  faux.setResponses([
    () => fauxAssistantMessage('Lo intenté de dos formas.\nBLOQUEADO: Falta la credencial del servicio externo.'),
  ]);
  await handlers.agent_tasks_run({ id: blockedTask.scheduled.id });
  await until(async () => (await list()).find((task) => task.id === blockedTask.scheduled.id)?.status === 'blocked');
  const blockedDone = (await list()).find((task) => task.id === blockedTask.scheduled.id);
  assert.match(blockedDone.last_error, /Falta la credencial/, 'el bloqueo lleva el motivo');
  assert.equal(blockedDone.runs.at(-1).status, 'blocked');
  faux.setResponses([() => fauxAssistantMessage('Credencial aplicada, encargo terminado')]);
  await handlers.agent_tasks_run({ id: blockedTask.scheduled.id });
  await until(async () => (await list()).find((task) => task.id === blockedTask.scheduled.id)?.status === 'to_verify');
  assert.equal(
    (await list()).find((task) => task.id === blockedTask.scheduled.id).output,
    'Credencial aplicada, encargo terminado',
    're-ejecutar un bloqueado produce un resultado nuevo',
  );

  await scheduler.schedule({ action: 'pause' }, session.id, { taskId: 'queue-handoff-pause' });
  const queuedQuestion = await scheduler.schedule(
    { action: 'enqueue', content: 'Encargo en cola con pregunta' },
    session.id,
    { taskId: 'queue-handoff' },
  );
  const queuedAfter = await scheduler.schedule(
    { action: 'enqueue', content: 'Encargo en cola posterior' },
    session.id,
    { taskId: 'queue-handoff' },
  );
  faux.setResponses([
    () => fauxAssistantMessage('NECESITA ENTRADA: ¿Confirmo el envío?'),
    () => fauxAssistantMessage('Posterior terminado'),
    (context) => {
      assert.match(JSON.stringify(context.messages), /Respuesta: Sí/, 'la cola reutiliza la entrega para la respuesta');
      return fauxAssistantMessage('Envío confirmado');
    },
  ]);
  await scheduler.schedule({ action: 'resume' }, session.id, { taskId: 'queue-handoff-resume' });
  await until(
    async () => (await list()).find((task) => task.id === queuedQuestion.scheduled.id)?.status === 'needs_input',
  );
  await until(async () => (await list()).find((task) => task.id === queuedAfter.scheduled.id)?.status === 'to_verify');
  await handlers.agent_tasks_respond({ id: queuedQuestion.scheduled.id, response: 'Sí' });
  await until(
    async () => (await list()).find((task) => task.id === queuedQuestion.scheduled.id)?.status === 'to_verify',
  );
  await handlers.agent_tasks_verify({ id: queuedQuestion.scheduled.id });
  assert.equal((await list()).find((task) => task.id === queuedQuestion.scheduled.id)?.status, 'delivered');
};
