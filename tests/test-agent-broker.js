'use strict';

const { assert, finish } = require('./helpers/harness');
const runtime = require('../electron/agent-runtime');
const execution = require('../electron/agent-execution');
const { ctx } = require('../electron/agent-shared');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(60);
  }
  return false;
}

async function waitIdle(sessionId) {
  return waitFor(async () => !(await runtime.handlers.agent_turn_status({ session_id: sessionId })).running);
}

function makeBridge() {
  const state = { approvals: new Map(), seq: 0, dispatches: [], undoCalls: [] };
  const bridge = async (method, params) => {
    switch (method) {
      case 'agent_internal_tools':
        return {
          tools: [
            {
              name: 'fs_write', description: 'Escribe un archivo', gated: true, kind: 'backend', module: 'computer',
              inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, overwrite: { type: 'boolean' } } },
            },
            {
              name: 'shell_run', description: 'Ejecuta un comando', gated: true, kind: 'backend', module: 'computer',
              inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
            },
          ],
        };
      case 'agent_internal_provider':
        return { provider: 'faux', style: 'openai_chat', base_url: 'http://x', api_key: 'k', auth_type: 'api_key', extra_headers: {}, default_model: 'faux-1' };
      case 'agent_internal_approval_ensure': {
        let found = [...state.approvals.values()].find((a) => a.call_id === params.call_id);
        if (!found) {
          found = {
            id: `ap-${++state.seq}`, session_id: params.session_id, call_id: params.call_id,
            method: params.method, params: params.params, status: 'pending', channel: params.channel || null,
            source: null, created_at: Date.now(), decided_at: null,
          };
          state.approvals.set(found.id, found);
        }
        return { approval: { ...found } };
      }
      case 'agent_internal_approval_status': {
        const approval = state.approvals.get(params.approval_id);
        return { approval: approval ? { ...approval } : null };
      }
      case 'agent_internal_approval_decide': {
        const approval = state.approvals.get(params.approval_id);
        if (!approval || approval.status !== 'pending') throw new Error('Aprobación inexistente o ya decidida');
        approval.status = params.approve ? 'approved' : 'denied';
        approval.source = params.source || 'manual';
        approval.decided_at = Date.now();
        return { approval: { ...approval } };
      }
      case 'agent_internal_approvals_pending':
        return {
          approvals: [...state.approvals.values()]
            .filter((a) => a.session_id === params.session_id && a.status === 'pending'),
        };
      case 'agent_internal_approvals_deny_session': {
        const denied = [];
        for (const approval of state.approvals.values()) {
          if (approval.session_id === params.session_id && approval.status === 'pending') {
            approval.status = 'denied';
            approval.source = 'cancel';
            denied.push(approval.id);
          }
        }
        return { denied };
      }
      case 'agent_internal_dispatch': {
        const approval = params.approval_id ? state.approvals.get(params.approval_id) : null;
        if (params.meta) {
          const record = {
            session_id: params.session_id, call_id: params.call_id, method: params.name,
            channel: params.channel || (approval && approval.channel) || null,
            approval_source: (approval && approval.source) || 'none',
            op_id: `op-${params.call_id}`, status: 'running', result: null,
          };
          state.dispatches.push(record);
          return { execute: 'meta', dispatch: record };
        }
        const record = {
          session_id: params.session_id, call_id: params.call_id, method: params.name,
          channel: params.channel || (approval && approval.channel) || null,
          approval_source: (approval && approval.source) || 'none',
          status: 'succeeded', result: JSON.stringify({ ok: true, tool: params.name }),
          ...(params.name === 'fs_write' ? { undo: { available: true, kind: 'delete' } } : {}),
        };
        state.dispatches.push(record);
        return { result: record.result, dispatch: record };
      }
      case 'agent_internal_dispatch_result': {
        const record = state.dispatches.find((d) => d.session_id === params.session_id && d.call_id === params.call_id);
        return { result: record ? record.result : null };
      }
      case 'agent_internal_dispatch_cancel': return { cancelled: false };
      case 'agent_internal_dispatch_finish': {
        const record = state.dispatches.find((d) => d.op_id === params.op_id);
        if (!record) throw new Error(`dispatch_finish sin reserva: ${params.op_id}`);
        record.status = 'succeeded';
        record.result = params.result;
        return { result: params.result };
      }
      case 'agent_internal_effects':
        return { dispatches: state.dispatches.filter((d) => d.session_id === params.session_id)
          .map(({ result, ...rest }) => rest) };
      case 'agent_internal_effect_undo':
        state.undoCalls.push(params);
        return { undone: true, call_id: params.call_id, path: 'C:\\tmp\\archivo.txt' };
      case 'agent_internal_mentions': return { modules: [], unknown: [], ambiguous: [] };
      case 'agent_internal_memory_context': return { context: '', items: [] };
      case 'agent_internal_artifacts': return { artifacts: [], questions: [], context: { files: [], accounts: [] } };
      case 'agent_internal_activity': return { attention: {} };
      case 'agent_internal_grants_add': return { granted: [], rejected: [] };
      case 'agent_internal_grants_revoke': return { revoked: 0 };
      case 'agent_internal_grant_remove': return { removed: 0 };
      default: throw new Error(`bridge desconocido: ${method}`);
    }
  };
  return { bridge, state };
}

async function open(responses) {
  const { MemoryStorage } = await import('@earendil-works/pi-durable');
  const { fauxProvider } = await import('@earendil-works/pi-ai');
  const { bridge, state } = makeBridge();
  await runtime.open({ storage: new MemoryStorage(), bridge, skipImport: true });
  const faux = fauxProvider();
  runtime._internal._providerOverrides.set('faux', faux.provider);
  faux.setResponses(responses);
  return { faux, state };
}

async function createSession() {
  const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
  return session;
}

async function main() {
  const { fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');

  {
    await open([]);
    const session = await createSession();
    const saved = await runtime.handlers.agent_session_rules_set({
      id: session.id, rules: { files: 'allow', terminal: 'ask' },
    });
    assert(saved.session.approval_rules.files === 'allow' && saved.session.approval_rules.terminal === 'ask',
      'las reglas por canal se guardan en la conversación');
    assert(saved.audit && saved.audit.some((entry) => entry.scope === 'session' && entry.channel === 'files'),
      'la sesión registra la auditoría de sus reglas');
    const listed = await runtime.handlers.agent_sessions_list({});
    assert(listed.sessions.find((item) => item.id === session.id).approval_rules.files === 'allow',
      'la lista pública de conversaciones conserva las reglas');
    const changed = await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' });
    assert(changed.session.approval_rules.files === 'allow', 'cambiar el modo conserva las reglas');
    for (const rules of [{ terminal: 'allow' }, { other: 'allow' }, { files: 'nope' }, { desconocido: 'ask' }]) {
      let rejected = false;
      try { await runtime.handlers.agent_session_rules_set({ id: session.id, rules }); } catch { rejected = true; }
      assert(rejected, `se rechaza la regla inválida ${JSON.stringify(rules)}`);
    }
    const cleared = await runtime.handlers.agent_session_rules_set({ id: session.id, rules: {} });
    assert(!cleared.session.approval_rules, 'vaciar las reglas vuelve a heredar el modo');
    const policy = await runtime.handlers.agent_policy_rules_set({ rules: { files: 'allow' } });
    assert(policy.rules.files === 'allow' && policy.audit.some((entry) => entry.scope === 'global' && entry.to === 'allow'),
      'las reglas globales se guardan y se auditan');
    const read = await runtime.handlers.agent_policy_get({});
    assert(read.rules.files === 'allow' && read.audit.length >= 1, 'la política global se puede releer');
    await runtime.shutdown();
  }

  {
    const { faux, state } = await open([
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'global-allow.txt', content: 'x' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'session-deny.txt', content: 'x' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('bloqueado'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_policy_rules_set({ rules: { files: 'allow' } });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'primero' });
    assert(await waitIdle(session.id), 'el turno con regla global allow termina');
    assert(state.dispatches.length === 1 && state.dispatches[0].approval_source === 'rule',
      'la regla global permite el efecto');
    await runtime.handlers.agent_session_rules_set({ id: session.id, rules: { files: 'deny' } });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'segundo' });
    assert(await waitIdle(session.id), 'el turno con override de sesión termina');
    assert(state.dispatches.length === 1, 'la regla de sesión bloquea aunque la global permita');
    faux.setResponses([]);
    await runtime.shutdown();
  }

  {
    const { state } = await open([
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'a.txt', content: 'x' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_session_rules_set({ id: session.id, rules: { files: 'allow' } });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'escribe' });
    assert(await waitIdle(session.id), 'el turno con regla allow termina');

    const [approval] = [...state.approvals.values()];
    assert(approval && approval.status === 'approved' && approval.source === 'rule',
      'la aprobación automática conserva su fuente rule');
    assert(state.dispatches.length === 1 && state.dispatches[0].approval_source === 'rule',
      'el dispatch registra que la acción la permitió una regla');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const call = listed.messages.flatMap((message) => message.tool_calls || []).find((item) => item.name === 'fs_write');
    assert(call && call.channel === 'files' && call.approval_source === 'rule',
      'el recibo proyecta canal y fuente');
    assert(call.undo && call.undo.available === true && call.dispatch_id === state.dispatches[0].call_id,
      'el recibo expone el id durable y la posibilidad de deshacer');
    const undone = await runtime.handlers.agent_effect_undo({ session_id: session.id, call_id: call.dispatch_id });
    assert(undone.undone === true && state.undoCalls.length === 1,
      'Undo llega al backend con el id durable de la acción');
    assert(await waitFor(async () => {
      const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
      return messages.some((message) => /deshizo/.test(String(message.content)) && /archivo\.txt/.test(String(message.content)));
    }), 'el Undo avisa al agente de que el archivo ya no conserva lo escrito');
    await runtime.shutdown();
  }

  {
    const { state } = await open([
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'b.txt', content: 'x' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('bloqueado'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_session_rules_set({ id: session.id, rules: { files: 'deny' } });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'escribe' });
    assert(await waitIdle(session.id), 'el turno bloqueado por regla termina');

    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const call = listed.messages.flatMap((message) => message.tool_calls || []).find((item) => item.name === 'fs_write');
    assert(state.dispatches.length === 0 && call && call.status === 'denied'
      && /bloqueó el canal/i.test(String(call.result || '')),
      'una regla deny bloquea sin ejecutar y deja el motivo en el resultado');
    await runtime.shutdown();
  }

  {
    const { state } = await open([
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'c.txt', content: 'x' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'escribe' });
    assert(await waitFor(() => [...state.approvals.values()].some((a) => a.status === 'pending')),
      'sin reglas la acción sigue pidiendo aprobación');
    const [approval] = [...state.approvals.values()];
    await runtime.handlers.agent_approve({ approval_id: approval.id });
    assert(await waitIdle(session.id), 'el turno manual termina');
    assert(approval.source === 'manual' && state.dispatches[0].approval_source === 'manual',
      'la aprobación manual se distingue de una regla');
    await runtime.shutdown();
  }

  {
    const { state } = await open([
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'quick-rule.txt', content: 'x' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'quick-rule-2.txt', content: 'y' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho otra vez'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'primero' });
    assert(await waitFor(() => [...state.approvals.values()].some((a) => a.status === 'pending')),
      'la primera acción sigue pidiendo aprobación');
    const [first] = [...state.approvals.values()];
    await runtime.handlers.agent_approve({ approval_id: first.id, channel: 'files', rule: 'allow' });
    assert(await waitIdle(session.id), 'la aprobación con regla rápida termina');
    const listed = await runtime.handlers.agent_sessions_list({});
    assert(listed.sessions.find((item) => item.id === session.id).approval_rules.files === 'allow',
      'la regla rápida se guarda durante la aprobación pendiente');
    const policy = await runtime.handlers.agent_policy_get({});
    assert(policy.audit.some((entry) => entry.channel === 'files' && entry.to === 'allow'),
      'la regla rápida se audita');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'segundo' });
    assert(await waitIdle(session.id), 'el segundo turno termina');
    assert(state.dispatches.length === 2 && state.dispatches[1].approval_source === 'rule',
      'la regla rápida permite la siguiente acción del canal');
    assert([...state.approvals.values()].filter((a) => a.status === 'pending').length === 0,
      'la segunda acción no vuelve a pedir aprobación');
    await runtime.shutdown();
  }

  {
    const { state } = await open([
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'remember.txt', content: 'x' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'remember-2.txt', content: 'y' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho otra vez'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'primero' });
    assert(await waitFor(() => [...state.approvals.values()].some((a) => a.status === 'pending')),
      'la primera acción pide aprobación antes de recordar');
    const [first] = [...state.approvals.values()];
    await runtime.handlers.agent_approve({ approval_id: first.id, remember: true });
    assert(await waitIdle(session.id), 'la aprobación recordada termina');
    const listed = await runtime.handlers.agent_sessions_list({});
    assert(listed.sessions.find((item) => item.id === session.id).approval_rules.files === 'allow',
      'recordar guarda la regla de sesión del canal de la herramienta');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'segundo' });
    assert(await waitIdle(session.id), 'el segundo turno termina sin decisión manual');
    const approvals = [...state.approvals.values()];
    assert(approvals.filter((a) => a.source === 'manual').length === 1
      && approvals.every((a) => a.status === 'approved'),
      'recordar evita una segunda aprobación manual del mismo método');
    assert(state.dispatches.length === 2 && state.dispatches[1].approval_source === 'rule',
      'la segunda llamada se ejecuta por la regla recordada');
    await runtime.shutdown();
  }

  {
    const { state } = await open([
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'remember-deny.txt', content: 'x' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('rechazado'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'escribe' });
    assert(await waitFor(() => [...state.approvals.values()].some((a) => a.status === 'pending')),
      'la acción pide aprobación');
    const [approval] = [...state.approvals.values()];
    await runtime.handlers.agent_deny({ approval_id: approval.id, remember: true });
    assert(await waitIdle(session.id), 'el turno rechazado termina');
    const listed = await runtime.handlers.agent_sessions_list({});
    assert(!listed.sessions.find((item) => item.id === session.id).approval_rules,
      'recordar un rechazo no guarda ninguna regla de permiso');
    await runtime.shutdown();
  }

  {
    const { state } = await open([
      fauxAssistantMessage([fauxToolCall('shell_run', { command: 'Remove-Item .\\tmp -Recurse' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'ejecuta' });
    assert(await waitFor(() => [...state.approvals.values()].some((a) => a.status === 'pending')),
      'un comando que borra archivos sigue pidiendo aprobación incluso en Acceso completo');
    assert(state.dispatches.length === 0, 'el comando no se ejecuta antes de decidir');
    const [approval] = [...state.approvals.values()];
    await runtime.handlers.agent_approve({ approval_id: approval.id });
    assert(await waitIdle(session.id), 'el turno del terminal termina');
    await runtime.shutdown();
  }

  {
    const due = new Date(Date.now() + 60000).toISOString();
    const { state } = await open([
      fauxAssistantMessage([fauxToolCall('task_schedule', { action: 'create', content: 'Revisa el estado', due_at: due })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('programado'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'programa la revisión' });
    assert(await waitFor(() => [...state.approvals.values()].some((a) => a.method === 'task_schedule' && a.status === 'pending')),
      'task_schedule create pide aprobación');
    const [approval] = [...state.approvals.values()];
    assert(approval.channel === 'agenda', 'la aprobación pertenece al canal agenda');
    assert(state.dispatches.length === 0, 'el encargo no se crea antes de decidir');
    await runtime.handlers.agent_approve({ approval_id: approval.id });
    assert(await waitIdle(session.id), 'el turno programado termina');
    assert(state.dispatches.length === 1, 'el encargo se despacha una vez');
    const [dispatch] = state.dispatches;
    assert(dispatch.method === 'task_schedule' && dispatch.channel === 'agenda'
      && dispatch.approval_source === 'manual', 'el recibo registra canal agenda y aprobación manual');
    assert(dispatch.status === 'succeeded' && JSON.parse(dispatch.result).scheduled.content === 'Revisa el estado',
      'schedule se ejecutó y el op_id quedó cerrado');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const call = listed.messages.flatMap((message) => message.tool_calls || []).find((item) => item.name === 'task_schedule');
    assert(call && call.status === 'done' && call.channel === 'agenda' && call.approval_source === 'manual',
      'la proyección muestra el recibo del encargo');
    const recovered = {
      id: 'ap-recovered', session_id: session.id, call_id: 'recovered@task:recovered-task',
      method: 'task_schedule', params: { action: 'create', content: 'Reintento', due_at: due },
      status: 'approved', source: 'manual', channel: 'agenda',
    };
    state.approvals.set(recovered.id, recovered);
    const recoveredResult = JSON.parse(await execution.dispatchApproved(recovered, ctx()));
    assert(recoveredResult.scheduled && recoveredResult.scheduled.content === 'Reintento',
      'una aprobación recuperada de agenda ejecuta el encargo');
    const recoveredDispatch = state.dispatches.find((item) => item.call_id === recovered.call_id);
    assert(recoveredDispatch && recoveredDispatch.channel === 'agenda'
      && recoveredDispatch.approval_source === 'manual', 'la aprobación recuperada conserva su recibo');
    await runtime.shutdown();
  }

  {
    const { state } = await open([
      fauxAssistantMessage([fauxToolCall('task_schedule', { action: 'list' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('sin encargos'),
    ]);
    const session = await createSession();
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'lista mis encargos' });
    assert(await waitIdle(session.id), 'listar encargos no espera aprobación');
    assert(state.approvals.size === 0 && state.dispatches.length === 0,
      'action list no crea aprobación ni recibo');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const call = listed.messages.flatMap((message) => message.tool_calls || []).find((item) => item.name === 'task_schedule');
    assert(call && call.status === 'done' && JSON.parse(call.result).tasks.length === 0,
      'action list ejecuta la lectura directa');
    await runtime.shutdown();
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
