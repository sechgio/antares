'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { assert, finish } = require('./helpers/harness');

const runtime = require('../electron/agent-runtime');
const importer = require('../electron/agent-import');
const { METHODS, INTERNAL_METHODS: INTERNAL_SET, nativeDispatchFor } = require('../shared/ipc-method-catalog');

const PUBLIC_METHODS = [
  'agent_sessions_list', 'agent_session_create', 'agent_session_delete',
  'agent_messages_list', 'agent_message_send', 'agent_tools_list', 'agent_tools_set',
  'agent_turn_status', 'agent_turn_cancel', 'agent_approve', 'agent_deny', 'agent_attach', 'agent_context_remove_file',
  'agent_profiles_list', 'agent_profile_save', 'agent_profile_delete', 'agent_session_rename', 'agent_session_model_set',
];
const INTERNAL_RPCS = [
  'agent_internal_tools', 'agent_internal_provider',
  'agent_internal_approval_ensure', 'agent_internal_approval_status',
  'agent_internal_approval_decide', 'agent_internal_approvals_pending',
  'agent_internal_approvals_deny_session', 'agent_internal_dispatch',
  'agent_internal_dispatch_result', 'agent_internal_dispatch_cancel',
  'agent_internal_grants_add', 'agent_internal_grants_revoke', 'agent_internal_mentions',
  'agent_internal_dispatch_finish',
  'agent_internal_activity', 'agent_internal_memory_context', 'agent_internal_grant_remove',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeBridge() {
  const state = { approvals: new Map(), seq: 0, dispatches: [], dispatchLog: [], grants: [], revoked: [], attention: {} };
  const bridge = async (method, params) => {
    switch (method) {
      case 'agent_internal_activity': return { attention: state.attention };
      case 'agent_internal_memory_context':
        state.memoryCalls = [...(state.memoryCalls || []), params];
        return /plantilla/.test(params.text) ? { context: 'Memoria del agente:\n- Preferencia: Plantilla — usa la B', items: ['m1'] } : { context: '', items: [] };
      case 'agent_internal_artifacts':
        return { artifacts: [], questions: [], context: { files: state.grants.flatMap((g) => g.paths.map((p) => ({ path: p, folder: false }))), accounts: ['ana@example.com'] } };
      case 'agent_internal_grant_remove':
        state.removed = [...(state.removed || []), params];
        return { removed: 1 };
      case 'agent_internal_tools':
        return {
          tools: [
            { name: 'canvas_list', description: 'Lista documentos de Canvas', gated: false, kind: 'backend', inputSchema: { type: 'object', properties: {} } },
            { name: 'db_clear', description: 'Borra datos', gated: true, kind: 'backend', inputSchema: { type: 'object', properties: {} } },
          ],
        };
      case 'agent_internal_provider':
        return { provider: params.provider, style: 'openai_chat', base_url: 'http://x', api_key: 'k', auth_type: 'api_key', extra_headers: {}, default_model: 'faux-1' };
      case 'agent_internal_approval_ensure': {
        let found = [...state.approvals.values()].find((a) => a.call_id === params.call_id);
        if (!found) {
          found = {
            id: `ap-${++state.seq}`, session_id: params.session_id, call_id: params.call_id,
            method: params.method, params: params.params, status: 'pending',
            created_at: Date.now(), decided_at: null,
          };
          state.approvals.set(found.id, found);
        }
        return { approval: { ...found } };
      }
      case 'agent_internal_approval_status': {
        const a = state.approvals.get(params.approval_id);
        return { approval: a ? { ...a } : null };
      }
      case 'agent_internal_approval_decide': {
        const a = state.approvals.get(params.approval_id);
        if (!a || a.status !== 'pending') throw new Error('Aprobación inexistente o ya decidida');
        a.status = params.approve ? 'approved' : 'denied';
        a.decided_at = Date.now();
        return { approval: { ...a } };
      }
      case 'agent_internal_approvals_pending':
        return { approvals: [...state.approvals.values()].filter((a) => a.session_id === params.session_id && a.status === 'pending') };
      case 'agent_internal_approvals_deny_session': {
        const denied = [];
        for (const a of state.approvals.values()) {
          if (a.session_id === params.session_id && a.status === 'pending') { a.status = 'denied'; denied.push(a.id); }
        }
        return { denied };
      }
      case 'agent_internal_dispatch': {
        state.dispatchLog.push(params.call_id);
        if (params.native) {
          const known = state.dispatches.find((d) => d.session_id === params.session_id && d.call_id === params.call_id);
          if (known) return { result: known.result, dispatch: known };
          if (params.gated && !params.approval_id) return { result: JSON.stringify({ error: 'requiere aprobación' }) };
          const record = { session_id: params.session_id, call_id: params.call_id, op_id: `op-${params.call_id}`, status: 'running', result: null };
          state.dispatches.push(record);
          return { result: null, dispatch: record, execute: 'native' };
        }
        const existing = state.dispatches.find((d) => d.session_id === params.session_id && d.call_id === params.call_id);
        if (existing) return { result: existing.result, dispatch: existing };
        const record = { session_id: params.session_id, call_id: params.call_id, status: 'succeeded', result: JSON.stringify({ ok: true, tool: params.name }) };
        state.dispatches.push(record);
        return { result: record.result, dispatch: record };
      }
      case 'agent_internal_dispatch_result': {
        assert(params.session_id, 'dispatch_result identifica la conversación');
        const record = state.dispatches.find((d) => d.session_id === params.session_id && d.call_id === params.call_id);
        return { result: record ? record.result : null };
      }
      case 'agent_internal_dispatch_cancel':
        return { cancelled: false };
      case 'agent_internal_grants_add':
        state.grants.push(params);
        return { granted: params.paths.filter((p) => p.endsWith('.pdf')), rejected: params.paths.filter((p) => !p.endsWith('.pdf')).map((path) => ({ path, reason: 'una carpeta requiere seleccionar los archivos concretos' })) };
      case 'agent_internal_dispatch_finish': {
        const record = state.dispatches.find((d) => d.op_id === params.op_id);
        record.status = 'succeeded';
        record.result = params.result;
        return { result: params.result };
      }
      case 'agent_internal_mentions': {
        const modules = /@sellador\b/.test(params.text) ? ['sellador'] : [];
        const unknown = /@nada\b/.test(params.text) ? ['nada'] : [];
        return modules.length
          ? { modules, unknown, ambiguous: [], labels: { sellador: 'Sellador' }, context: 'El usuario mencionó estos módulos de Antares:\n- Sellador: herramientas sellador_apply' }
          : { modules, unknown, ambiguous: [] };
      }
      case 'agent_internal_grants_revoke':
        state.revoked.push(params.session_id);
        return { revoked: 1 };
      default:
        throw new Error(`bridge desconocido: ${method}`);
    }
  };
  return { bridge, state };
}

async function openFaux(responses, bridge) {
  const { MemoryStorage } = await import('@earendil-works/pi-durable');
  const { fauxProvider } = await import('@earendil-works/pi-ai');
  await runtime.open({ storage: new MemoryStorage(), bridge, skipImport: true });
  const faux = fauxProvider();
  runtime._internal._providerOverrides.set('faux', faux.provider);
  faux.setResponses(responses);
  return faux;
}

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(120);
  }
  return false;
}

async function waitIdle(sessionId, timeoutMs = 15000) {
  return waitFor(async () => !(await runtime.handlers.agent_turn_status({ session_id: sessionId })).running, timeoutMs);
}

async function main() {
  {
    const { MemoryStorage } = await import('@earendil-works/pi-durable');
    const { bridge, state } = makeBridge();
    await runtime.open({ storage: new MemoryStorage(), bridge, skipImport: true });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    for (const expected of ['uncertain', 'waiting_input', 'waiting_approval']) {
      state.attention[session.id] = expected;
      const snapshot = await runtime.activitySnapshot();
      assert(snapshot.find((item) => item.id === session.id).status === expected, `bandeja conserva la atención durable: ${expected}`);
    }
    delete state.attention[session.id];
    runtime._internal.shared.waitingInput.add(session.id);
    assert((await runtime.activitySnapshot())[0].status === 'waiting_input', 'la pregunta viva conserva su estado en bandeja');
    runtime._internal.shared.waitingInput.delete(session.id);
    await runtime.shutdown();
  }
  const { fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');

  {
    const { bridge } = makeBridge();
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const { fauxProvider } = await import('@earendil-works/pi-ai');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-model-'));
    const dbPath = path.join(dir, 'agent.sqlite');
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const faux = fauxProvider();
    runtime._internal._providerOverrides.set('faux', faux.provider);
    faux.setResponses([fauxAssistantMessage('respuesta anterior')]);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'primera consulta' });
    assert(await waitIdle(session.id), 'el turno anterior termina antes de elegir modelo');
    const next = fauxProvider({ provider: 'otro', models: [{ id: 'otro-modelo' }] });
    runtime._internal._providerOverrides.set('otro', next.provider);
    next.setResponses([fauxAssistantMessage('respuesta del nuevo modelo')]);
    const changed = await runtime.handlers.agent_session_model_set({ id: session.id, provider: 'otro', model: next.models[0].id });
    assert(changed.session.id === session.id && changed.session.provider === 'otro', 'cambiar proveedor conserva la conversación');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'segunda consulta' });
    assert(await waitIdle(session.id), 'el turno usa el proveedor elegido');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(messages.some((m) => m.content === 'respuesta anterior') && messages.at(-1).content === 'respuesta del nuevo modelo',
      'conserva el historial y la respuesta procede del nuevo proveedor');
    assert(faux.state.callCount === 1 && next.state.callCount === 1, 'cada proveedor atiende solo su turno');
    let invalid;
    try { await runtime.handlers.agent_session_model_set({ id: session.id, provider: 'otro', model: '' }); } catch (err) { invalid = err; }
    assert(invalid, 'rechaza un modelo vacío');
    await runtime.shutdown();
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const restored = (await runtime.handlers.agent_sessions_list()).sessions.find((item) => item.id === session.id);
    assert(restored.provider === 'otro' && restored.model === 'otro-modelo', 'el modelo elegido sobrevive al reinicio de SQLite');
    const context = runtime._internal.shared.deps.chord.BACKGROUND_CONTEXT;
    const map = await runtime._internal.state().harness.snapshot(runtime._internal.state().SessionsDoc, context);
    const conv = await runtime._internal.state().harness.conversation(map.sessions[session.id].conversationId, context);
    assert((await conv.agent(context)).model.modelId === 'otro-modelo', 'la configuración durable del runtime conserva el modelo');
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-'));
    const dbPath = path.join(dir, 'agent.sqlite');
    const { bridge, state } = makeBridge();
    let added = false;
    const toolsBridge = async (method, params) => {
      const result = await bridge(method, params);
      if (method === 'agent_internal_tools' && added) result.tools.push({ name: 'mcp_new_read', description: 'Lectura MCP', kind: 'mcp', gated: false, inputSchema: { type: 'object', properties: {} } });
      return result;
    };
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge: toolsBridge, skipImport: true });
    const { session: first } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const { session: second } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const selected = await runtime.handlers.agent_tools_set({ session_id: first.id, names: ['canvas_list'] });
    assert(selected.tools.filter((t) => t.enabled).map((t) => t.name).join() === 'canvas_list', 'selección exacta por conversación');
    assert((await runtime.handlers.agent_tools_list({ session_id: second.id })).tools.every((t) => t.enabled), 'otra conversación conserva todas las herramientas');
    assert((await runtime.handlers.agent_tools_list({})).tools.every((t) => !('enabled' in t)), 'getter global conserva su contrato');
    added = true;
    assert((await runtime.handlers.agent_tools_list({ session_id: second.id })).tools.find((t) => t.name === 'mcp_new_read').enabled, 'las herramientas recién disponibles aparecen habilitadas con la selección predeterminada');
    assert(!(await runtime.handlers.agent_tools_list({ session_id: first.id })).tools.find((t) => t.name === 'mcp_new_read').enabled, 'una herramienta nueva no amplía una selección explícita');
    added = false;
    for (const names of [['agent_tools_set'], ['desconocida'], [false], 'canvas_list', undefined]) {
      let error;
      try { await runtime.handlers.agent_tools_set({ session_id: first.id, names }); } catch (err) { error = err; }
      assert(!!error, 'selección inválida o privada rechazada');
    }
    await runtime.shutdown();
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge: toolsBridge, skipImport: true });
    assert((await runtime.handlers.agent_tools_list({ session_id: first.id })).tools.filter((t) => t.enabled).map((t) => t.name).join() === 'canvas_list', 'la selección sobrevive al reinicio de SQLite');
    const recovered = await require('../electron/agent-execution').dispatchApproved({ session_id: first.id, call_id: 'recovered', method: 'db_clear', params: {}, id: 'ap-recovered' }, {});
    assert(JSON.parse(recovered).error && state.dispatchLog.length === 0, 'una aprobación recuperada no habilita una herramienta excluida');
    await runtime.handlers.agent_tools_set({ session_id: first.id, names: [] });
    assert((await runtime.handlers.agent_tools_list({ session_id: first.id })).tools.every((t) => !t.enabled), 'la selección vacía deshabilita todas');
    await runtime.handlers.agent_tools_set({ session_id: first.id, names: null });
    assert((await runtime.handlers.agent_tools_list({ session_id: first.id })).tools.every((t) => t.enabled), 'null restablece las herramientas globales');
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage([fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('no ejecutada'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'borra' });
    assert(await waitFor(() => state.approvals.size > 0), 'la llamada espera aprobación antes de deshabilitarla');
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['canvas_list'] });
    await runtime.handlers.agent_approve({ approval_id: [...state.approvals.keys()][0] });
    assert(await waitIdle(session.id), 'el turno continúa al bloquear la herramienta deshabilitada');
    assert(state.dispatchLog.length === 0, 'la aprobación pendiente no evita la nueva selección');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    let waiting = false;
    let executed = 0;
    const busyBridge = async (method, params) => {
      if (method === 'agent_internal_dispatch' && params.native && !waiting) {
        waiting = true;
        return { busy: true };
      }
      return bridge(method, params);
    };
    runtime._internal.shared.nativeTools = {
      nativeToolContext: async () => ({ tool_version: 'fake-v1' }),
      nativeToolSpecs: () => [{ name: 'autoimg_status', description: 'Estado', gated: false, kind: 'native', inputSchema: { type: 'object', properties: {} } }],
      runNativeTool: async () => { executed += 1; return { ok: true }; },
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('autoimg_status', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('bloqueada'),
    ], busyBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'consulta' });
    assert(await waitFor(() => waiting), 'el recurso nativo ocupado aplaza la ejecución');
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: [] });
    assert(await waitIdle(session.id), 'la revocación resuelve la espera por el recurso');
    assert(executed === 0 && state.dispatchLog.length === 0, 'una herramienta revocada durante la espera no reserva ni ejecuta el efecto');
    runtime._internal.shared.nativeTools = null;
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    let reserved = false;
    let release;
    const response = new Promise((resolve) => { release = resolve; });
    let executed = 0;
    const delayedBridge = async (method, params) => {
      const result = await bridge(method, params);
      if (method === 'agent_internal_dispatch' && params.native) {
        reserved = true;
        await response;
      }
      return result;
    };
    runtime._internal.shared.nativeTools = {
      nativeToolContext: async () => ({ tool_version: 'fake-v1' }),
      nativeToolSpecs: () => [{ name: 'autoimg_status', description: 'Estado', gated: false, kind: 'native', inputSchema: { type: 'object', properties: {} } }],
      runNativeTool: async () => { executed += 1; return { ok: true }; },
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('autoimg_status', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('bloqueada'),
    ], delayedBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'consulta' });
    assert(await waitFor(() => reserved), 'la reserva precede a la respuesta tardía del puente');
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: [] });
    release();
    assert(await waitIdle(session.id), 'la reserva revocada termina con comprobante');
    assert(executed === 0 && JSON.parse(state.dispatches[0].result).error.includes('deshabilitada'), 'se registra el bloqueo sin ejecutar el efecto reservado');
    runtime._internal.shared.nativeTools = null;
    await runtime.shutdown();
  }

  for (const name of PUBLIC_METHODS) {
    assert(nativeDispatchFor(name) === 'agent', `${name} → native:agent`);
  }
  for (const name of INTERNAL_RPCS) {
    assert(INTERNAL_SET.has(name), `${name} es internal:true`);
    assert(METHODS[name].handler === 'backend:agent_internal', `${name} → backend:agent_internal`);
  }

  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage([fauxToolCall('canvas_list', {}), fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
    ], bridge);

    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', title: 'T' });
    assert(session.id && !session.style && !session.conversationId, 'session_create devuelve solo el contrato público');
    const { sessions } = await runtime.handlers.agent_sessions_list({});
    assert(sessions.length === 1 && sessions[0].id === session.id, 'sessions_list incluye la sesión');

    const { tools } = await runtime.handlers.agent_tools_list({});
    assert(tools.some((t) => t.name === 'canvas_list' && !t.gated) && tools.some((t) => t.name === 'db_clear' && t.gated), 'tools_list proyecta gated');

    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'hazlo' });
    const sawPending = await waitFor(async () =>
      (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals.length > 0);
    assert(sawPending, 'la herramienta gated queda pendiente de aprobación');

    const ap = (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals[0];
    let busyModel;
    try { await runtime.handlers.agent_session_model_set({ id: session.id, provider: 'faux', model: 'otro-modelo' }); } catch (err) { busyModel = err; }
    assert(busyModel && /termine el turno/.test(busyModel.message), 'no cambia el modelo mientras un turno espera aprobación');
    assert((await runtime.handlers.agent_sessions_list()).sessions.find((item) => item.id === session.id).model === 'faux-1',
      'el rechazo conserva el modelo original');
    await runtime.handlers.agent_approve({ approval_id: ap.id });
    assert(await waitIdle(session.id), 'el turno termina tras aprobar');

    const { messages, pending_approvals } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(pending_approvals.length === 0, 'no quedan aprobaciones pendientes');
    const assistant = messages.find((m) => m.tool_calls);
    const calls = assistant.tool_calls;
    assert(calls.find((c) => c.name === 'canvas_list').status === 'done', 'herramienta segura ejecutada');
    assert(calls.find((c) => c.name === 'db_clear').status === 'done', 'herramienta aprobada ejecutada');
    assert(messages.at(-1).content === 'hecho', 'respuesta final del modelo');
    assert(state.dispatchLog.filter((id) => id === calls[1].id).length === 1, 'dispatch deduplicado: una ejecución por call_id');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(listed.messages.filter((m) => m.role === 'tool_result' && m.tool_use_id === calls[1].id).length === 1, 'sin tool_result duplicado tras aprobación');

    const idle = await runtime.handlers.agent_turn_cancel({ session_id: session.id });
    assert(idle.cancelled === false, 'turn_cancel sobre idle informa cancelled:false');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    await openFaux([fauxAssistantMessage('una vez')], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const first = await runtime.handlers.agent_message_send({ session_id: session.id, content: 'hola', request_id: 'req-1' });
    assert(first.accepted === true && !first.duplicate, 'el primer envío se admite');
    const again = await runtime.handlers.agent_message_send({ session_id: session.id, content: 'hola', request_id: 'req-1' });
    assert(again.accepted === true && again.duplicate === true, 'el reenvío con el mismo request_id es un duplicado');
    assert(await waitIdle(session.id), 'el turno termina');
    const afterIdle = await runtime.handlers.agent_message_send({ session_id: session.id, content: 'hola', request_id: 'req-1' });
    assert(afterIdle.duplicate === true, 'el duplicado se reconoce también tras terminar el turno');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(messages.filter((m) => m.role === 'user').length === 1, 'un solo mensaje de usuario en la conversación');
    assert(messages.filter((m) => m.role === 'assistant').length === 1, 'una sola respuesta del modelo');
    await runtime.shutdown();
  }

  {
    const extract = runtime._internal.extractPaths;
    const text = String.raw`Usa @sellador con C:\trabajos\informe.pdf, "C:\Mis docs\plan v2.pdf" y (D:\datos).`;
    const paths = extract(text);
    assert(JSON.stringify(paths) === JSON.stringify(['C:\\Mis docs\\plan v2.pdf', 'C:\\trabajos\\informe.pdf', 'D:\\datos']),
      'extrae rutas absolutas con y sin comillas, sin puntuación final');
    assert(extract(String.raw`relativa\x.pdf C:relativo \\srv\share\x.pdf http://x`).length === 0, 'ignora rutas relativas y de red');

    const { bridge, state } = makeBridge();
    await openFaux([fauxAssistantMessage('listo')], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const sent = await runtime.handlers.agent_message_send({ session_id: session.id, content: text, request_id: 'r-files' });
    assert(state.grants.length === 1 && state.grants[0].session_id === session.id && state.grants[0].request_id === 'r-files',
      'la concesión queda atribuida a la conversación y al envío del humano');
    assert(sent.files.granted.length === 2 && sent.files.rejected[0].path === 'D:\\datos', 'el envío informa archivos concedidos y rechazados');
    assert(await waitIdle(session.id), 'el turno termina');
    const plain = await runtime.handlers.agent_message_send({ session_id: session.id, content: 'sin rutas' });
    assert(state.grants.length === 1 && plain.files.granted.length === 0, 'un mensaje sin rutas no concede nada');
    assert(await waitIdle(session.id), 'el segundo turno termina');
    await runtime.handlers.agent_session_delete({ id: session.id });
    assert(state.revoked.includes(session.id), 'borrar la conversación revoca sus archivos');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const seen = [];
    const capture = (context) => {
      seen.push(JSON.stringify(context.messages));
      return fauxAssistantMessage('entendido');
    };
    await openFaux([capture], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const sent = await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Usa @sellador y @nada' });
    assert(JSON.stringify(sent.mentions) === JSON.stringify({ modules: ['sellador'], unknown: ['nada'], ambiguous: [] }),
      'el envío informa módulos resueltos y menciones desconocidas');
    assert(await waitIdle(session.id), 'el turno termina');
    assert(seen.length === 1 && seen[0].includes('[Contexto de Antares]') && seen[0].includes('sellador_apply'),
      'el modelo recibe el contexto de la mención');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(messages[0].role === 'user' && messages[0].content === 'Usa @sellador y @nada', 'el transcript muestra solo el texto del usuario');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    const executed = [];
    runtime._internal.shared.nativeTools = {
      nativeToolContext: async () => ({ tool_version: 'fake-v1', account: 'prueba@example.com' }),
      nativeToolSpecs: () => [
        { name: 'autoimg_status', description: 'AutoIMG estado', gated: false, kind: 'native', module: 'autoimg', inputSchema: { type: 'object', properties: {} } },
        { name: 'autoimg_sync_to_sheet', description: 'AutoIMG sync', gated: true, kind: 'native', module: 'autoimg', inputSchema: { type: 'object', properties: {} } },
      ],
      runNativeTool: async (name) => { executed.push(name); return { ok: name }; },
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('autoimg_status', {}), fauxToolCall('autoimg_sync_to_sheet', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('sincronizado'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const { tools } = await runtime.handlers.agent_tools_list({});
    assert(tools.some((t) => t.name === 'autoimg_status' && t.kind === 'native' && t.module === 'autoimg'), 'tools_list incluye herramientas nativas');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'sincroniza autoimg' });
    assert(await waitFor(async () =>
      (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals.length > 0), 'el efecto nativo pide aprobación');
    assert(JSON.stringify(executed) === JSON.stringify(['autoimg_status']), 'la lectura nativa se ejecuta sin aprobación');
    const ap = (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals[0];
    await runtime.handlers.agent_approve({ approval_id: ap.id });
    assert(await waitIdle(session.id), 'el turno termina tras aprobar el efecto nativo');
    assert(JSON.stringify(executed) === JSON.stringify(['autoimg_status', 'autoimg_sync_to_sheet']), 'cada herramienta nativa se ejecuta una vez');
    assert(state.dispatches.every((d) => d.status === 'succeeded'), 'Electron registra el comprobante en Python');
    runtime._internal.shared.nativeTools = null;
    await runtime.shutdown();
  }

  {
    const { bridge: inner, state } = makeBridge();
    let busyLeft = 2;
    let contextCalls = 0;
    const sentContexts = [];
    const bridge = async (method, params) => {
      if (method === 'agent_internal_dispatch' && params.native && params.gated) {
        sentContexts.push(params.context.n);
        if (busyLeft > 0) { busyLeft -= 1; return { result: null, busy: true }; }
      }
      return inner(method, params);
    };
    const executed = [];
    runtime._internal.shared.nativeTools = {
      nativeToolContext: async () => ({ tool_version: 'fake-v1', n: ++contextCalls }),
      nativeToolSpecs: () => [
        { name: 'autoimg_sync_to_sheet', description: 'AutoIMG sync', gated: true, kind: 'native', module: 'autoimg', inputSchema: { type: 'object', properties: {} } },
      ],
      runNativeTool: async (name, _params, { approvedContext }) => { executed.push(approvedContext.n); return { ok: name }; },
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('autoimg_sync_to_sheet', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('sincronizado'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'sincroniza' });
    assert(await waitFor(() => state.approvals.size > 0), 'el efecto pide aprobación');
    await runtime.handlers.agent_approve({ approval_id: [...state.approvals.keys()][0] });
    assert(await waitIdle(session.id), 'el turno termina tras liberarse el recurso');
    assert(sentContexts.length === 3 && new Set(sentContexts).size === 3, 'cada reintento envía un contexto recalculado');
    assert(JSON.stringify(executed) === JSON.stringify([sentContexts[2]]), 'se ejecuta una vez con el contexto revalidado');
    assert(state.dispatches.length === 1 && state.dispatches[0].status === 'succeeded', 'solo el intento admitido queda reservado');
    runtime._internal.shared.nativeTools = null;
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    const seen = [];
    await openFaux([(context) => { seen.push(JSON.stringify(context.messages)); return fauxAssistantMessage('ok'); }], bridge);
    const picks = [
      { canceled: false, filePaths: [String.raw`C:\datos\clientes.xlsx`, String.raw`C:\datos\informe.pdf`] },
      { canceled: false, filePaths: [String.raw`C:\fotos`] },
      { canceled: true, filePaths: [] },
    ];
    const titles = [];
    runtime._internal.shared.dialog = { showOpenDialog: async (_win, options) => { titles.push(options.properties); return picks.shift(); } };
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const files = await runtime.handlers.agent_attach({ kind: 'files' });
    const folder = await runtime.handlers.agent_attach({ kind: 'folder' });
    const none = await runtime.handlers.agent_attach({ kind: 'files' });
    assert(files.attachments.length === 2 && files.attachments.every((a) => a.id && !a.path && a.kind === 'files'),
      'el renderer recibe ids y nombres, no rutas');
    assert(folder.attachments[0].kind === 'folder' && none.attachments.length === 0, 'carpeta adjunta y diálogo cancelado');
    assert(titles[1].includes('openDirectory'), 'la carpeta se elige con un diálogo de carpeta');
    const ids = [...files.attachments, ...folder.attachments].map((a) => a.id);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'usa los adjuntos', attachments: ids });
    const grant = state.grants.at(-1);
    assert(JSON.stringify(grant.paths) === JSON.stringify([String.raw`C:\datos\clientes.xlsx`, String.raw`C:\datos\informe.pdf`])
      && JSON.stringify(grant.folders) === JSON.stringify([String.raw`C:\fotos`]), 'los adjuntos se conceden como archivos y carpeta');
    assert(await waitIdle(session.id), 'el turno termina');
    assert(seen[0].includes('Archivos adjuntos por el usuario') && seen[0].includes('(carpeta)'), 'el modelo conoce los adjuntos');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(messages[0].content === 'usa los adjuntos', 'el transcript no muestra el bloque de adjuntos');
    let reused = null;
    try { await runtime.handlers.agent_message_send({ session_id: session.id, content: 'otra vez', attachments: ids }); } catch (err) { reused = err; }
    assert(reused && /ya no está disponible/.test(reused.message), 'un adjunto se usa una sola vez');
    runtime._internal.shared.dialog = null;
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage([fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('vale, no lo hago'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'borra' });
    await waitFor(async () =>
      (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals.length > 0);
    const ap = (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals[0];
    await runtime.handlers.agent_deny({ approval_id: ap.id });
    assert(await waitIdle(session.id), 'turno termina tras rechazar');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const call = messages.find((m) => m.tool_calls).tool_calls[0];
    assert(call.status === 'denied', 'herramienta rechazada marcada denied');
    assert(state.dispatchLog.length === 0, 'ninguna ejecución tras deny');
    assert(messages.at(-1).content.includes('no lo hago'), 'el modelo continúa tras el rechazo');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    let seen = '';
    await openFaux([(context) => { seen = JSON.stringify(context.messages); return fauxAssistantMessage('uso la B'); }], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'genera con mi plantilla' });
    assert(await waitIdle(session.id), 'el turno con memoria termina');
    assert(seen.includes('usa la B'), 'el modelo recibe la memoria pertinente');
    const call = state.memoryCalls[0];
    assert(call.session_id === session.id && call.tools.length > 0 && call.tools.every((t) => t.name && /^[0-9a-f]{16}$/.test(t.version)),
      'Electron envía la versión de cada herramienta');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(!messages.some((m) => m.role === 'user' && String(m.content).includes('usa la B')), 'la memoria no aparece como texto del usuario');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    await openFaux([fauxAssistantMessage('hola')], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const renamed = await runtime.handlers.agent_session_rename({ id: session.id, title: '  Cierre de marzo  ' });
    assert(renamed.session.title === 'Cierre de marzo' && !('conversationId' in renamed.session), 'renombrar devuelve el contrato público');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'primer mensaje' });
    assert(await waitIdle(session.id), 'el turno tras renombrar termina');
    assert((await runtime.handlers.agent_sessions_list()).sessions[0].title === 'Cierre de marzo', 'el primer mensaje no pisa un nombre elegido');
    let error;
    try { await runtime.handlers.agent_session_rename({ id: session.id, title: '   ' }); } catch (err) { error = err; }
    assert(!!error, 'un nombre vacío se rechaza');
    await runtime.shutdown();
  }

  {
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-profiles-'));
    const dbPath = path.join(dir, 'agent.sqlite');
    const { bridge } = makeBridge();
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const { profile } = await runtime.handlers.agent_profile_save({
      name: 'Informe mensual', description: 'Cortes del mes', instructions: 'Usa la plantilla de cortes y pide el mes.',
      starter: 'Prepara el informe de este mes', tools: ['canvas_list'],
    });
    assert(profile.id && profile.tools.join() === 'canvas_list', 'el agente guarda instrucciones y herramientas');
    for (const bad of [{ name: '', instructions: 'x' }, { name: 'X', instructions: '' }, { name: 'X', instructions: 'token: abcdef123456' },
      { name: 'X', instructions: 'y', tools: ['desconocida'] }, { id: 'nope', name: 'X', instructions: 'y' }]) {
      let error;
      try { await runtime.handlers.agent_profile_save(bad); } catch (err) { error = err; }
      assert(!!error, 'un agente inválido, con secretos o herramientas inexistentes se rechaza');
    }
    await runtime.shutdown();
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const { profiles } = await runtime.handlers.agent_profiles_list();
    assert(profiles.length === 1 && profiles[0].name === 'Informe mensual', 'los agentes sobreviven al reinicio');
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: profile.id });
    assert(session.title === 'Informe mensual' && session.profile.id === profile.id, 'la conversación nace del agente');
    const enabled = (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools.filter((t) => t.enabled).map((t) => t.name);
    assert(enabled.join() === 'canvas_list', 'la conversación aplica las herramientas del agente');
    const conv = await runtime._internal.state().harness.conversation(
      (await require('../electron/agent-shared').requireSession(session.id)).conversationId, runtime._internal.state().ctx);
    const instructions = (await conv.agent(runtime._internal.state().ctx)).instructions;
    assert(String(instructions).includes('plantilla de cortes') && String(instructions).includes('requiriendo aprobación'),
      'las indicaciones del agente se suman sin retirar las reglas de aprobación');
    const plain = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    assert((await runtime.handlers.agent_tools_list({ session_id: plain.session.id })).tools.every((t) => t.enabled), 'una conversación normal no hereda el agente');
    await runtime.handlers.agent_profile_delete({ id: profile.id });
    assert((await runtime.handlers.agent_profiles_list()).profiles.length === 0, 'el agente se borra');
    assert((await runtime.handlers.agent_sessions_list()).sessions.some((s) => s.id === session.id), 'sus conversaciones se conservan');
    let missing;
    try { await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: profile.id }); } catch (err) { missing = err; }
    assert(!!missing, 'no se crea una conversación con un agente borrado');
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const { bridge } = makeBridge();
    const delegated = [];
    const spyBridge = async (method, params) => {
      if (method === 'agent_internal_dispatch') delegated.push(params);
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('subagent_run', { agent: 'Investigador', task: '¿Qué documentos hay?' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('listo'),
    ], spyBridge);
    const { profile } = await runtime.handlers.agent_profile_save({
      name: 'Investigador', description: 'Busca en la app', instructions: 'Consulta Canvas y resume.',
      starter: '', tools: ['canvas_list'],
    });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const listed = (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools;
    const spec = listed.find((tool) => tool.name === 'subagent_run');
    assert(spec && spec.kind === 'backend' && !spec.gated, 'la delegación aparece como herramienta de lectura');
    assert((await runtime.handlers.agent_tools_list({})).tools.some((tool) => tool.name === 'subagent_run'),
      'la lista global incluye los agentes guardados');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'delega' });
    assert(await waitIdle(session.id), 'el turno con delegación termina');
    const sent = delegated.find((request) => request.name === 'subagent_run');
    assert(sent && sent.context.subagent && sent.context.subagent.name === 'Investigador',
      'el perfil resuelto viaja por el canal interno');
    assert(sent.context.subagent.instructions.includes('Consulta Canvas'), 'las indicaciones del agente llegan al subagente');
    assert(sent.context.subagent.tools.join() === 'canvas_list', 'solo las herramientas del agente');
    assert(sent.context.subagent.enabled.includes('canvas_list'), 'la conversación limita las herramientas del subagente');
    await runtime.handlers.agent_profile_delete({ id: profile.id });
    assert(!(await runtime.handlers.agent_tools_list({})).tools.some((tool) => tool.name === 'subagent_run'),
      'sin agentes guardados no se ofrece delegar');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    await openFaux([fauxAssistantMessage('listo')], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Usa @sellador con C:\\docs\\a.pdf' });
    assert(await waitIdle(session.id), 'el turno con contexto termina');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(JSON.stringify(listed.context.modules) === JSON.stringify([{ id: 'sellador', label: 'Sellador' }]), 'el módulo mencionado queda en el contexto de la conversación');
    assert(listed.context.files[0].path === 'C:\\docs\\a.pdf' && listed.context.accounts[0] === 'ana@example.com', 'archivos y cuentas usados aparecen en el contexto');
    assert(listed.usage === null || (listed.usage.input + listed.usage.output > 0), 'el uso solo se informa con datos del proveedor');
    assert(!('modules' in (await runtime.handlers.agent_sessions_list()).sessions[0]), 'la lista de conversaciones conserva su contrato');
    await runtime.handlers.agent_context_remove_file({ session_id: session.id, path: 'C:\\docs\\a.pdf' });
    assert(state.removed[0].session_id === session.id && state.removed[0].path === 'C:\\docs\\a.pdf', 'retirar un archivo revoca solo ese acceso');
    let error;
    try { await runtime.handlers.agent_context_remove_file({ session_id: session.id, path: '' }); } catch (err) { error = err; }
    assert(!!error, 'retirar exige un archivo concreto');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    let sawCorrection = false;
    await openFaux([
      fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      (context) => {
        sawCorrection = JSON.stringify(context.messages).includes('usa solo lectura');
        return fauxAssistantMessage('corregido');
      },
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'limpia' });
    assert(await waitFor(() => state.approvals.size > 0), 'el paso con efecto espera aprobación');
    let blocked;
    try { await runtime.handlers.agent_message_send({ session_id: session.id, content: 'otra cosa' }); } catch (err) { blocked = err; }
    assert(!!blocked, 'un mensaje normal sigue exigiendo resolver la aprobación');
    const executedBefore = [...state.dispatchLog];
    const corrected = await runtime.handlers.agent_message_send({
      session_id: session.id, content: 'no borres nada, usa solo lectura', request_id: 'fix-1', correction: true,
    });
    assert(corrected.accepted === true, 'la corrección se admite con el turno en curso');
    assert(await waitIdle(session.id), 'el turno termina tras la corrección');
    assert([...state.approvals.values()][0].status === 'denied', 'la aprobación pendiente queda rechazada');
    assert(JSON.stringify(state.dispatchLog) === JSON.stringify(executedBefore) && executedBefore.length === 1,
      'el efecto pendiente no se ejecuta y el ya ejecutado no se repite');
    assert(state.dispatches[0].result === JSON.stringify({ ok: true, tool: 'canvas_list' }), 'el comprobante ejecutado conserva su resultado');
    assert(sawCorrection, 'el modelo recibe la corrección en los pasos siguientes');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(messages.at(-1).content === 'corregido', 'el encargo continúa con la corrección');
    const again = await runtime.handlers.agent_message_send({
      session_id: session.id, content: 'no borres nada, usa solo lectura', request_id: 'fix-1', correction: true,
    });
    assert(again.duplicate === true, 'reenviar la misma corrección no la duplica');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const lateFactory = (_ctx, options) => new Promise((resolve) => {
      const sig = options && options.signal;
      if (sig) sig.addEventListener('abort', () => setTimeout(() => resolve(fauxAssistantMessage('RESPUESTA TARDÍA')), 300), { once: true });
      else setTimeout(() => resolve(fauxAssistantMessage('RESPUESTA TARDÍA')), 30000);
    });
    const faux = await openFaux([lateFactory], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'uno' });
    assert(await waitFor(async () => (await runtime.handlers.agent_turn_status({ session_id: session.id })).running), 'el turno arranca');
    const cancelled = await runtime.handlers.agent_turn_cancel({ session_id: session.id });
    assert(cancelled.cancelled === true, 'turno activo cancelado');
    await sleep(700);
    faux.setResponses([fauxAssistantMessage('segunda respuesta')]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'dos' });
    assert(await waitIdle(session.id), 'el turno siguiente termina');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(!messages.some((m) => String(m.content).includes('TARDÍA')), 'la respuesta tardía no se publica');
    assert(messages.at(-1).content === 'segunda respuesta', 'el siguiente turno recibe su propia respuesta');
    await runtime.shutdown();
  }

  {
    const { MemoryStorage } = await import('@earendil-works/pi-durable');
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-legacy-'));
    fs.mkdirSync(path.join(legacyDir, 'messages'));
    const sessions = {
      'legacy-1': { id: 'legacy-1', title: 'Importada', provider: 'openai', model: 'gpt-mock', created_at: 1, updated_at: 2, last_error: null },
    };
    const approvals = {
      'ap-legacy': { id: 'ap-legacy', session_id: 'legacy-1', call_id: 'call-1', method: 'db_clear', params: {}, status: 'pending', created_at: 3, decided_at: null },
    };
    const msgs = [
      { role: 'user', content: 'hola', ts: 10 },
      { role: 'assistant', content: 'voy', tool_calls: [{ id: 'call-1', name: 'db_clear', params: {}, gated: true, status: 'pending' }], ts: 11 },
    ];
    fs.writeFileSync(path.join(legacyDir, 'sessions.json'), JSON.stringify(sessions));
    fs.writeFileSync(path.join(legacyDir, 'approvals.json'), JSON.stringify(approvals));
    fs.writeFileSync(path.join(legacyDir, 'messages', 'legacy-1.json'), JSON.stringify(msgs));
    const snapshotBefore = {
      s: fs.readFileSync(path.join(legacyDir, 'sessions.json'), 'utf8'),
      a: fs.readFileSync(path.join(legacyDir, 'approvals.json'), 'utf8'),
      m: fs.readFileSync(path.join(legacyDir, 'messages', 'legacy-1.json'), 'utf8'),
    };

    const { bridge, state } = makeBridge();
    state.approvals.set('ap-legacy', { ...approvals['ap-legacy'] });
    state.seq = 1;

    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-'));
    const dbPath = path.join(runtimeDir, 'agent.sqlite');
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, dir: legacyDir, skipImport: false });
    let { sessions: listed } = await runtime.handlers.agent_sessions_list({});
    assert(listed.length === 1 && listed[0].id === 'legacy-1' && listed[0].title === 'Importada', 'sesión importada conserva id y título');
    let { messages, pending_approvals } = await runtime.handlers.agent_messages_list({ session_id: 'legacy-1' });
    assert(messages.length === 2 && messages[0].content === 'hola' && messages[1].tool_calls[0].id === 'call-1', 'mensajes importados en orden');
    assert(pending_approvals.length === 1 && pending_approvals[0].id === 'ap-legacy', 'aprobación pendiente recuperada');

    await importer.importLegacySessions(runtime._internal.state(), legacyDir);
    const { sessions: listed2 } = await runtime.handlers.agent_sessions_list({});
    assert(listed2.length === 1, 'la reimportación no duplica sesiones');
    assert(JSON.stringify(snapshotBefore.s) === JSON.stringify(fs.readFileSync(path.join(legacyDir, 'sessions.json'), 'utf8')), 'sessions.json intacto');
    assert(fs.readFileSync(path.join(legacyDir, 'approvals.json'), 'utf8') === snapshotBefore.a, 'approvals.json intacto');
    assert(fs.readFileSync(path.join(legacyDir, 'messages', 'legacy-1.json'), 'utf8') === snapshotBefore.m, 'messages intactos');

    await runtime.shutdown();
    await runtime.open({ dbPath, bridge, dir: legacyDir, skipImport: true });
    const { pending_approvals: pendingAfter } = await runtime.handlers.agent_messages_list({ session_id: 'legacy-1' });
    assert(pendingAfter.length === 1, 'la aprobación sigue pendiente tras reabrir');
    assert(state.dispatchLog.length === 0, 'nada se ejecutó solo al reabrir');
    await runtime.handlers.agent_approve({ approval_id: 'ap-legacy' });
    await sleep(600);
    const { messages: afterApprove } = await runtime.handlers.agent_messages_list({ session_id: 'legacy-1' });
    const result = afterApprove.find((m) => m.role === 'tool_result' && m.tool_use_id === 'call-1');
    assert(result && result.content.includes('"ok":true'), 'aprobación recuperada ejecuta el efecto una vez');
    assert(state.dispatchLog.filter((id) => id === 'call-1').length === 1, 'dispatch de la aprobación recuperada deduplicado');
    await runtime.shutdown();
  }

  {
    const hits = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        hits.push({ url: req.url, auth: req.headers.authorization, body });
        if (req.url === '/v1/chat/completions') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const chunk = (choices) => `data: ${JSON.stringify({ choices })}\n\n`;
          res.write(chunk([{ delta: { role: 'assistant' } }]));
          res.write(chunk([{ delta: { content: 'hola ' } }]));
          res.write(chunk([{ delta: { content: 'desde el wire' } }]));
          res.write(chunk([{ delta: {}, finish_reason: 'stop' }]));
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.writeHead(404); res.end();
        }
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const { bridge } = makeBridge();
    const wiredBridge = async (method, params) => {
      if (method === 'agent_internal_provider') {
        return { provider: 'openai', style: 'openai_chat', base_url: `http://127.0.0.1:${port}/v1`, api_key: 'sk-wire', auth_type: 'api_key', extra_headers: {}, default_model: 'gpt-mock' };
      }
      return bridge(method, params);
    };
    const { MemoryStorage } = await import('@earendil-works/pi-durable');
    await runtime.open({ storage: new MemoryStorage(), bridge: wiredBridge, skipImport: true });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'openai', model: 'gpt-mock' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'saluda' });
    assert(await waitIdle(session.id), 'turno sobre servidor simulado termina');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(messages.at(-1).content === 'hola desde el wire', 'streaming SSE proyectado al transcript');
    assert(hits.length >= 1 && hits.every((h) => h.url === '/v1/chat/completions'), 'endpoint Chat Completions (no Responses)');
    assert(hits[0].auth === 'Bearer sk-wire', 'Authorization Bearer hacia el proveedor');
    assert(JSON.parse(hits[0].body).stream === true, 'streaming habilitado en el wire');
    server.close();
    await runtime.shutdown();
  }

  {
    const secret = 'demo-provider-secret-987654';
    const headerSecret = 'demo-header-secret-123456';
    const replacementSecret = 'demo-provider-next-567890';
    const replacementHeader = 'Bearer demo-header-next-567890';
    const server = http.createServer((req, res) => {
      const record = runtime._internal.shared.providers.get('openai');
      record.info = { ...record.info, api_key: replacementSecret, extra_headers: { 'x-test-credential': replacementHeader } };
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Credenciales rechazadas: ${secret}, ${headerSecret}`, type: 'invalid_request_error' } }));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const { bridge } = makeBridge();
    const protectedBridge = async (method, params) => method === 'agent_internal_provider'
      ? { provider: 'openai', style: 'openai_chat', base_url: `http://127.0.0.1:${server.address().port}/v1`,
        api_key: secret, auth_type: 'api_key', extra_headers: { 'x-test-credential': `Bearer ${headerSecret}` }, default_model: 'gpt-error' }
      : bridge(method, params);
    const { MemoryStorage } = await import('@earendil-works/pi-durable');
    await runtime.open({ storage: new MemoryStorage(), bridge: protectedBridge, skipImport: true });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'openai', model: 'gpt-error' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'consulta' });
    assert(await waitFor(async () => (await runtime.handlers.agent_turn_status({ session_id: session.id })).last_error),
      'el fallo del proveedor llega al estado de la conversación');
    const status = await runtime.handlers.agent_turn_status({ session_id: session.id });
    assert(!status.last_error.includes(secret) && status.last_error.includes('<REDACTED>'), 'el error no expone la credencial del proveedor');
    assert(!status.last_error.includes(headerSecret), 'el error no expone el token de una cabecera Bearer');
    server.close();
    await runtime.shutdown();
  }

  finish();
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
