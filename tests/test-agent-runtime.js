'use strict';

// Tests del runtime nativo del agente (Electron main): pi-durable + pi-ai,
// con el puente privado a Python sustituido por un fake en memoria. Cubre el
// contrato público, aprobaciones (aprobar/rechazar/recuperar), cancelación,
// dispatch deduplicado, importación JSON→SQLite y el wire OpenAI contra un
// servidor HTTP simulado.

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
  'agent_messages_list', 'agent_message_send', 'agent_tools_list',
  'agent_turn_status', 'agent_turn_cancel', 'agent_approve', 'agent_deny', 'agent_attach',
];
const INTERNAL_RPCS = [
  'agent_internal_tools', 'agent_internal_provider',
  'agent_internal_approval_ensure', 'agent_internal_approval_status',
  'agent_internal_approval_decide', 'agent_internal_approvals_pending',
  'agent_internal_approvals_deny_session', 'agent_internal_dispatch',
  'agent_internal_dispatch_result', 'agent_internal_dispatch_cancel',
  'agent_internal_grants_add', 'agent_internal_grants_revoke', 'agent_internal_mentions',
  'agent_internal_dispatch_finish',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeBridge() {
  const state = { approvals: new Map(), seq: 0, dispatches: [], dispatchLog: [], grants: [], revoked: [] };
  const bridge = async (method, params) => {
    switch (method) {
      case 'agent_internal_tools':
        return {
          tools: [
            { name: 'flows_list', description: 'Lista flujos', gated: false, kind: 'backend', inputSchema: { type: 'object', properties: {} } },
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
          ? { modules, unknown, ambiguous: [], context: 'El usuario mencionó estos módulos de Antares:\n- Sellador: herramientas sellador_apply' }
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
  const { fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');

  // --- contrato estático del catálogo ---
  for (const name of PUBLIC_METHODS) {
    assert(nativeDispatchFor(name) === 'agent', `${name} → native:agent`);
  }
  for (const name of INTERNAL_RPCS) {
    assert(INTERNAL_SET.has(name), `${name} es internal:true`);
    assert(METHODS[name].handler === 'backend:agent_internal', `${name} → backend:agent_internal`);
  }

  // --- flujo completo: herramienta segura + gated + aprobación + dedup ---
  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage([fauxToolCall('flows_list', {}), fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
    ], bridge);

    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', title: 'T' });
    assert(session.id && !session.style && !session.conversationId, 'session_create devuelve solo el contrato público');
    const { sessions } = await runtime.handlers.agent_sessions_list({});
    assert(sessions.length === 1 && sessions[0].id === session.id, 'sessions_list incluye la sesión');

    const { tools } = await runtime.handlers.agent_tools_list({});
    assert(tools.some((t) => t.name === 'flows_list' && !t.gated) && tools.some((t) => t.name === 'db_clear' && t.gated), 'tools_list proyecta gated');

    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'hazlo' });
    const sawPending = await waitFor(async () =>
      (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals.length > 0);
    assert(sawPending, 'la herramienta gated queda pendiente de aprobación');

    const ap = (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals[0];
    await runtime.handlers.agent_approve({ approval_id: ap.id });
    assert(await waitIdle(session.id), 'el turno termina tras aprobar');

    const { messages, pending_approvals } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(pending_approvals.length === 0, 'no quedan aprobaciones pendientes');
    const assistant = messages.find((m) => m.tool_calls);
    const calls = assistant.tool_calls;
    assert(calls.find((c) => c.name === 'flows_list').status === 'done', 'herramienta segura ejecutada');
    assert(calls.find((c) => c.name === 'db_clear').status === 'done', 'herramienta aprobada ejecutada');
    assert(messages.at(-1).content === 'hecho', 'respuesta final del modelo');
    assert(state.dispatchLog.filter((id) => id === calls[1].id).length === 1, 'dispatch deduplicado: una ejecución por call_id');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(listed.messages.filter((m) => m.role === 'tool_result' && m.tool_use_id === calls[1].id).length === 1, 'sin tool_result duplicado tras aprobación');

    const idle = await runtime.handlers.agent_turn_cancel({ session_id: session.id });
    assert(idle.cancelled === false, 'turn_cancel sobre idle informa cancelled:false');
    await runtime.shutdown();
  }

  // --- reenvío con el mismo request_id: un único encargo admitido ---
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

  // --- rutas escritas por el humano: concesión antes de admitir el mensaje ---
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

  // --- @menciones: el modelo recibe el contexto y el transcript no lo muestra ---
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

  // --- herramientas nativas: reserva en Python, ejecución única en Electron ---
  {
    const { bridge, state } = makeBridge();
    const executed = [];
    runtime._internal.shared.nativeTools = {
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

  // --- adjuntos: diálogo del proceso principal, ids opacos y concesión al enviar ---
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

  // --- deny: la herramienta no se ejecuta y el modelo lo ve ---
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

  // --- cancelación de un turno activo y respuesta tardía descartada ---
  {
    const { bridge } = makeBridge();
    // El proveedor resuelve 300 ms DESPUÉS de la señal de abort: la respuesta
    // llega tarde a un turno ya cancelado y no debe publicarse.
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
    await sleep(700); // la respuesta tardía aterriza tras cancelar
    // La cola de respuestas se resetea: un reintento interno del turno abortado
    // no debe robar la respuesta del siguiente turno.
    faux.setResponses([fauxAssistantMessage('segunda respuesta')]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'dos' });
    assert(await waitIdle(session.id), 'el turno siguiente termina');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(!messages.some((m) => String(m.content).includes('TARDÍA')), 'la respuesta tardía no se publica');
    assert(messages.at(-1).content === 'segunda respuesta', 'el siguiente turno recibe su propia respuesta');
    await runtime.shutdown();
  }

  // --- importación JSON → durable + recuperación de aprobación pendiente ---
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
    // La aprobación pendiente del JSON vive en Python: la sembramos en el fake.
    state.approvals.set('ap-legacy', { ...approvals['ap-legacy'] });
    state.seq = 1;

    // SQLite real: hace falta para reabrir tras "reinicio" (harness.close()
    // cierra el storage; un MemoryStorage nuevo no conserva nada).
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-'));
    const dbPath = path.join(runtimeDir, 'agent.sqlite');
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, dir: legacyDir, skipImport: false });
    let { sessions: listed } = await runtime.handlers.agent_sessions_list({});
    assert(listed.length === 1 && listed[0].id === 'legacy-1' && listed[0].title === 'Importada', 'sesión importada conserva id y título');
    let { messages, pending_approvals } = await runtime.handlers.agent_messages_list({ session_id: 'legacy-1' });
    assert(messages.length === 2 && messages[0].content === 'hola' && messages[1].tool_calls[0].id === 'call-1', 'mensajes importados en orden');
    assert(pending_approvals.length === 1 && pending_approvals[0].id === 'ap-legacy', 'aprobación pendiente recuperada');

    // Idempotencia: reimportar no duplica.
    await importer.importLegacySessions(runtime._internal.state(), legacyDir);
    const { sessions: listed2 } = await runtime.handlers.agent_sessions_list({});
    assert(listed2.length === 1, 'la reimportación no duplica sesiones');
    assert(JSON.stringify(snapshotBefore.s) === JSON.stringify(fs.readFileSync(path.join(legacyDir, 'sessions.json'), 'utf8')), 'sessions.json intacto');
    assert(fs.readFileSync(path.join(legacyDir, 'approvals.json'), 'utf8') === snapshotBefore.a, 'approvals.json intacto');
    assert(fs.readFileSync(path.join(legacyDir, 'messages', 'legacy-1.json'), 'utf8') === snapshotBefore.m, 'messages intactos');

    // "Reinicio": cerramos y reabrimos sobre el mismo SQLite; la aprobación
    // pendiente no se ejecuta sola, y decidirla ejecuta una única vez.
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

  // --- wire real: OpenAI Chat Completions + streaming contra servidor simulado ---
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

  finish();
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
