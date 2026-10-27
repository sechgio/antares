'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');

async function until(check, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La espera no terminó a tiempo');
}

async function main() {
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const waitEvents = require('../electron/agent-events');
  assert.equal(waitEvents._internal.MAX_TURN_WAIT_MS, 30 * 60 * 1000);
  assert.equal(waitEvents._internal.usedWaitMs({
    a: { session_id: 's1', run_id: 'r1', status: 'waiting', created_at: 0, deadline: 600000 },
    b: { session_id: 's1', run_id: 'r1', status: 'done', created_at: 0, finished_at: 120000 },
    c: { session_id: 's1', run_id: 'r2', status: 'waiting', created_at: 0, deadline: 900000 },
    d: { session_id: 's2', run_id: 'r1', status: 'done', created_at: 0, finished_at: 900000 },
  }, 's1', 'r1'), 720000, 'el presupuesto suma solo las esperas del mismo turno y sesión');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-events-'));
  const dbPath = path.join(dir, 'agent.sqlite');
  const workspace = path.join(dir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const state = { pathChecks: 0, jobPolls: 0, githubPolls: 0, githubListPolls: 0 };
  let slow = false;
  const bridge = async (method, params) => {
    if (method === 'agent_internal_tools') return { tools: [
      { name: 'canvas_list', kind: 'backend', gated: false, replay_safe: true, inputSchema: { type: 'object', properties: {} } },
    ] };
    if (method === 'agent_internal_dispatch') return { result: slow ? null : JSON.stringify({ documents: ['Comprobante'] }) };
    if (method === 'agent_internal_dispatch_result') return { result: slow ? null : JSON.stringify({ documents: ['Comprobante'] }) };
    if (method === 'agent_internal_provider') return { style: 'openai_chat', base_url: 'http://unused', api_key: 'test' };
    if (method === 'agent_internal_approvals_pending') return { approvals: [] };
    if (method === 'agent_internal_memory_context') return { context: '' };
    if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [], context: '' };
    if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
    if (method === 'agent_internal_activity') return { attention: {} };
    if (method === 'agent_internal_path_status') {
      state.pathChecks += 1;
      const target = path.resolve(workspace, String(params.path || ''));
      const root = path.resolve(workspace);
      if (!target.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) throw new Error('La ruta no está autorizada');
      if (!fs.existsSync(target)) return { path: target, exists: false };
      const stat = fs.statSync(target);
      return { path: target, exists: true, type: stat.isDirectory() ? 'folder' : 'file',
        size: stat.size, mtime_ns: Math.round(stat.mtimeMs * 1e6), dev: stat.dev, ino: stat.ino };
    }
    if (method === 'agent_internal_shell_job_status') {
      state.jobPolls += 1;
      if (state.jobPolls <= 2) return { job_id: params.job_id, status: 'running' };
      return { job_id: params.job_id, status: 'exited', exit_code: 0, output_id: params.job_id,
        timed_out: false, cancelled: false };
    }
    throw new Error(`Puente inesperado: ${method}`);
  };
  const open = async (responses = null) => {
    const faux = fauxProvider();
    runtime._internal._providerOverrides.set('faux', faux.provider);
    if (responses) faux.setResponses(responses);
    await runtime.open({ dir, storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    return faux;
  };
  const idle = (id) => until(async () => !(await runtime.handlers.agent_turn_status({ session_id: id })).running);
  const messages = (id) => runtime.handlers.agent_messages_list({ session_id: id });
  const toolCall = async (id, name) => (await messages(id)).messages
    .flatMap((message) => message.tool_calls || []).findLast((call) => call.name === name);
  try {
    let faux = await open();
    const { session: timeSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: timeSession.id, names: ['wait_event'] });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('wait_event', { kind: 'time', seconds: 1 })], { stopReason: 'toolUse' }),
      (context) => {
        assert.match(JSON.stringify(context.messages), /elapsed/);
        return fauxAssistantMessage('Seguí tras la espera');
      },
    ]);
    await runtime.handlers.agent_message_send({ session_id: timeSession.id, content: 'Espera un segundo', request_id: 'time' });
    await idle(timeSession.id);
    const timeCall = await toolCall(timeSession.id, 'wait_event');
    assert.equal(timeCall.status, 'done');
    assert.equal(JSON.parse(timeCall.result).event, 'elapsed');
    await until(async () => (await messages(timeSession.id)).messages.some((message) => message.content === 'Seguí tras la espera'));

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('wait_event', { kind: 'file', path: 'build/listo.txt', timeout_s: 1 })], { stopReason: 'toolUse' }),
      (context) => {
        assert.match(JSON.stringify(context.messages), /timed_out/);
        return fauxAssistantMessage('El archivo no llegó');
      },
    ]);
    await runtime.handlers.agent_message_send({ session_id: timeSession.id, content: 'Espera el archivo', request_id: 'timeout' });
    await idle(timeSession.id);
    const timeoutCall = await toolCall(timeSession.id, 'wait_event');
    assert.equal(timeoutCall.status, 'done', 'un timeout es un resultado, no un fallo de la herramienta');
    assert.equal(JSON.parse(timeoutCall.result).timed_out, true);

    const { session: autoSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: autoSession.id, names: ['wait_event'] });
    const autoimg = require('../electron/autoimg-operations');
    autoimg.operationState.active = 'scan';
    autoimg.operationState.operation_id = 'op-autoimg-1';
    let releaseOperation;
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('wait_event', { kind: 'autoimg_operation', timeout_s: 5 })], { stopReason: 'toolUse' }),
        (context) => {
          assert.match(JSON.stringify(context.messages), /finished/);
          return fauxAssistantMessage('Operación de AutoIMG terminada');
        },
      ]);
      await runtime.handlers.agent_message_send({ session_id: autoSession.id, content: 'Espera la operación', request_id: 'autoimg-wait' });
      releaseOperation = setTimeout(() => { autoimg.operationState.active = null; }, 1500);
      await idle(autoSession.id);
      const autoCall = await toolCall(autoSession.id, 'wait_event');
      assert.equal(autoCall.status, 'done');
      assert.equal(JSON.parse(autoCall.result).event, 'finished');
      assert.equal(JSON.parse(autoCall.result).operation, 'scan');
      assert.equal(JSON.parse(autoCall.result).operation_id, 'op-autoimg-1');
      await until(async () => (await messages(autoSession.id)).messages.some((message) => message.content === 'Operación de AutoIMG terminada'));
    } finally {
      clearTimeout(releaseOperation);
      autoimg.operationState.active = null;
      autoimg.operationState.operation_id = null;
    }

    const { session: jobSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: jobSession.id, names: ['wait_event'] });
    state.jobPolls = 0;
    const jobId = 'a'.repeat(32);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('wait_event', { kind: 'shell_job', job_id: jobId, timeout_s: 5 })], { stopReason: 'toolUse' }),
      (context) => {
        assert.match(JSON.stringify(context.messages), /finished/);
        return fauxAssistantMessage('Job terminado');
      },
    ]);
    await runtime.handlers.agent_message_send({ session_id: jobSession.id, content: 'Espera el job', request_id: 'job-wait' });
    await idle(jobSession.id);
    const jobCall = await toolCall(jobSession.id, 'wait_event');
    assert.equal(jobCall.status, 'done');
    assert.equal(JSON.parse(jobCall.result).event, 'finished');
    assert.equal(JSON.parse(jobCall.result).status, 'exited');
    assert.equal(JSON.parse(jobCall.result).output_id, jobId);
    await until(async () => (await messages(jobSession.id)).messages.some((message) => message.content === 'Job terminado'));

    const { session: mailSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: mailSession.id, names: ['wait_event'] });
    const cloud = require('../electron/cloud-connector-common');
    const future = Date.now() + 60000;
    cloud._setDeps({
      session: {
        getValidTokens: async () => ({ access_token: 'token' }),
        loadTokens: (provider) => ({ access_token: 'token', account: 'cuenta@example.com',
          scope: provider === 'google' ? 'https://www.googleapis.com/auth/gmail.readonly'
            : provider === 'github' ? 'repo' : 'Mail.Read' }),
      },
      fetch: async (url) => {
        if (url.includes('/messages/msg01')) {
          return new Response(JSON.stringify({ id: 'msg01', threadId: 't1', internalDate: String(future), snippet: 'Nuevo estado',
            payload: { headers: [{ name: 'Subject', value: 'Estado listo' }] } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('gmail.googleapis.com')) {
          return new Response(JSON.stringify({ messages: [{ id: 'msg01', threadId: 't1' }] }),
            { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('graph.microsoft.com')) {
          return new Response(JSON.stringify({ value: [{ id: 'AAMkAD01', conversationId: 'c1', subject: 'Estado Outlook',
            from: { emailAddress: { name: 'Banco', address: 'banco@example.com' } }, toRecipients: [],
            receivedDateTime: new Date(future).toISOString(), bodyPreview: 'Nuevo estado', hasAttachments: false, isRead: false }] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/repos/acme/app/actions/runs?')) {
          state.githubListPolls += 1;
          const run = (id, age) => ({ id, name: 'CI', status: 'completed', conclusion: 'success',
            created_at: new Date(Date.now() - age).toISOString() });
          const runs = [run(100, 30000), run(99, 60000)];
          if (state.githubListPolls >= 3) runs.unshift(run(101, 0));
          return new Response(JSON.stringify({ workflow_runs: runs }),
            { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('api.github.com/actions/runs/77') || url.includes('/actions/runs/77')) {
          state.githubPolls += 1;
          const completed = state.githubPolls > 1;
          return new Response(JSON.stringify({ id: 77, name: 'CI', status: completed ? 'completed' : 'in_progress',
            conclusion: completed ? 'success' : null, html_url: 'https://github.com/acme/app/actions/runs/77',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
          { status: 200, headers: { 'content-type': 'application/json' } });
        }
        throw new Error(`URL inesperada: ${url}`);
      },
    });
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('wait_event', { kind: 'gmail_new', query: 'from:banco', timeout_s: 5 })], { stopReason: 'toolUse' }),
        (context) => {
          assert.match(JSON.stringify(context.messages), /Estado listo/);
          return fauxAssistantMessage('Correo de Gmail detectado');
        },
      ]);
      await runtime.handlers.agent_message_send({ session_id: mailSession.id, content: 'Espera un correo', request_id: 'gmail-wait' });
      await idle(mailSession.id);
      const gmailCall = await toolCall(mailSession.id, 'wait_event');
      assert.equal(JSON.parse(gmailCall.result).event, 'message');
      assert.equal(JSON.parse(gmailCall.result).message.subject, 'Estado listo');
      await until(async () => (await messages(mailSession.id)).messages.some((message) => message.content === 'Correo de Gmail detectado'));

      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('wait_event', { kind: 'outlook_new', from: 'banco@example.com', timeout_s: 5 })], { stopReason: 'toolUse' }),
        (context) => {
          assert.match(JSON.stringify(context.messages), /Estado Outlook/);
          return fauxAssistantMessage('Correo de Outlook detectado');
        },
      ]);
      await runtime.handlers.agent_message_send({ session_id: mailSession.id, content: 'Espera el correo de Outlook', request_id: 'outlook-wait' });
      await idle(mailSession.id);
      const outlookCall = await toolCall(mailSession.id, 'wait_event');
      assert.equal(JSON.parse(outlookCall.result).event, 'message');
      assert.equal(JSON.parse(outlookCall.result).message.subject, 'Estado Outlook');
      await until(async () => (await messages(mailSession.id)).messages.some((message) => message.content === 'Correo de Outlook detectado'));

      state.githubPolls = 0;
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('wait_event', {
          kind: 'github_run', repo: 'acme/app', run_id: '77', timeout_s: 5,
        })], { stopReason: 'toolUse' }),
        (context) => {
          assert.match(JSON.stringify(context.messages), /completed/);
          return fauxAssistantMessage('CI completada');
        },
      ]);
      await runtime.handlers.agent_message_send({ session_id: mailSession.id, content: 'Espera la CI', request_id: 'github-wait' });
      await idle(mailSession.id);
      const githubCall = await toolCall(mailSession.id, 'wait_event');
      assert.equal(JSON.parse(githubCall.result).event, 'completed');
      assert.equal(JSON.parse(githubCall.result).run.conclusion, 'success');
      await until(async () => (await messages(mailSession.id)).messages.some((message) => message.content === 'CI completada'));

      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('wait_event', {
          kind: 'github_run', repo: 'acme/app', branch: 'main', timeout_s: 10,
        })], { stopReason: 'toolUse' }),
        fauxAssistantMessage('CI nueva completada'),
      ]);
      await runtime.handlers.agent_message_send({ session_id: mailSession.id, content: 'Espera la próxima CI', request_id: 'github-new-wait' });
      await idle(mailSession.id);
      const nextGithubCall = await toolCall(mailSession.id, 'wait_event');
      assert.equal(JSON.parse(nextGithubCall.result).run.id, 101,
        'esperar la siguiente CI ignora todas las ejecuciones que ya existían al comenzar');
    } finally {
      cloud._setDeps(null);
    }

    const health = require('node:http').createServer((req, res) => { res.writeHead(200); res.end('ok'); });
    await new Promise((resolve) => health.listen(0, '127.0.0.1', resolve));
    try {
      const healthUrl = `http://127.0.0.1:${health.address().port}/health`;
      const { session: httpSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
      await runtime.handlers.agent_tools_set({ session_id: httpSession.id, names: ['wait_event'] });
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('wait_event', { kind: 'http', url: healthUrl, expect_status: 200, timeout_s: 5 })], { stopReason: 'toolUse' }),
        (context) => {
          assert.match(JSON.stringify(context.messages), /ready/);
          return fauxAssistantMessage('Despliegue listo');
        },
      ]);
      await runtime.handlers.agent_message_send({ session_id: httpSession.id, content: 'Espera el despliegue', request_id: 'http-wait' });
      await idle(httpSession.id);
      const httpCall = await toolCall(httpSession.id, 'wait_event');
      assert.equal(JSON.parse(httpCall.result).event, 'ready');
      assert.equal(JSON.parse(httpCall.result).status, 200);
      await until(async () => (await messages(httpSession.id)).messages.some((message) => message.content === 'Despliegue listo'));
    } finally {
      await new Promise((resolve) => health.close(resolve));
    }

    const { session: fileSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: fileSession.id, names: ['wait_event'] });
    fs.mkdirSync(path.join(workspace, 'build'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'build', 'tarde.txt'), 'antes', 'utf8');    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('wait_event', {
        kind: 'file', path: 'build/tarde.txt', condition: 'changed', timeout_s: 8,
      })], { stopReason: 'toolUse' }),
    ]);
    await runtime.handlers.agent_message_send({ session_id: fileSession.id, content: 'Espera el archivo tardío', request_id: 'restart-wait' });
    const checks = state.pathChecks;
    await until(() => state.pathChecks > checks + 1);
    await until(async () => (await runtime.activitySnapshot()).find((item) => item.id === fileSession.id)?.status === 'waiting_event');
    await runtime.shutdown();
    fs.writeFileSync(path.join(workspace, 'build', 'tarde.txt'), 'después', 'utf8');
    faux = await open([(context) => {
      assert.match(JSON.stringify(context.messages), /changed/);
      return fauxAssistantMessage('Archivo detectado');
    }]);
    await until(async () => (await messages(fileSession.id)).messages.some((message) => message.content === 'Archivo detectado'));
    await idle(fileSession.id);
    const replayCall = await toolCall(fileSession.id, 'wait_event');
    assert.equal(replayCall.status, 'done', 'la espera segura se recupera tras reiniciar');
    assert.equal(JSON.parse(replayCall.result).event, 'changed', 'la huella previa sobrevive al reinicio');

    const { profile } = await runtime.handlers.agent_profile_save({
      name: 'Auditor evento', instructions: 'SOLO_EVENTO: verifica los documentos', tools: null,
    });
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: parent.id, names: ['agent_delegate', 'wait_event', 'canvas_list'] });
    const respond = (context) => {
      const source = JSON.stringify(context.messages);
      if (source.includes('SOLO_EVENTO')) {
        if (source.includes('"role":"toolResult"')) return fauxAssistantMessage('Hallazgo EVENTO');
        return fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' });
      }
      if (source.includes('"toolName":"wait_event"')) return fauxAssistantMessage('Resultado integrado');
      const child = source.match(/delegate-[0-9a-f]{24}/);
      if (child) {
        return fauxAssistantMessage([fauxToolCall('wait_event', {
          kind: 'delegation', session_id: child[0], timeout_s: 8,
        })], { stopReason: 'toolUse' });
      }
      return fauxAssistantMessage([fauxToolCall('agent_delegate', {
        agent: profile.id, task: 'Verifica los documentos',
      })], { stopReason: 'toolUse' });
    };
    faux.setResponses(Array.from({ length: 10 }, () => respond));
    await require('../electron/agent-tasks').stop();
    await runtime.handlers.agent_message_send({ session_id: parent.id, content: 'Delega y espera el resultado', request_id: 'delegate-wait' });
    await until(async () => (await messages(parent.id)).messages
      .flatMap((message) => message.tool_calls || []).some((call) => call.name === 'wait_event' && call.status === 'running'));
    require('../electron/agent-tasks').start();
    await idle(parent.id);
    await until(async () => (await messages(parent.id)).messages.some((message) => message.content === 'Resultado integrado'));
    const parentMessages = (await messages(parent.id)).messages;
    const waitCall = parentMessages.flatMap((message) => message.tool_calls || []).findLast((call) => call.name === 'wait_event');
    assert.equal(waitCall.status, 'done');
    assert.equal(JSON.parse(waitCall.result).event, 'delivered');
    assert.match(JSON.parse(waitCall.result).result, /Hallazgo EVENTO/);
    assert.ok(parentMessages.some((message) => message.content === 'Resultado integrado'));
    assert.ok(!parentMessages.some((message) => /devolvió su encargo/.test(message.content)),
      'la delegación esperada no se entrega otra vez como mensaje');
    const child = (await runtime.handlers.agent_sessions_list()).sessions.find((item) => item.delegation?.parent_session_id === parent.id);
    assert.equal(child.delegation.status, 'delivered');

    const { session: cancelSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: cancelSession.id, names: ['wait_event'] });
    faux.setResponses([fauxAssistantMessage([fauxToolCall('wait_event', { kind: 'time', seconds: 60 })], { stopReason: 'toolUse' })]);
    await runtime.handlers.agent_message_send({ session_id: cancelSession.id, content: 'Espera un minuto', request_id: 'cancel-wait' });
    await until(async () => (await messages(cancelSession.id)).running);
    await until(async () => (await messages(cancelSession.id)).messages
      .flatMap((message) => message.tool_calls || []).some((call) => call.name === 'wait_event' && call.status === 'running'));
    assert.equal((await runtime.handlers.agent_turn_cancel({ session_id: cancelSession.id })).cancelled, true);
    await idle(cancelSession.id);
    assert.ok(!(await runtime.handlers.agent_turn_status({ session_id: cancelSession.id })).running,
      'Detener interrumpe la espera y cierra el turno');

    const controlTasks = require('../electron/agent-tasks');
    const { profile: controller } = await runtime.handlers.agent_profile_save({
      name: 'Control', instructions: 'SOLO_CONTROL: revisa sin escribir', tools: null,
    });
    const { session: controlParent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: controlParent.id,
      names: ['agent_delegate', 'agent_check', 'agent_message', 'agent_stop', 'canvas_list'] });
    const controlSources = [];
    const controlTurn = (context) => {
      const source = JSON.stringify(context.messages);
      if (source.includes('SOLO_CONTROL')) {
        if (source.includes('Mensaje del agente principal para este encargo')) {
          controlSources.push(source);
          return fauxAssistantMessage('Comprobante añadido y encargo cerrado');
        }
        if (!source.includes('"role":"toolResult"')) return fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' });
        return fauxAssistantMessage('Sigo trabajando');
      }
      if (source.includes('Informe de «Control»')) return fauxAssistantMessage('Informe de control recibido');
      if (source.includes('Comprueba y actualiza el control')) {
        if (!source.includes('"toolName":"agent_check"')) return fauxAssistantMessage([
          fauxToolCall('agent_check', { session_id: controlChild.id })], { stopReason: 'toolUse' });
        if (!source.includes('"toolName":"agent_message"')) return fauxAssistantMessage([
          fauxToolCall('agent_message', { session_id: controlChild.id, message: 'Añade el comprobante del canvas' })], { stopReason: 'toolUse' });
        return fauxAssistantMessage('Control en marcha');
      }
      if (!source.includes('"toolName":"agent_delegate"')) return fauxAssistantMessage([
        fauxToolCall('agent_delegate', { agent: controller.id, task: 'Investiga con control' })], { stopReason: 'toolUse' });
      return fauxAssistantMessage('Delegación con control creada');
    };
    slow = true;
    faux.setResponses(Array.from({ length: 20 }, () => controlTurn));
    await runtime.handlers.agent_message_send({ session_id: controlParent.id, content: 'Delega con control', request_id: 'control-delegate' });
    await idle(controlParent.id);
    const controlChild = (await runtime.handlers.agent_sessions_list()).sessions
      .find((item) => item.delegation?.parent_session_id === controlParent.id);
    assert.ok(controlChild, 'la delegación de control existe');
    await until(async () => (await runtime.handlers.agent_sessions_list()).sessions
      .find((item) => item.id === controlChild.id).delegation.status === 'working');
    const listedControl = await controlTasks.checkDelegations({}, controlParent.id);
    assert.equal(listedControl.delegations.length, 1, 'agent_check enumera las delegaciones pendientes o en marcha');
    assert.equal(listedControl.delegations[0].session_id, controlChild.id);
    assert.equal(listedControl.delegations[0].state, 'trabajando');
    await runtime.handlers.agent_message_send({ session_id: controlParent.id, content: 'Comprueba y actualiza el control', request_id: 'control-actions' });
    await idle(controlParent.id);
    const controlCalls = (await runtime.handlers.agent_messages_list({ session_id: controlParent.id })).messages
      .flatMap((message) => message.tool_calls || []);
    const checked = JSON.parse(controlCalls.find((call) => call.name === 'agent_check').result);
    assert.equal(checked.status, 'working');
    assert.equal(checked.agent, 'Control');
    assert.equal(checked.state, 'trabajando');
    assert.equal(JSON.parse(controlCalls.find((call) => call.name === 'agent_message').result).sent, true);
    slow = false;
    await until(async () => (await messages(controlParent.id)).messages
      .some((message) => message.content === 'Informe de control recibido'));
    await idle(controlParent.id);
    assert.equal(controlSources.length, 1, 'el hijo recibe el mensaje del padre en su turno en curso');
    assert.match(controlSources[0], /Mensaje del agente principal para este encargo: Añade el comprobante del canvas/);
    assert.equal(controlSources[0].split('Añade el comprobante del canvas').length - 1, 1, 'el mensaje llega una sola vez');
    assert.equal((await runtime.handlers.agent_sessions_list()).sessions
      .find((item) => item.id === controlChild.id).delegation.status, 'delivered');
    assert.deepEqual((await controlTasks.checkDelegations({}, controlParent.id)).delegations, [],
      'agent_check deja de listar la delegación entregada');
    const deliveredView = await controlTasks.checkDelegations({ session_id: controlChild.id }, controlParent.id);
    assert.equal(deliveredView.status, 'delivered');
    assert.equal(deliveredView.state, 'entregada');
    assert.equal(deliveredView.last_tool.name, 'canvas_list');
    const { session: stopParent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: stopParent.id,
      names: ['agent_delegate', 'agent_check', 'agent_stop', 'canvas_list'] });
    const stopTurn = (context) => {
      const source = JSON.stringify(context.messages);
      if (source.includes('SOLO_CONTROL')) {
        if (!source.includes('"role":"toolResult"')) return fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' });
        return fauxAssistantMessage('Sigo trabajando');
      }
      if (source.includes('Detén el encargo')) {
        if (!source.includes('"toolName":"agent_stop"')) return fauxAssistantMessage([
          fauxToolCall('agent_stop', { session_id: stopChild.id, reason: 'El usuario cambió de plan' })], { stopReason: 'toolUse' });
        return fauxAssistantMessage('Delegación detenida');
      }
      if (!source.includes('"toolName":"agent_delegate"')) return fauxAssistantMessage([
        fauxToolCall('agent_delegate', { agent: controller.id, task: 'Investiga para detener' })], { stopReason: 'toolUse' });
      return fauxAssistantMessage('Delegación para detener creada');
    };
    slow = true;
    faux.setResponses(Array.from({ length: 12 }, () => stopTurn));
    await runtime.handlers.agent_message_send({ session_id: stopParent.id, content: 'Delega algo que detendré', request_id: 'stop-delegate' });
    await idle(stopParent.id);
    const stopChild = (await runtime.handlers.agent_sessions_list()).sessions
      .find((item) => item.delegation?.parent_session_id === stopParent.id);
    assert.ok(stopChild, 'la delegación que se detendrá existe');
    await until(async () => (await runtime.handlers.agent_sessions_list()).sessions
      .find((item) => item.id === stopChild.id).delegation.status === 'working');
    await runtime.handlers.agent_message_send({ session_id: stopParent.id, content: 'Detén el encargo', request_id: 'stop-request' });
    await idle(stopParent.id);
    const stopCall = (await messages(stopParent.id)).messages
      .flatMap((message) => message.tool_calls || []).find((call) => call.name === 'agent_stop');
    assert.equal(JSON.parse(stopCall.result).stopped, true);
    const stoppedView = await controlTasks.checkDelegations({ session_id: stopChild.id }, stopParent.id);
    assert.equal(stoppedView.status, 'cancelled');
    assert.equal(stoppedView.state, 'cancelada');
    assert.equal(stoppedView.reason, 'El usuario cambió de plan');
    await assert.rejects(controlTasks.sendMessage({ session_id: stopChild.id, message: 'Sigue' }, stopParent.id, {}), /ya terminó/);
    await assert.rejects(controlTasks.checkDelegations({ session_id: controlChild.id }, stopParent.id), /no es una delegación/);
    slow = false;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const stopMessages = (await messages(stopParent.id)).messages;
    assert.ok(!stopMessages.some((message) => /devolvió su encargo|Informe de «Control»/.test(message.content)),
      'una delegación detenida no entrega su informe');

    console.log('[PASS] wait_event: tiempo, archivo, timeout, reinicio, AutoIMG, shell job, Gmail, Outlook, GitHub, HTTP, delegación y cancelación. '
      + 'Delegaciones: consulta de estado, mensaje al hijo en curso y parada sin informe.');
  } finally {
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
