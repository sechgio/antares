'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { assert, finish } = require('./helpers/harness');
const { getEventListeners } = require('node:events');

const runtime = require('../electron/agent-runtime');
const importer = require('../electron/agent-import');
const { METHODS, INTERNAL_METHODS: INTERNAL_SET, nativeDispatchFor } = require('../shared/ipc-method-catalog');

const PUBLIC_METHODS = [
  'agent_sessions_list', 'agent_session_create', 'agent_session_delete',
  'agent_messages_list', 'agent_message_send', 'agent_tools_list', 'agent_tools_set',
  'agent_turn_status', 'agent_turn_cancel', 'agent_approve', 'agent_deny', 'agent_attach', 'agent_context_remove_file',
  'agent_profiles_list', 'agent_profile_save', 'agent_profile_delete', 'agent_session_rename', 'agent_session_model_set',
  'agent_browser',
  'agent_session_permissions_set', 'agent_session_rules_set', 'agent_policy_get', 'agent_policy_rules_set',
  'agent_effect_undo', 'agent_session_reasoning_set',
];
const INTERNAL_RPCS = [
  'agent_internal_tools', 'agent_internal_provider', 'agent_internal_profile_usage',
  'agent_internal_approval_ensure', 'agent_internal_approval_status',
  'agent_internal_approval_decide', 'agent_internal_approvals_pending',
  'agent_internal_approvals_deny_session', 'agent_internal_dispatch',
  'agent_internal_dispatch_result', 'agent_internal_dispatch_cancel',
  'agent_internal_grants_add', 'agent_internal_grants_revoke', 'agent_internal_mentions',
  'agent_internal_dispatch_finish',
  'agent_internal_activity', 'agent_internal_memory_context', 'agent_internal_grant_remove',
  'agent_internal_effects', 'agent_internal_effect_undo', 'agent_internal_skill_resolve',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeBridge() {
  const state = { approvals: new Map(), seq: 0, dispatches: [], dispatchLog: [], grants: [], revoked: [], attention: {} };
  const bridge = async (method, params) => {
    switch (method) {
      case 'agent_internal_activity': return { attention: state.attention };
      case 'agent_internal_profile_usage': return { tokens: 0 };
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
            method: params.method, params: params.params, status: 'pending', channel: params.channel || null,
            created_at: Date.now(), decided_at: null, source: null,
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
        a.source = params.source || 'manual';
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
          const record = { session_id: params.session_id, call_id: params.call_id, op_id: `op-${params.call_id}`, status: 'running', result: null, channel: params.channel || null };
          state.dispatches.push(record);
          return { result: null, dispatch: record, execute: 'native' };
        }
        const existing = state.dispatches.find((d) => d.session_id === params.session_id && d.call_id === params.call_id);
        if (existing) return { result: existing.result, dispatch: existing };
        const approval = params.approval_id ? state.approvals.get(params.approval_id) : null;
        const record = {
          session_id: params.session_id, call_id: params.call_id, method: params.name,
          channel: params.channel || (approval && approval.channel) || null,
          approval_source: (approval && approval.source) || 'none',
          status: 'succeeded', result: JSON.stringify({ ok: true, tool: params.name }),
        };
        state.dispatches.push(record);
        return { result: record.result, dispatch: record };
      }
      case 'agent_internal_effects':
        return { dispatches: state.dispatches.filter((d) => d.session_id === params.session_id)
          .map(({ result, ...rest }) => rest) };
      case 'agent_internal_effect_undo': {
        state.undoCalls = [...(state.undoCalls || []), params];
        return { undone: true, call_id: params.call_id, path: 'C:\\tmp\\archivo.txt' };
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

async function openFaux(responses, bridge, { faux: fauxOptions = {}, settings } = {}) {
  const { MemoryStorage } = await import('@earendil-works/pi-durable');
  const { fauxProvider } = await import('@earendil-works/pi-ai');
  await runtime.open({ storage: new MemoryStorage(), bridge, skipImport: true, settings });
  const faux = fauxProvider(fauxOptions);
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
    const { modelDefinition } = require('../electron/agent-execution');
    const define = (info, id) => modelDefinition({ provider: 'p', style: 'openai_chat', ...info }, id, 'openai-completions');
    const local = define({ custom: true, base_url: 'http://127.0.0.1:11434/v1', capabilities: { vision: false, context_window: 8192 } }, 'gpt-4o');
    assert(local.input.join() === 'text' && local.contextWindow === 8192 && local.maxTokens === 2048,
      'las capacidades declaradas del modelo personalizado mandan sobre el nombre');
    assert(local.compat && local.compat.maxTokensField === 'max_tokens' && local.compat.supportsDeveloperRole === false
      && local.compat.supportsStore === false, 'un endpoint compatible usa el contrato clásico de Chat Completions');
    assert(!define({ custom: true, base_url: 'https://api.openai.com/v1' }, 'gpt-5').compat, 'la API oficial conserva la detección de pi-ai');
    assert(JSON.stringify(define({ custom: false, base_url: 'http://localhost:11434/v1' }, 'llama3').compat)
      === '{"supportsLongCacheRetention":false}', 'un endpoint no oficial solo pierde la retención larga de caché');
    const claude = (base) => modelDefinition({ provider: 'a', style: 'anthropic_messages', base_url: base }, 'claude-opus-5-5',
      'anthropic-messages').compat;
    assert(!claude('https://api.anthropic.com') && claude('https://proxy.example.com').supportsLongCacheRetention === false,
      'la retención larga de caché solo viaja a la API oficial de Anthropic');
    const { ANTHROPIC_MODELS } = await import('@earendil-works/pi-ai/providers/anthropic.models');
    const verified = (base, id) => modelDefinition({ provider: 'a', style: 'anthropic_messages', base_url: base }, id,
      'anthropic-messages', ANTHROPIC_MODELS[id]).compat || {};
    assert(verified('https://api.anthropic.com', 'claude-opus-5-5').supportsMidConvoToolChanges === true
      && !verified('https://api.anthropic.com', 'claude-sonnet-4-5').supportsMidConvoToolChanges
      && !verified('https://proxy.example.com', 'claude-opus-5-5').supportsMidConvoToolChanges,
      'solo un Claude verificado en la API oficial recibe las herramientas nuevas sin cambiar la lista enviada');
    const { leadingSystem } = require('../electron/agent-execution');
    const user = { role: 'user', content: 'hola' };
    const system = { role: 'system', content: '', sections: { instructions: 'sys' } };
    const later = { role: 'system', content: '', toolsAdded: [{ name: 'beta' }] };
    const hoisted = leadingSystem([user, system, { role: 'assistant', content: [] }, later]).messages;
    assert(hoisted[0] === system && hoisted[1] === user && hoisted[3] === later,
      'el prompt base encabeza la petición y los cambios posteriores quedan en su sitio');
    assert(leadingSystem([system, user]) === undefined && leadingSystem([user]) === undefined,
      'una petición que ya empieza por el prompt no se toca');
    assert(define({ custom: true, base_url: 'https://openrouter.ai/api/v1' }, 'anthropic/claude-opus-5-5').compat
      .cacheControlFormat === 'anthropic', 'Claude vía OpenRouter lleva cache_control aunque el proveedor sea propio');
    assert(define({ custom: true, base_url: 'http://x.local/v1', capabilities: { vision: true } }, 'mi-modelo').input.includes('image'),
      'un modelo personalizado puede declarar visión aunque su nombre no la sugiera');
    const { OPENAI_MODELS } = await import('@earendil-works/pi-ai/providers/openai.models');
    const openai = { provider: 'openai', style: 'openai_chat', base_url: 'https://api.openai.com/v1' };
    const anthropicCatalog = { provider: 'anthropic', style: 'anthropic_messages', base_url: 'https://api.anthropic.com' };
    const priced = modelDefinition(openai, 'gpt-4o', 'openai-completions', undefined, OPENAI_MODELS['gpt-4o']);
    assert(priced.cost.input === 2.5 && priced.cost.output === 10 && priced.cost.cacheRead === 1.25,
      'un modelo del catálogo lleva sus precios reales por millón de tokens');
    assert(priced.contextWindow === 128000
      && modelDefinition(openai, 'gpt-4.1', 'openai-completions', undefined, OPENAI_MODELS['gpt-4.1']).contextWindow === 1047576,
      'la ventana del catálogo sustituye al valor por defecto');
    assert(modelDefinition(anthropicCatalog, 'claude-sonnet-5-5', 'anthropic-messages', ANTHROPIC_MODELS['claude-sonnet-5-5'],
      ANTHROPIC_MODELS['claude-sonnet-5-5']).maxTokens === 128000
      && modelDefinition(openai, 'gpt-5.5', 'openai-completions', undefined, OPENAI_MODELS['gpt-5.5']).maxTokens === 68000,
      'el techo de salida del catálogo deja sitio al razonamiento y a la respuesta');
    const declared = modelDefinition({ ...openai, capabilities: { context_window: 32000 } }, 'gpt-4o',
      'openai-completions', undefined, OPENAI_MODELS['gpt-4o']);
    assert(declared.contextWindow === 32000 && declared.maxTokens === 8000,
      'la ventana declarada por el usuario manda sobre el catálogo');
    assert(!define({ custom: true, base_url: 'http://127.0.0.1:11434/v1' }, 'gpt-4o').cost.input,
      'un endpoint propio no hereda los precios del catálogo');
    const { catalogFor } = require('../electron/agent-execution');
    assert(catalogFor({ provider: 'custom-claude', style: 'anthropic_messages', base_url: 'https://api.anthropic.com' }) === 'anthropic'
      && catalogFor({ provider: 'custom-gpt', style: 'openai_chat', base_url: 'https://api.openai.com/v1' }) === 'openai'
      && catalogFor({ provider: 'custom-or', style: 'openai_chat', base_url: 'https://openrouter.ai/api/v1' }) === 'openrouter'
      && catalogFor({ provider: 'anthropic', style: 'anthropic_messages', base_url: 'https://proxy.example.com' }) === 'anthropic',
      'un modelo personalizado en una API oficial usa el mismo catálogo que el proveedor integrado');
    assert(catalogFor({ provider: 'custom-local', style: 'openai_chat', base_url: 'http://127.0.0.1:11434/v1' }) === null
      && catalogFor({ provider: 'custom-x', style: 'openai_chat', base_url: 'https://api.anthropic.com' }) === null,
      'un endpoint propio o con otro formato de API no hereda el catálogo');
    const { rankTools } = require('../electron/agent-execution');
    const searchable = [
      { name: 'task_schedule', module: 'agenda', description: 'Programa encargos futuros para el usuario' },
      { name: 'ui_type', module: 'computer', description: 'Escribe texto en una ventana; requiere aprobación del usuario' },
      { name: 'desktop_key', module: 'computer', description: 'Pulsa una tecla para el usuario' },
      { name: 'artifact_print', module: 'printing', description: 'Envía un artefacto a la impresora' },
      { name: 'printers_list', module: 'printing', description: 'Lista impresoras (solo lectura)' },
      { name: 'document_generate', module: 'documents', description: 'Genera un documento desde una plantilla' },
      { name: 'canvas_apply_layers', module: 'canvas', description: 'Aplica capas al lienzo' },
    ];
    const ranked = (query) => rankTools(searchable, { query }).map((spec) => spec.name);
    assert(JSON.stringify(ranked('programar un recordatorio para mañana')) === '["task_schedule"]',
      'los alias del módulo encuentran la herramienta y las palabras vacías no cargan herramientas ajenas');
    assert(JSON.stringify(ranked('imprimir el documento').sort()) === '["artifact_print","document_generate","printers_list"]',
      'cada módulo nombrado por su alias entra y las coincidencias sueltas quedan fuera');
    assert(JSON.stringify(ranked('canvas_apply_layers')) === '["canvas_apply_layers"]' && ranked('para el usuario').length === 0,
      'el nombre exacto selecciona una sola herramienta y una consulta sin términos útiles no carga nada');
    assert(rankTools(searchable, { modules: ['printing'] }).length === 2, 'pedir un módulo sigue cargando todas sus herramientas');
  }
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
    const { bridge, state } = makeBridge();
    const shellBridge = async (method, params) => {
      const result = await bridge(method, params);
      if (method === 'agent_internal_tools') result.tools.push({
        name: 'shell_run', kind: 'backend', module: 'computer', gated: true, inputSchema: { type: 'object', properties: {} },
      });
      return result;
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('shell_run', { command: 'Write-Output prueba' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('shell_run', { command: 'Write-Output prueba' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Comando aprobado'),
    ], shellBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Ejecuta el comando' });
    assert(await waitFor(() => state.approvals.size === 1), 'el shell pide aprobación también en Acceso completo');
    assert(state.dispatches.length === 0, 'no ejecuta PowerShell antes de la aprobación humana');
    const approval = [...state.approvals.values()][0];
    await runtime.handlers.agent_approve({ approval_id: approval.id });
    assert(await waitFor(() => state.approvals.size === 2), 'repetir el comando requiere otra aprobación humana');
    assert(state.dispatches.length === 1, 'la primera aprobación no autoriza el siguiente comando');
    await runtime.handlers.agent_approve({ approval_id: [...state.approvals.values()][1].id });
    assert(await waitIdle(session.id), 'el shell continúa después de la aprobación humana');
    assert(state.dispatches.length === 2, 'cada aprobación ejecuta un único comando');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    const uiBridge = async (method, params) => {
      const result = await bridge(method, params);
      if (method === 'agent_internal_tools') {
        result.tools.push(
          { name: 'ui_click', kind: 'backend', module: 'computer', gated: true, inputSchema: { type: 'object', properties: {} } },
          { name: 'ui_observe', kind: 'backend', module: 'computer', gated: true, inputSchema: { type: 'object', properties: {} } },
        );
      }
      return result;
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('ui_click', { window_id: 'w1a2b', element_id: 'e3' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('ui_observe', { window_id: 'w1a2b' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Acciones de equipo terminadas'),
    ], uiBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Opera el Bloc de notas' });
    assert(await waitFor(() => state.approvals.size === 1), 'el clic en apps pide aprobación también en Acceso completo');
    assert(state.dispatches.length === 0, 'no inyecta entrada en la app antes de la aprobación humana');
    const approval = [...state.approvals.values()][0];
    await runtime.handlers.agent_approve({ approval_id: approval.id });
    assert(await waitIdle(session.id), 'las acciones ui continúan después de la aprobación humana');
    assert(state.dispatches.length === 2, 'la aprobación ejecuta el clic; la observación de lectura sigue sola');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    // El backend real auto-aprueba en desatendido las apps declaradas al programar;
    // el puente falso replica ese contrato y registra la lista recibida.
    const uiBridge = async (method, params) => {
      if (method === 'agent_internal_dispatch' && params.meta) {
        // Contrato del broker: el meta-dispacho vuelve a Electron, que ejecuta
        // schedule() y cierra la operación con dispatch_finish.
        return { execute: 'meta', dispatch: { op_id: `op-${params.call_id}`, status: 'running' } };
      }
      if (method === 'agent_internal_dispatch_finish' && !state.dispatches.some((d) => d.op_id === params.op_id)) {
        return { result: params.result };
      }
      if (method === 'agent_internal_approval_ensure' && Array.isArray(params.unattended_apps) && params.unattended_apps.length) {
        state.unattendedApps = params.unattended_apps;
        const response = await bridge(method, params);
        const approval = state.approvals.get(response.approval.id);
        if (approval && approval.status === 'pending') { approval.status = 'approved'; approval.decided_at = Date.now(); }
        return { approval: { ...approval } };
      }
      const result = await bridge(method, params);
      if (method === 'agent_internal_tools') {
        result.tools.push(
          { name: 'ui_click', kind: 'backend', module: 'computer', gated: true, inputSchema: { type: 'object', properties: {} } },
        );
      }
      return result;
    };
    // Elementos distintos: el guardia de repetición bloquearía la 4.ª llamada
    // idéntica antes de alcanzar el techo desatendido.
    const clicks = Array.from({ length: 27 }, (_, i) =>
      fauxAssistantMessage([fauxToolCall('ui_click', { window_id: 'w1a2b', element_id: `e${i}` })], { stopReason: 'toolUse' }));
    await openFaux([
      fauxAssistantMessage([fauxToolCall('task_schedule', {
        action: 'create', content: 'Saca el informe del ERP', due_at: new Date(Date.now() + 1500).toISOString(),
        apps: ['notepad'],
      })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Encargo programado'),
      ...clicks,
      fauxAssistantMessage('Encargo desatendido terminado'),
    ], uiBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    // El broker exige aprobación para programar; el modo de acceso completo la aplica sola.
    await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Programa el encargo' });
    assert(await waitFor(() => state.dispatches.length >= 25, 20000), 'el encargo desatendido auto-aprueba las apps declaradas');
    assert(JSON.stringify(state.unattendedApps) === JSON.stringify(['notepad']), 'la lista blanca declarada llega a la aprobación');
    assert([...state.approvals.values()].every((a) => a.status === 'approved'), 'las aprobaciones desatendidas quedan aprobadas con auditoría');
    assert(state.dispatches.length === 25, 'el techo bloquea la acción 26 del encargo desatendido');
    assert(await waitIdle(session.id), 'el encargo desatendido termina tras el techo');
    await runtime.shutdown();
  }

  for (const legacy of [false, true]) {
    const { bridge } = makeBridge();
    let seen = '';
    let memoryProfile;
    const scopedBridge = (method, params) => {
      if (method === 'agent_internal_memory_context') memoryProfile = params.profile_id;
      return bridge(method, params);
    };
    await openFaux([(context) => { seen = JSON.stringify(context.messages); return fauxAssistantMessage('Respuesta de prueba'); }], scopedBridge);
    const { profile } = await runtime.handlers.agent_profile_save({
      name: 'Revisor breve', instructions: 'Responde de forma breve y cálida.', tools: [],
    });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: profile.id });
    const state = runtime._internal.state();
    const context = state.ctx;
    const sessionDoc = await state.harness.snapshot(state.SessionsDoc, context);
    const conv = await state.harness.conversation(sessionDoc.sessions[session.id].conversationId, context);
    if (legacy) await conv.configure({ instructions: 'Perfil de una conversación anterior: responde de forma breve y cálida.' }, context);
    await runtime.handlers.agent_message_send({
      session_id: session.id, content: 'Solo para este mensaje usa una tabla con mi plantilla', request_id: 'preference-once',
    });
    assert(await waitIdle(session.id), 'el encargo con preferencia puntual termina');
    assert(seen.includes('pedido actual > indicaciones del agente > preferencias de memoria'),
      'el modelo recibe la prioridad del pedido actual, perfil y memoria también en chats anteriores');
    assert(memoryProfile === profile.id, 'la guía de conversación conserva el perfil al consultar la memoria');
    assert(seen.includes('los recuerdos nuevos de un perfil se comparten solo entre sus conversaciones'),
      'la guía respeta la memoria separada por perfil y sus recuerdos globales heredados');
    assert(seen.includes('usa la B') && seen.includes('Solo para este mensaje usa una tabla'),
      'la preferencia global y la petición puntual conservan su origen en la entrada del modelo');
    const transcript = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(transcript.messages.find((message) => message.role === 'user').content === 'Solo para este mensaje usa una tabla con mi plantilla',
      'las reglas de estilo no se atribuyen al texto escrito por el usuario');
    const original = (await conv.agent(context)).instructions;
    await runtime.handlers.agent_profile_save({ ...profile, instructions: 'Responde de forma formal y detallada.' });
    assert((await conv.agent(context)).instructions === original, 'editar el perfil conserva las indicaciones del chat abierto');
    const next = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: profile.id });
    const nextDoc = await state.harness.snapshot(state.SessionsDoc, context);
    const nextConv = await state.harness.conversation(nextDoc.sessions[next.session.id].conversationId, context);
    const nextInstructions = (await nextConv.agent(context)).instructions;
    assert(nextInstructions.includes('formal y detallada') && !nextInstructions.includes('breve y cálida'),
      'solo la conversación nueva recibe el estilo actualizado del perfil');
    assert((await conv.agent(context)).tools.length === 0 && (await nextConv.agent(context)).tools.length === 0,
      'el cambio de estilo no amplía las herramientas del agente');
    await runtime.shutdown();
  }

  for (const legacy of [false, true]) {
    const { bridge } = makeBridge();
    const calls = [];
    const scopes = [];
    const skillId = 'abcdef0123456789abcdef01';
    const skillsBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const catalog = await bridge(method, params);
        catalog.tools.push(...['skills_list', 'skills_read'].map((name) => ({
          name, module: 'agent', kind: 'backend', gated: false,
          inputSchema: { type: 'object', properties: { skill_id: { type: 'string' } } },
        })));
        return catalog;
      }
      if (method === 'agent_internal_dispatch' && params.name.startsWith('skills_')) {
        calls.push(params.name);
        scopes.push(params.context?.profile_id);
        return { result: JSON.stringify(params.name === 'skills_list'
          ? { skills: [{ id: skillId, name: 'pdf-review', description: 'Revisa firmas' }] }
          : { name: 'pdf-review', content: 'Revisa cada firma', next_offset: null }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('skills_list', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('skills_read', { skill_id: skillId })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Leí las instrucciones de revisión de firmas'),
    ], skillsBridge);
    const profile = legacy ? (await runtime.handlers.agent_profile_save({
      name: 'Revisor de skills', instructions: 'Revisa firmas', tools: ['skills_list', 'skills_read'],
    })).profile : null;
    const { session } = await runtime.handlers.agent_session_create({
      provider: 'faux', model: 'faux-1', ...(profile ? { profile_id: profile.id } : {}),
    });
    const context = runtime._internal.shared.deps.chord.BACKGROUND_CONTEXT;
    const state = runtime._internal.state();
    const map = await state.harness.snapshot(state.SessionsDoc, context);
    const conv = await state.harness.conversation(map.sessions[session.id].conversationId, context);
    assert((await conv.agent(context)).instructions.includes('skills_list'), 'las conversaciones nuevas conocen la carga progresiva de skills');
    if (legacy) await conv.configure({ instructions: 'Indicaciones de una conversación anterior' }, context);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Revisa los PDFs con una skill' });
    assert(await waitIdle(session.id), 'el agente descubre y lee una skill por el despacho normal');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(calls.join() === 'skills_list,skills_read' && listed.messages.some((message) => message.content.includes('Leí las instrucciones')),
      'la skill se carga bajo demanda sin pedir aprobación para leer');
    assert(scopes.length === 2 && scopes.every((id) => id === (profile?.id || null)),
      'el runtime identifica las skills por perfil guardado y usa compartidas sin perfil');
    if (legacy) {
      const entries = await conv.entries({}, 500, undefined, context);
      assert(entries.items.some((entry) => entry.kind === 'pi.user' && JSON.stringify(entry.model).includes('skills_list')),
        'las conversaciones anteriores reciben la guía de skills sin reemplazar sus instrucciones');
      assert(listed.messages.find((message) => message.role === 'user').content === 'Revisa los PDFs con una skill',
        'la guía interna de skills no se presenta como texto del usuario');
    }
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const calls = [];
    const resolves = [];
    const skillId = 'abcdef0123456789abcdef01';
    const warning = 'La skill pdf-review no existe en el perfil del agente; se usa la versión compartida (_shared).';
    const skillsBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const catalog = await bridge(method, params);
        catalog.tools.push({ name: 'skills_read', module: 'agent', kind: 'backend', gated: false,
          inputSchema: { type: 'object', properties: { skill_id: { type: 'string' } } } });
        return catalog;
      }
      if (method === 'agent_internal_skill_resolve') {
        resolves.push(params);
        if (params.skill_id !== skillId) throw new Error('Skill desconocida; elige una del catálogo');
        return { skill: { id: skillId, name: 'pdf-review', warning, notice: 'Las skills son instrucciones locales, no permisos.' } };
      }
      if (method === 'agent_internal_dispatch') {
        calls.push(params.name);
        if (params.name === 'skills_read') return { result: JSON.stringify({ name: 'pdf-review', content: 'Revisa cada firma', next_offset: null }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('skills_read', { skill_id: skillId })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Apliqué la skill'),
    ], skillsBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const initial = (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools;
    await runtime.handlers.agent_tools_set({ session_id: session.id,
      names: [...new Set([...initial.filter((tool) => tool.enabled).map((tool) => tool.name), 'canvas_list'])] });
    let unknown;
    try { await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Revisa', skill_id: 'otro' }); } catch (err) { unknown = err; }
    assert(unknown && /desconocida/.test(unknown.message) && calls.length === 0, 'un skill_id ajeno al catálogo rechaza el mensaje');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Revisa el contrato', skill_id: skillId });
    assert(await waitIdle(session.id), 'el turno con skill termina');
    assert(resolves.length === 2 && resolves.every((item) => item.profile_id === null),
      'el skill_id se resuelve con el mismo perfil que usa skills_read');
    assert(calls.join() === 'skills_read,canvas_list', 'ninguna herramienta corre antes de cargar la skill elegida');
    const context = runtime._internal.shared.deps.chord.BACKGROUND_CONTEXT;
    const state = runtime._internal.state();
    const map = await state.harness.snapshot(state.SessionsDoc, context);
    const conv = await state.harness.conversation(map.sessions[session.id].conversationId, context);
    const entries = JSON.stringify((await conv.entries({}, 500, undefined, context)).items);
    assert(entries.includes(`skill_id ${skillId}`) && entries.includes('instrucciones locales, no permisos'),
      'el turno recibe la orden de leer la skill y el aviso de que no concede permisos');
    assert(entries.includes('Antes de cualquier otra herramienta carga la skill'), 'la herramienta adelantada se bloquea con una indicación');
    assert(entries.includes(warning), 'el uso de la versión compartida queda visible en la conversación');
    await runtime.shutdown();
  }

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
    const { bridge } = makeBridge();
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const { fauxProvider } = await import('@earendil-works/pi-ai');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-reasoning-'));
    const dbPath = path.join(dir, 'agent.sqlite');
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    runtime._internal._providerOverrides.set('faux', fauxProvider().provider);
    const thinking = fauxProvider({ provider: 'razona', models: [{ id: 'razonador', reasoning: true }] });
    runtime._internal._providerOverrides.set('razona', thinking.provider);
    const context = runtime._internal.shared.deps.chord.BACKGROUND_CONTEXT;
    const thinkingLevel = async (id) => {
      const map = await runtime._internal.state().harness.snapshot(runtime._internal.state().SessionsDoc, context);
      const conv = await runtime._internal.state().harness.conversation(map.sessions[id].conversationId, context);
      return (await conv.agent(context)).thinkingLevel;
    };
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    assert(Array.isArray(session.reasoning_levels) && session.reasoning_levels.length === 0, 'un modelo sin razonamiento no ofrece el control');
    const changed = await runtime.handlers.agent_session_reasoning_set({ id: session.id, reasoning_effort: 'high' });
    assert(changed.session.reasoning_effort === 'high' && !changed.session.conversationId, 'devuelve el nivel guardado sin datos privados');
    assert(await thinkingLevel(session.id) === 'off', 'un modelo sin razonamiento sigue sin razonar');
    const switched = await runtime.handlers.agent_session_model_set({ id: session.id, provider: 'razona', model: 'razonador' });
    assert(switched.session.reasoning_levels.includes('high'), 'un modelo con razonamiento ofrece sus niveles');
    assert(await thinkingLevel(session.id) === 'high', 'el nivel elegido se aplica al cambiar a un modelo que razona');
    await runtime.handlers.agent_session_reasoning_set({ id: session.id, reasoning_effort: 'minimal' });
    assert(await thinkingLevel(session.id) === 'minimal', 'el nivel se aplica al modelo actual');
    for (const effort of ['off', 'ultra', '', null, undefined]) {
      let rejected;
      try { await runtime.handlers.agent_session_reasoning_set({ id: session.id, reasoning_effort: effort }); } catch (err) { rejected = err; }
      assert(rejected, `rechaza un nivel inválido: ${effort}`);
    }
    await runtime.shutdown();
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const restored = (await runtime.handlers.agent_sessions_list()).sessions.find((item) => item.id === session.id);
    assert(restored.reasoning_effort === 'minimal' && restored.reasoning_levels.includes('minimal'), 'el nivel sobrevive al reinicio de SQLite');
    runtime._internal._providerOverrides.set('razona', fauxProvider({ provider: 'razona', models: [{ id: 'razonador', reasoning: false }] }).provider);
    const synced = (await runtime.handlers.agent_sessions_list()).sessions.find((item) => item.id === session.id);
    assert(synced.reasoning_levels.length === 0 && await thinkingLevel(session.id) === 'off',
      'la lista refleja al momento los niveles que Proveedores IA declara para el modelo');
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-permissions-'));
    const dbPath = path.join(dir, 'agent.sqlite');
    const { bridge } = makeBridge();
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const { session: other } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const changed = await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' });
    assert(changed.session.permission_mode === 'full' && !changed.session.conversationId, 'devuelve el modo guardado sin datos privados');
    for (const mode of ['invalid', '', null, undefined, true]) {
      let rejected;
      try { await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: mode }); } catch (err) { rejected = err; }
      assert(rejected, `rechaza un modo inválido: ${mode}`);
    }
    await runtime.shutdown();
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const { sessions } = await runtime.handlers.agent_sessions_list();
    assert(sessions.find((item) => item.id === session.id).permission_mode === 'full', 'el modo sobrevive al reinicio de SQLite');
    assert(!sessions.find((item) => item.id === other.id).permission_mode, 'no cambia los permisos de otras conversaciones');
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const mode of ['ask', 'auto', 'full']) {
    const { bridge, state } = makeBridge();
    const webBridge = async (method, params) => {
      const result = await bridge(method, params);
      if (method === 'agent_internal_tools') result.tools.push({ name: 'web_read', description: 'Leer página', gated: false, kind: 'backend', inputSchema: { type: 'object', properties: {} } });
      return result;
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('web_read', {}), fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
    ], webBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: mode });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'hazlo' });
    if (mode !== 'full') {
      assert(await waitFor(() => state.approvals.size === (mode === 'ask' ? 2 : 1)), `${mode}: pausa las llamadas que requieren aprobación`);
      assert(state.dispatches.length === (mode === 'ask' ? 0 : 1), `${mode}: no ejecuta las acciones pendientes`);
      let busy;
      try { await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' }); } catch (err) { busy = err; }
      assert(busy && /termine el turno/.test(busy.message), 'no amplía permisos durante un turno activo');
      for (const approval of state.approvals.values()) await runtime.handlers.agent_approve({ approval_id: approval.id });
    }
    assert(await waitIdle(session.id), `${mode}: el turno termina`);
    assert(state.dispatches.length === 2, `${mode}: ejecuta cada acción una vez`);
    assert([...state.approvals.values()].every((approval) => approval.status === 'approved'), `${mode}: conserva las aprobaciones en el registro`);
    assert(state.approvals.size === (mode === 'ask' ? 2 : 1), `${mode}: aplica la política de internet y efectos`);
    await runtime.shutdown();
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

  {
    const policyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-agent-policy-'));
    fs.mkdirSync(path.join(policyRoot, 'Antares', 'ai-agent'), { recursive: true });
    const policyFile = path.join(policyRoot, 'Antares', 'ai-agent', 'browser-policy.json');
    fs.writeFileSync(policyFile, JSON.stringify({ always_allowed: ['www.bcp.pe'] }));
    const realLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = policyRoot;
    try {
      const { bridge, state } = makeBridge();
      let executed = 0;
      runtime._internal.shared.nativeTools = {
        nativeToolContext: async () => ({ tool_version: 'fake-v1', page_url: 'https://www.bcp.pe/panel', domain: 'www.bcp.pe', policy_blocked: false }),
        nativeToolSpecs: () => [{ name: 'web_click', description: 'Clic web', gated: true, kind: 'native', inputSchema: { type: 'object', properties: {} } }],
        runNativeTool: async () => { executed += 1; return { ok: true }; },
      };
      await openFaux([
        fauxAssistantMessage([fauxToolCall('web_click', {})], { stopReason: 'toolUse' }),
        fauxAssistantMessage('hecho'),
      ], bridge);
      const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'haz clic' });
      assert(await waitIdle(session.id), 'el turno termina cuando el dominio está permitido siempre');
      assert(executed === 1, 'la acción web sobre un dominio permitido siempre se ejecuta sin preguntar');
      const decided = [...state.approvals.values()];
      assert(decided.length === 1 && decided[0].status === 'approved', 'la aprobación del dominio autorizado se resuelve sola');
      runtime._internal.shared.nativeTools = null;
      await runtime.shutdown();

      const ajeno = makeBridge();
      let rechazado = 0;
      runtime._internal.shared.nativeTools = {
        nativeToolContext: async () => ({ tool_version: 'fake-v1', page_url: 'https://panel.banco-ajeno.pe/f', domain: 'panel.banco-ajeno.pe', policy_blocked: false }),
        nativeToolSpecs: () => [{ name: 'web_click', description: 'Clic web', gated: true, kind: 'native', inputSchema: { type: 'object', properties: {} } }],
        runNativeTool: async () => { rechazado += 1; return { ok: true }; },
      };
      await openFaux([
        fauxAssistantMessage([fauxToolCall('web_click', {})], { stopReason: 'toolUse' }),
        fauxAssistantMessage('bloqueada'),
      ], ajeno.bridge);
      const sesionAjena = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
      await runtime.handlers.agent_message_send({ session_id: sesionAjena.session.id, content: 'haz clic' });
      assert(await waitFor(() => ajeno.state.approvals.size > 0), 'un dominio sin permiso sigue pidiendo aprobación');
      const pending = [...ajeno.state.approvals.values()].find((a) => a.status === 'pending');
      await runtime.handlers.agent_deny({ approval_id: pending.id });
      assert(await waitIdle(sesionAjena.session.id), 'el turno continúa tras rechazar la acción web');
      assert(rechazado === 0, 'la acción web rechazada no se ejecuta');
      runtime._internal.shared.nativeTools = null;
      await runtime.shutdown();

      const recordar = makeBridge();
      await openFaux([], recordar.bridge);
      recordar.state.approvals.set('ap-rec', { id: 'ap-rec', session_id: 'ses-recordar', call_id: 'call-rec', method: 'web_type', status: 'pending',
        context: { page_url: 'https://forms.miejemplo.pe/paso-2' } });
      recordar.state.approvals.set('ap-bloq', { id: 'ap-bloq', session_id: 'ses-recordar', call_id: 'call-bloq', method: 'web_click', status: 'pending',
        context: { page_url: 'https://operaciones.sunat.gob.pe/ruc' } });
      await runtime.handlers.agent_approve({ approval_id: 'ap-rec', remember: true });
      await runtime.handlers.agent_approve({ approval_id: 'ap-bloq', remember: true });
      const written = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
      assert(written.always_allowed.includes('forms.miejemplo.pe'), 'Permitir siempre persiste el dominio de la página aprobada');
      assert(!written.always_allowed.includes('operaciones.sunat.gob.pe'), 'un dominio bloqueado nunca entra en Permitir siempre');
      await runtime.shutdown();
    } finally {
      process.env.LOCALAPPDATA = realLocalAppData;
      delete require.cache[require.resolve('../electron/agent-browser-policy')];
      fs.rmSync(policyRoot, { recursive: true, force: true });
    }
  }

  for (const name of PUBLIC_METHODS) {
    assert(nativeDispatchFor(name) === 'agent', `${name} → native:agent`);
  }
  {
    const calls = [];
    runtime._internal.shared.browser = {
      state: () => ({ open: false, user_control: false }),
      dock: (bounds) => { calls.push(['dock', bounds]); return { docked: !!bounds }; },
      setUserControl: (user) => { calls.push(['control', user]); return { user_control: user }; },
      allowAgent: () => { calls.push(['allow']); return { open: true, user_control: false }; },
      activateTab: (tab) => { calls.push(['tab', tab]); return { active_tab: tab }; },
      navigate: async (action, url) => { calls.push([action, url]); return { open: true, url: url || '' }; },
    };
    const handle = runtime.handlers.agent_browser;
    assert((await handle({ action: 'state' })).open === false, 'agent_browser devuelve el estado del navegador');
    assert((await handle({ action: 'bounds', bounds: { x: 1, y: 2, width: 300, height: 200 } })).docked === true, 'la UI coloca el panel');
    assert((await handle({ action: 'bounds' })).docked === false, 'sin hueco la página vuelve a su ventana anfitriona');
    assert((await handle({ action: 'control', user: true })).user_control === true, 'el usuario puede tomar el control');
    assert((await handle({ action: 'open', url: 'example.com' })).url === 'example.com', 'la barra de dirección abre páginas');
    assert((await handle({ action: 'allow' })).user_control === false, 'la UI puede liberar la espera del navegador');
    assert((await handle({ action: 'tab', tab: 'user' })).active_tab === 'user', 'la UI cambia de pestaña');
    let rejected = false;
    try { await handle({ action: 'borrar' }); } catch { rejected = true; }
    assert(rejected && calls.length === 6, 'una acción desconocida se rechaza sin tocar el navegador');
    const open = runtime.open;
    runtime.open = async () => { throw new Error('Motor del agente no disponible'); };
    try {
      let hidden = false;
      try {
        const response = await require('../electron/agent-handlers').handleAgentCall('agent_browser', { action: 'bounds', bounds: null });
        hidden = response.handled && response.result.docked === false;
      } catch { }
      assert(hidden, 'salir de Agent retira el navegador sin inicializar el motor de conversaciones');
      let needsRuntime = false;
      try { await require('../electron/agent-handlers').handleAgentCall('agent_sessions_list', {}); }
      catch (err) { needsRuntime = err.message === 'Motor del agente no disponible'; }
      assert(needsRuntime, 'las conversaciones siguen inicializando su motor');
    } finally { runtime.open = open; }
    runtime._internal.shared.browser = undefined;
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
    assert(state.dispatchLog.filter((id) => id.startsWith(`${calls[1].id}@task:`)).length === 1, 'dispatch deduplicado: una ejecución por call_id');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(listed.messages.filter((m) => m.role === 'tool_result' && m.tool_use_id === calls[1].id).length === 1, 'sin tool_result duplicado tras aprobación');

    const idle = await runtime.handlers.agent_turn_cancel({ session_id: session.id });
    assert(idle.cancelled === false, 'turn_cancel sobre idle informa cancelled:false');
    await runtime.shutdown();
  }

  {
    const { supportsReasoning, thinkingLevelFor, modelDefinition } = require('../electron/agent-execution');
    assert(supportsReasoning('anthropic_messages', 'claude-sonnet-4-5') && !supportsReasoning('anthropic_messages', 'claude-3-5-haiku'),
      'Anthropic pide razonamiento solo a modelos que lo admiten');
    assert(supportsReasoning('openai_chat', 'deepseek-r1:8b') && !supportsReasoning('openai_chat', 'gpt-4o') && !supportsReasoning('openai_chat', 'llama3.1'),
      'los modelos compatibles genéricos no reciben parámetros de razonamiento');
    assert(thinkingLevelFor([], 'high') === 'off' && thinkingLevelFor(['minimal', 'low', 'medium', 'high']) === 'low'
      && thinkingLevelFor(['minimal', 'low', 'medium', 'high'], 'xhigh') === 'high' && thinkingLevelFor(['low', 'medium'], 'minimal') === 'low',
      'el nivel elegido se ajusta al más cercano que admite el modelo');
    assert(thinkingLevelFor(['low', 'medium', 'high', 'xhigh', 'max'], 'max') === 'max'
      && thinkingLevelFor(['low', 'medium', 'high', 'xhigh'], 'max') === 'xhigh',
      'max se envía solo a los modelos que lo admiten y, si no, baja al nivel inferior');
    const { OPENAI_MODELS } = await import('@earendil-works/pi-ai/providers/openai.models');
    const { ANTHROPIC_MODELS } = await import('@earendil-works/pi-ai/providers/anthropic.models');
    const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai');
    const anthropicLevels = { provider: 'anthropic', style: 'anthropic_messages', base_url: 'https://api.anthropic.com' };
    const levelsOf = (id) => getSupportedThinkingLevels(modelDefinition(anthropicLevels, id, 'anthropic-messages',
      ANTHROPIC_MODELS[id], ANTHROPIC_MODELS[id]));
    assert(levelsOf('claude-opus-5-5').includes('max') && !levelsOf('claude-haiku-4-5').includes('max'),
      'el catálogo decide qué modelos admiten el nivel max');
    const openaiInfo = { provider: 'openai', style: 'openai_chat', base_url: 'https://api.openai.com/v1' };
    const gpt5 = modelDefinition(openaiInfo, 'gpt-5', 'openai-completions', undefined, OPENAI_MODELS['gpt-5']);
    assert(gpt5.reasoning === true && gpt5.thinkingLevelMap && gpt5.thinkingLevelMap.xhigh === null,
      'el catálogo de pi-ai marca el razonamiento y los niveles de los modelos conocidos');
    const fable = ANTHROPIC_MODELS['claude-fable-5'];
    const anthropicInfo = { provider: 'anthropic', style: 'anthropic_messages', base_url: 'https://api.anthropic.com' };
    assert(modelDefinition(anthropicInfo, fable.id, 'anthropic-messages', fable, fable).compat.forceAdaptiveThinking === true,
      'los Claude con pensamiento adaptativo lo reciben del catálogo');
    const custom = (reasoning) => ({ provider: 'custom-glm', style: 'openai_chat', base_url: 'http://127.0.0.1:8000/v1', custom: true, capabilities: { reasoning } });
    assert(modelDefinition(custom(true), 'zai-org/GLM-5.3-Flash', 'openai-completions').reasoning === true
      && modelDefinition(custom(false), 'deepseek-r1', 'openai-completions').reasoning === false,
      'la capacidad declarada en el proveedor personalizado prevalece sobre el nombre');
  }

  {
    const { bridge } = makeBridge();
    const { fauxThinking, fauxText } = await import('@earendil-works/pi-ai');
    await openFaux([fauxAssistantMessage([fauxThinking('Comparo las dos plantillas'), fauxText('Usa la B')])], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: '¿cuál plantilla?' });
    assert(await waitIdle(session.id), 'el turno con razonamiento termina');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const answer = messages.find((m) => m.role === 'assistant');
    assert(answer.reasoning === 'Comparo las dos plantillas' && answer.content === 'Usa la B',
      'el razonamiento del modelo viaja aparte del texto de la respuesta');
    assert(!('reasoning' in messages.find((m) => m.role === 'user')), 'solo las respuestas llevan razonamiento');
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
    const { bridge } = makeBridge();
    const delegated = [];
    const inputs = [];
    const mentionedPaths = [];
    const held = { id: 'held', session_id: '', status: 'pending' };
    let researcher;
    let reviewer;
    const botBridge = async (method, params) => {
      if (method === 'agent_internal_grants_add') mentionedPaths.push(...params.paths);
      if (method === 'agent_internal_approvals_pending' && held.session_id) return { approvals: held.status === 'pending' ? [held] : [] };
      if (method === 'agent_internal_approvals_deny_session' && held.session_id) { held.status = 'denied'; return { denied: [held.id] }; }
      if (method === 'agent_internal_dispatch' && params.name === 'subagent_run') {
        delegated.push(params);
        return { result: JSON.stringify({ agent: { id: params.context.subagent.id, name: params.context.subagent.name },
          status: 'done', text: 'Comprobé 3 firmas', steps: [], ms: 1 }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      (context) => { inputs.push(JSON.stringify(context.messages)); return fauxAssistantMessage([
        fauxToolCall('subagent_run', { agent: researcher.id, task: 'Busca las firmas del informe adjunto' }),
      ], { stopReason: 'toolUse' }); },
      (context) => { inputs.push(JSON.stringify(context.messages)); return fauxAssistantMessage([
        fauxToolCall('subagent_run', { agent: reviewer.id, task: 'El investigador comprobó 3 firmas. Revisa sus conclusiones.' }),
      ], { stopReason: 'toolUse' }); },
      fauxAssistantMessage('Ambos bots completaron la revisión'),
      (context) => { inputs.push(JSON.stringify(context.messages)); return fauxAssistantMessage('La referencia usa un id estable'); },
      (context) => { inputs.push(JSON.stringify(context.messages.at(-1))); return fauxAssistantMessage('Son texto literal y un correo'); },
      fauxAssistantMessage('El nombre del bot no es un archivo adjunto'),
      fauxAssistantMessage([fauxToolCall('subagent_run', { agent: 'Investigador', task: 'No elijas un duplicado' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Necesito un identificador único'),
    ], botBridge);
    researcher = (await runtime.handlers.agent_profile_save({ name: 'Investigador', instructions: 'Lee documentos', tools: ['canvas_list'] })).profile;
    reviewer = (await runtime.handlers.agent_profile_save({ name: 'Revisor de PDFs', instructions: 'Revisa conclusiones', tools: [] })).profile;
    await runtime.handlers.agent_profile_save({ name: 'Sellador', instructions: 'Un bot con nombre de módulo', tools: [] });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const content = 'Colabora @Investigador con @"Revisor de PDFs" y consulta @sellador';
    const response = await runtime.handlers.agent_message_send({ session_id: session.id, content });
    assert(await waitIdle(session.id), 'la colaboración mencionada termina');
    assert(response.mentions.modules.join() === 'sellador' && response.mentions.unknown.length === 0,
      'los bots se resuelven aparte y se conservan las menciones de módulos');
    assert(inputs[0].includes('solicita colaborar') && inputs[0].includes(researcher.id) && inputs[0].includes(reviewer.id),
      'el coordinador recibe identidades exactas, sin cambiar el mensaje visible');
    assert(delegated.length === 2 && delegated[0].context.subagent.id === researcher.id && delegated[1].context.subagent.id === reviewer.id
      && delegated[1].params.task.includes('3 firmas') && inputs[1].includes('Comprobé 3 firmas'),
    'el segundo bot recibe las conclusiones verificadas del primero por una delegación con comprobante');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(listed.messages[0].content === content && listed.messages.flatMap((message) => message.tool_calls || []).length === 2,
      'la conversación conserva el texto original y las dos trazas de colaboración');
    await runtime.handlers.agent_profile_save({ ...researcher, name: 'Archivado' });
    const replacement = (await runtime.handlers.agent_profile_save({ name: 'Investigador', instructions: 'Otro bot', tools: [] })).profile;
    await runtime.handlers.agent_message_send({ session_id: session.id, content: `Consulta @bot:${researcher.id}; literal \`@Investigador\` y correo usuario@Investigador.com` });
    assert(await waitIdle(session.id), 'se admite la referencia estable sin interpretar correos como bots');
    assert(inputs.at(-1).includes(researcher.id) && !inputs.at(-1).includes(replacement.id),
      'renombrar el bot y reutilizar su nombre no cambia el destinatario seleccionado por id');
    await runtime.handlers.agent_profile_delete({ id: replacement.id });
    await runtime.handlers.agent_profile_save(researcher);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Texto `@Investigador` y usuario@Investigador.com y ```\n@Investigador\n```' });
    assert(await waitIdle(session.id) && !inputs.at(-1).includes('solicita colaborar'), 'el código y los correos no solicitan una colaboración');
    await runtime.handlers.agent_profile_save({ name: String.raw`C:\privado\informe.pdf`, instructions: 'Un nombre parecido a una ruta', tools: [] });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: String.raw`Consulta @"C:\privado\informe.pdf"` });
    assert(await waitIdle(session.id) && mentionedPaths.length === 0, 'mencionar un bot cuyo nombre parece una ruta no concede acceso a archivos');
    await runtime.handlers.agent_profile_save({ name: 'Investigador', instructions: 'Otro perfil', tools: [] });
    for (const text of ['Consulta @Investigador', 'Consulta @"Investigador"', 'Consulta @"Eliminado"', 'Consulta @bot:missing']) {
      let error;
      try { await runtime.handlers.agent_message_send({ session_id: session.id, content: text }); } catch (err) { error = err; }
      assert(error && error.category === 'VALIDATION_ERROR', `una mención inexistente o ambigua no se envía: ${text}`);
    }
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['canvas_list'] });
    let disabled;
    try { await runtime.handlers.agent_message_send({ session_id: session.id, content: `Consulta @bot:${researcher.id}` }); } catch (err) { disabled = err; }
    assert(disabled && disabled.message.includes('subagent_run'), 'mencionar un bot no habilita delegación desactivada');
    held.session_id = session.id;
    try { await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Consulta @"Eliminado"', correction: true }); } catch {}
    assert(held.status === 'pending', 'una mención inválida no rechaza aprobaciones pendientes al corregir');
    held.session_id = '';
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: null });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Comprueba un nombre duplicado sin mención' });
    assert(await waitIdle(session.id) && delegated.length === 2, 'la herramienta tampoco elige silenciosamente el primer nombre duplicado');
    await runtime.shutdown();
  }

  for (const mode of ['auto', 'full']) {
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
    const faux = await openFaux([
      fauxAssistantMessage([fauxToolCall('autoimg_status', {}), fauxToolCall('autoimg_sync_to_sheet', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('sincronizado'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: mode });
    const { tools } = await runtime.handlers.agent_tools_list({});
    assert(tools.some((t) => t.name === 'autoimg_status' && t.kind === 'native' && t.module === 'autoimg'), 'tools_list incluye herramientas nativas');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'sincroniza autoimg' });
    if (mode === 'auto') {
      assert(await waitFor(async () =>
        (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals.length > 0), 'el efecto nativo pide aprobación');
      assert(JSON.stringify(executed) === JSON.stringify(['autoimg_status']), 'la lectura nativa se ejecuta sin aprobación');
      const ap = (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals[0];
      await runtime.handlers.agent_approve({ approval_id: ap.id });
    }
    assert(await waitIdle(session.id), 'el turno termina tras aprobar el efecto nativo');
    assert(JSON.stringify(executed) === JSON.stringify(['autoimg_status', 'autoimg_sync_to_sheet']), 'cada herramienta nativa se ejecuta una vez');
    assert(state.dispatches.every((d) => d.status === 'succeeded'), 'Electron registra el comprobante en Python');
    if (mode === 'full') {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('autoimg_sync_to_sheet', {})], { stopReason: 'toolUse' }),
        fauxAssistantMessage('deshabilitada'),
      ]);
      await runtime.handlers.agent_tools_set({ session_id: session.id, names: [] });
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'intenta otra vez' });
      assert(await waitIdle(session.id), 'termina el turno con una herramienta excluida');
      assert(executed.length === 2 && state.dispatches.length === 2, 'Acceso completo conserva las herramientas deshabilitadas');
    }
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
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-drop-'));
    const previousAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = appData;
    const dropped = path.join(appData, 'foto.png');
    fs.writeFileSync(dropped, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const grantAll = async (method, params) => (method === 'agent_internal_grants_add'
      ? (state.grants.push(params), { granted: params.paths, rejected: [] }) : bridge(method, params));
    const seen = [];
    await openFaux([(context) => { seen.push(context.messages); return fauxAssistantMessage('ok'); }], grantAll);
    runtime._internal.shared.dialog = { showOpenDialog: async () => { throw new Error('soltar no abre diálogo'); } };
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    let invalid = null;
    try { await runtime.handlers.agent_attach({ kind: 'files', paths: ['relativo.png'] }); } catch (err) { invalid = err; }
    assert(invalid && /no válida/.test(invalid.message), 'una ruta soltada debe ser absoluta');
    const res = await runtime.handlers.agent_attach({ kind: 'files', paths: [dropped],
      data: [{ name: 'captura.png', data: Buffer.from('png').toString('base64') }] });
    assert(res.attachments.map((a) => a.name)[0] === 'foto.png' && res.attachments[1].name.endsWith('-captura.png'),
      'soltar y pegar adjuntan sin diálogo');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'mira esto', attachments: res.attachments.map((a) => a.id) });
    const pasted = state.grants.at(-1).paths[1];
    assert(pasted.startsWith(path.join(appData, 'Antares', 'ai-agent', 'attachments')) && fs.readFileSync(pasted, 'utf8') === 'png',
      'lo pegado se guarda en la carpeta de adjuntos del agente');
    assert(await waitIdle(session.id), 'el turno con imágenes termina');
    const images = seen[0].find((m) => m.role === 'user').content.filter((block) => block.type === 'image');
    assert(images.length === 2 && images.every((block) => block.mimeType === 'image/png'), 'un modelo con visión recibe las imágenes');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(messages[0].content === 'mira esto', 'el transcript solo muestra el texto');
    runtime._internal.shared.dialog = null;
    await runtime.shutdown();
    process.env.LOCALAPPDATA = previousAppData;
    fs.rmSync(appData, { recursive: true, force: true });
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
      starter: 'Prepara el informe de este mes', tools: ['canvas_list'], color: '#0E7490',
    });
    assert(profile.id && profile.tools.join() === 'canvas_list', 'el agente guarda instrucciones y herramientas');
    for (const bad of [{ name: '', instructions: 'x' }, { name: 'X', instructions: '' }, { name: 'X', instructions: 'token: abcdef123456' },
      { name: 'X', instructions: 'y', tools: ['desconocida'] }, { id: 'nope', name: 'X', instructions: 'y' },
      ...[null, 12, '#fff', 'red', 'url(https://example.com)', '#0E7490\n'].map((color) => ({ name: 'X', instructions: 'y', color }))]) {
      let error;
      try { await runtime.handlers.agent_profile_save(bad); } catch (err) { error = err; }
      assert(!!error, 'un agente inválido, con secretos o herramientas inexistentes se rechaza');
    }
    await runtime.shutdown();
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const { profiles } = await runtime.handlers.agent_profiles_list();
    assert(profiles.length === 1 && profiles[0].name === 'Informe mensual', 'los agentes sobreviven al reinicio');
    assert(profiles[0].color === '#0E7490', 'el color elegido sobrevive al reinicio');
    const { color, ...legacyUpdate } = profiles[0];
    assert((await runtime.handlers.agent_profile_save(legacyUpdate)).profile.color === '#0E7490', 'un cliente anterior conserva el color');
    const automatic = (await runtime.handlers.agent_profile_save({ ...legacyUpdate, color: '' })).profile;
    assert(!Object.hasOwn(automatic, 'color'), 'volver al color automático elimina la selección');
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: profile.id });
    assert(session.title === 'Informe mensual' && session.profile.id === profile.id, 'la conversación nace del agente');
    const enabled = (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools.filter((t) => t.enabled).map((t) => t.name);
    assert(enabled.join() === 'canvas_list', 'la conversación aplica las herramientas del agente');
    const conv = await runtime._internal.state().harness.conversation(
      (await require('../electron/agent-shared').requireSession(session.id)).conversationId, runtime._internal.state().ctx);
    const instructions = (await conv.agent(runtime._internal.state().ctx)).instructions;
    assert(String(instructions).includes('plantilla de cortes') && String(instructions).includes('no amplían los permisos elegidos'),
      'las indicaciones del agente se suman sin ampliar los permisos elegidos');
    const plain = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const plainTools = (await runtime.handlers.agent_tools_list({ session_id: plain.session.id })).tools;
    const defaults = require('../electron/agent-execution').defaultToolNames([...runtime._internal.shared.toolSpecs.values()]);
    const expected = new Set(defaults || plainTools.map((t) => t.name));
    assert(plainTools.every((t) => t.enabled === expected.has(t.name)), 'una conversación normal no hereda el agente');
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
    const initial = (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools;
    await runtime.handlers.agent_tools_set({ session_id: session.id,
      names: [...new Set([...initial.filter((tool) => tool.enabled).map((tool) => tool.name), 'canvas_list'])] });
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
    assert(sent.context.subagent.provider === session.provider && sent.context.subagent.model === session.model,
      'la delegación lleva el proveedor y modelo actuales del runtime durable');
    await runtime.handlers.agent_profile_delete({ id: profile.id });
    assert(!(await runtime.handlers.agent_tools_list({})).tools.some((tool) => tool.name === 'subagent_run'),
      'sin agentes guardados no se ofrece delegar');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    await openFaux([fauxAssistantMessage('listo'), fauxAssistantMessage('hecho')], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'primera consulta' });
    assert(await waitIdle(session.id), 'el primer turno termina');
    const first = (await runtime.handlers.agent_messages_list({ session_id: session.id })).usage;
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'segunda consulta' });
    assert(await waitIdle(session.id), 'el segundo turno termina');
    const { usage } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(first.context > 0 && usage.input > first.input, 'el total acumula los turnos');
    assert(usage.context >= first.input, 'el contexto del último turno incluye el historial reenviado');
    assert(usage.context < first.context + first.input, 'el contexto no acumula los turnos anteriores');
    assert(first.cached === 0 && usage.cached > 0 && usage.cached < usage.prompt,
      'el segundo turno reutiliza el prefijo cacheado y se informa frente al prompt total');
    assert(usage.window === 128000 && usage.turn && usage.turn.input > 0,
      'el medidor conoce la ventana del modelo y el gasto del último turno');
    assert(usage.cost === 0, 'un proveedor sin precios no inventa un coste');
    const { requireSession } = require('../electron/agent-shared');
    const conversationId = (await requireSession(session.id)).conversationId;
    const state = runtime._internal.state();
    await state.harness.commit(async (tx) => {
      const doc = await tx.doc(runtime._internal.shared.deps.pi.UsageDoc, conversationId);
      doc.models['openai/gpt-4o'] = {
        input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 1500,
        cost: { input: 0.0025, output: 0.005, cacheRead: 0, cacheWrite: 0, total: 0.0075 },
      };
    }, state.ctx);
    const billed = (await runtime.handlers.agent_messages_list({ session_id: session.id })).usage;
    assert(Math.abs(billed.cost - 0.0075) < 1e-9 && billed.input >= 1000,
      'el coste acumulado sale del libro pi.usage de la conversación');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const seen = [];
    const reply = (text) => (context) => {
      seen.push(context.messages);
      return fauxAssistantMessage(text);
    };
    await openFaux([reply('primero'), reply('segundo'), reply('tercero')], bridge, {
      faux: { models: [{ id: 'faux-1', contextWindow: 8192, maxTokens: 2048 }] },
    });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'primer turno ' + 'a'.repeat(30000) });
    assert(await waitIdle(session.id), 'el turno largo termina');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'segundo turno' });
    assert(await waitIdle(session.id), 'el segundo turno compacta el historial');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'tercer turno' });
    assert(await waitIdle(session.id), 'el tercer turno termina');
    const last = seen[seen.length - 1];
    assert(last.some((message) => typeof message.content === 'string'
      && message.content.includes('[Contexto compactado por Antares')),
      'una ventana pequeña recibe un resumen estructurado en lugar del historial completo');
    assert(last.some((message) => message.role === 'user' && String(message.content).includes('tercer turno')),
      'el mensaje actual viaja intacto');
    assert(!JSON.stringify(last).includes('a'.repeat(500)), 'el texto antiguo ya no consume la ventana');
    const { usage } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(usage && usage.window === 8192, 'el medidor usa la ventana real del modelo pequeño');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    await openFaux([fauxAssistantMessage('listo'), fauxAssistantMessage('Resumen del encargo')], bridge, {
      settings: { compaction: { enabled: true, reserveTokens: 1024, keepRecentTokens: 100, backgroundTokens: 0 } },
    });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'organiza el encargo' });
    assert(await waitIdle(session.id), 'el turno previo a la compactación termina');
    const { requireSession } = require('../electron/agent-shared');
    const state = runtime._internal.state();
    const conv = await state.harness.conversation((await requireSession(session.id)).conversationId, state.ctx);
    const taskId = await conv.compact(undefined, state.ctx);
    const settled = await state.harness.waitForTask(taskId, state.ctx);
    assert(settled.state.outcome.status === 'completed', 'la compactación manual de pi-durable termina');
    await conv.waitForIdle(state.ctx);
    const { usage } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(usage && usage.compactions === 1, 'el medidor informa de la compactación aplicada');
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
    const { bridge, state } = makeBridge();
    let failDenial = true;
    let sawCorrection = false;
    await openFaux([
      fauxAssistantMessage([fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      (context) => {
        sawCorrection = JSON.stringify(context.messages).includes('no borres');
        return fauxAssistantMessage('corregido');
      },
      fauxAssistantMessage([fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('segundo encargo'),
    ], async (method, params) => {
      if (method === 'agent_internal_approvals_deny_session' && failDenial) {
        failDenial = false;
        throw new Error('No se pudo rechazar la aprobación');
      }
      return bridge(method, params);
    });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'limpia' });
    assert(await waitFor(() => state.approvals.size > 0), 'el encargo espera antes de corregir');
    const correction = { session_id: session.id, content: 'no borres', request_id: 'accepted-correction', correction: true };
    let failed;
    try { await runtime.handlers.agent_message_send(correction); } catch (err) { failed = err; }
    assert(!!failed, 'se informa de un fallo al desbloquear la corrección admitida');
    const retried = await runtime.handlers.agent_message_send(correction);
    assert(retried.duplicate && await waitIdle(session.id) && sawCorrection,
      'el reintento desbloquea la corrección ya admitida sin duplicarla');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'otro encargo' });
    assert(await waitFor(() => [...state.approvals.values()].some((a) => a.status === 'pending')),
      'el encargo posterior espera su propia aprobación');
    await runtime.handlers.agent_message_send(correction);
    assert([...state.approvals.values()].some((a) => a.status === 'pending'),
      'repetir una corrección ya aplicada no rechaza aprobaciones posteriores');
    await runtime.handlers.agent_turn_cancel({ session_id: session.id });
    await runtime.shutdown();
  }

  for (const failure of ['adjunto', 'proveedor', 'menciones', 'admisión']) {
    const { bridge, state } = makeBridge();
    let rejectCorrection = false;
    let sawCorrection = false;
    const faux = await openFaux([
      fauxAssistantMessage([fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      (context) => {
        sawCorrection = JSON.stringify(context.messages).includes('no borres');
        return fauxAssistantMessage('corregido');
      },
    ], async (method, params) => {
      if (rejectCorrection && ((failure === 'proveedor' && method === 'agent_internal_provider')
        || (failure === 'menciones' && method === 'agent_internal_mentions'))) throw new Error(failure);
      return bridge(method, params);
    });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'limpia' });
    assert(await waitFor(() => state.approvals.size > 0), `${failure}: el turno espera aprobación`);
    const harness = runtime._internal.state().harness;
    const getConversation = harness.conversation.bind(harness);
    harness.conversation = async (...args) => {
      const conv = await getConversation(...args);
      if (rejectCorrection && failure === 'admisión') conv.submit = async () => { throw new Error('admisión'); };
      return conv;
    };
    rejectCorrection = true;
    if (failure === 'proveedor') runtime._internal._providerOverrides.delete('faux');
    let rejected;
    try {
      await runtime.handlers.agent_message_send({
        session_id: session.id, content: 'no borres', request_id: 'correction-retry', correction: true,
        ...(failure === 'adjunto' ? { attachments: ['caducado'] } : {}),
      });
    } catch (err) { rejected = err; }
    assert(!!rejected, `${failure}: se informa del rechazo de la corrección`);
    assert([...state.approvals.values()][0].status === 'pending', `${failure}: la aprobación anterior sigue pendiente`);
    const beforeRetry = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(!sawCorrection && !beforeRetry.messages.some((m) => m.role === 'user' && m.content === 'no borres'),
      `${failure}: la corrección rechazada no se presenta como recibida`);
    rejectCorrection = false;
    runtime._internal._providerOverrides.set('faux', faux.provider);
    const retried = await runtime.handlers.agent_message_send({
      session_id: session.id, content: 'no borres', request_id: 'correction-retry', correction: true,
    });
    assert(retried.accepted && !retried.duplicate, `${failure}: se admite el reintento con la misma identidad`);
    assert(await waitIdle(session.id) && sawCorrection, `${failure}: el modelo recibe la corrección al reintentar`);
    assert([...state.approvals.values()][0].status === 'denied' && state.dispatchLog.length === 0,
      `${failure}: la corrección admitida rechaza el efecto pendiente sin ejecutarlo`);
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
    const hits = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        hits.push(JSON.parse(body));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
        res.write(chunk({ role: 'assistant' }));
        res.write(chunk({ reasoning_content: 'Pienso ' }));
        await sleep(200);
        res.write(chunk({ reasoning_content: 'la respuesta' }));
        await sleep(300);
        res.write(chunk({ content: 'Listo' }));
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { bridge } = makeBridge();
    const wiredBridge = async (method, params) => method === 'agent_internal_provider'
      ? { provider: 'openai', style: 'openai_chat', base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'sk-wire', auth_type: 'api_key', extra_headers: {}, default_model: 'deepseek-r1-mock' }
      : bridge(method, params);
    const { MemoryStorage } = await import('@earendil-works/pi-durable');
    await runtime.open({ storage: new MemoryStorage(), bridge: wiredBridge, skipImport: true });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'openai', model: 'deepseek-r1-mock' });
    await runtime.handlers.agent_messages_list({ session_id: session.id });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'piensa' });
    assert(await waitFor(async () => {
      const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
      return listed.messages.some((m) => m.partial && m.reasoning === 'Pienso la respuesta' && !m.content);
    }, 5000), 'el razonamiento llega en vivo antes de la respuesta');
    assert(await waitIdle(session.id), 'el turno con razonamiento en streaming termina');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const answer = messages.at(-1);
    assert(answer.content === 'Listo' && answer.reasoning === 'Pienso la respuesta' && !answer.partial, 'la respuesta final conserva el razonamiento');
    assert(typeof answer.reasoning_ms === 'number' && answer.reasoning_ms >= 150, 'el razonamiento lleva el tiempo que tardó el modelo');
    assert(hits[0].reasoning_effort === 'low', 'los modelos de razonamiento conocidos piden esfuerzo bajo');
    await runtime.handlers.agent_session_reasoning_set({ id: session.id, reasoning_effort: 'high' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'piensa más' });
    assert(await waitIdle(session.id), 'el turno con más razonamiento termina');
    assert(hits[1].reasoning_effort === 'high', 'el nivel elegido viaja en la petición al proveedor');
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

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: {} };
    const bigBridge = async (method, params) => {
      if (method !== 'agent_internal_tools') return bridge(method, params);
      const result = await bridge(method, params);
      for (let i = 0; i < 70; i += 1) {
        result.tools.push({ name: `formatos_t${i}`, module: 'formatos', description: `Formatos PDF ${i}`, gated: false, kind: 'backend', inputSchema: schema });
        result.tools.push({ name: `sellador_t${i}`, module: 'sellador', description: `Sellar ${i}`, gated: false, kind: 'backend', inputSchema: schema });
      }
      result.tools.push({ name: 'fs_read', module: 'computer', description: 'Leer archivo', gated: false, kind: 'backend', inputSchema: schema });
      return result;
    };
    const { getCurrentTools } = await import('@earendil-works/pi-ai/utils/transcript');
    const offered = [];
    await openFaux([
      (context) => {
        offered.push(getCurrentTools(context.messages).map((tool) => tool.name));
        return fauxAssistantMessage([fauxToolCall('tools_load', { modules: ['formatos'] })], { stopReason: 'toolUse' });
      },
      (context) => {
        offered.push(getCurrentTools(context.messages).map((tool) => tool.name));
        return fauxAssistantMessage('formatos listos');
      },
      fauxAssistantMessage('sellador listo'),
    ], bigBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const enabledNames = async () => (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools
      .filter((t) => t.enabled).map((t) => t.name);
    const initial = await enabledNames();
    assert(initial.includes('fs_read') && initial.includes('tools_load') && initial.length < 60,
      'un catálogo grande empieza con el núcleo y tools_load');
    assert(!initial.some((name) => name.startsWith('formatos_') || name.startsWith('sellador_')), 'los módulos grandes no se envían de entrada');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'necesito formatos' });
    assert(await waitIdle(session.id), 'el turno con tools_load termina');
    const loaded = await enabledNames();
    assert(loaded.filter((name) => name.startsWith('formatos_')).length === 25 && !loaded.some((name) => name.startsWith('sellador_')),
      'tools_load habilita las herramientas del módulo pedido, con tope por llamada');
    assert(offered.length === 2 && !offered[0].includes('formatos_t0') && offered[1].includes('formatos_t0'),
      'el modelo recibe el núcleo y, en la ronda siguiente, las herramientas cargadas');
    assert(offered[0].length < 60, 'la primera petición no envía el catálogo completo');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'usa @sellador' });
    assert(await waitIdle(session.id), 'el turno con mención termina');
    assert((await enabledNames()).filter((name) => name.startsWith('sellador_')).length === 70, 'mencionar un módulo carga sus herramientas');
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: null });
    assert(JSON.stringify(await enabledNames()) === JSON.stringify(initial), 'restablecer vuelve al núcleo');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    const schema = { type: 'object', properties: {} };
    const bigBridge = async (method, params) => {
      if (method !== 'agent_internal_tools') return bridge(method, params);
      const result = await bridge(method, params);
      for (let i = 0; i < 3; i += 1) {
        result.tools.push({ name: `formatos_t${i}`, module: 'formatos', description: `Formatos PDF ${i}`, gated: false, kind: 'backend', inputSchema: schema });
        result.tools.push({ name: `sellador_t${i}`, module: 'sellador', description: `Sellar ${i}`, gated: false, kind: 'backend', inputSchema: schema });
      }
      result.tools.push({ name: 'fs_read', module: 'computer', description: 'Leer archivo', gated: false, kind: 'backend', inputSchema: schema });
      return result;
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('tools_load', { modules: ['formatos', 'sellador'] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('módulos revisados'),
      fauxAssistantMessage('sellador revisado'),
      fauxAssistantMessage([fauxToolCall('fs_read', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('lectura bloqueada'),
    ], bigBridge);
    const tools = ['fs_read', 'tools_load', 'formatos_t0'];
    const { profile } = await runtime.handlers.agent_profile_save({ name: 'Lector', instructions: 'Solo lee', tools });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: profile.id });
    const enabledNames = async () => (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools
      .filter((t) => t.enabled).map((t) => t.name).sort();
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'necesito formatos y sellos' });
    assert(await waitIdle(session.id), 'el turno con tools_load del bot termina');
    assert(JSON.stringify(await enabledNames()) === JSON.stringify([...tools].sort()), 'tools_load no amplía las herramientas del bot');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'usa @sellador' });
    assert(await waitIdle(session.id), 'el turno con mención del bot termina');
    assert(!(await enabledNames()).some((name) => name.startsWith('sellador_')), 'mencionar un módulo no amplía las herramientas del bot');
    let error;
    try { await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['sellador_t0'] }); } catch (err) { error = err; }
    assert(!!error, 'la selección manual no supera la lista del bot');
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: null });
    assert(JSON.stringify(await enabledNames()) === JSON.stringify([...tools].sort()), 'restablecer vuelve a las herramientas del bot');
    await runtime.handlers.agent_profile_save({ ...profile, tools: ['tools_load', 'formatos_t0'] });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'lee el archivo' });
    assert(await waitIdle(session.id), 'el turno con una herramienta retirada del bot termina');
    assert(state.dispatchLog.length === 0, 'una herramienta retirada del bot no se ejecuta aunque siga en la conversación');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    const schema = { type: 'object', properties: {} };
    const bigBridge = async (method, params) => {
      if (method !== 'agent_internal_tools') return bridge(method, params);
      const result = await bridge(method, params);
      for (let i = 0; i < 3; i += 1) {
        result.tools.push({ name: `sellador_t${i}`, module: 'sellador', description: `Sellar ${i}`, gated: false, kind: 'backend', inputSchema: schema });
      }
      result.tools.push({ name: 'fs_read', module: 'computer', description: 'Leer archivo', gated: false, kind: 'backend', inputSchema: schema });
      return result;
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('tools_load', { modules: ['sellador'] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('sellador revisado'),
      fauxAssistantMessage([fauxToolCall('fs_read', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('lectura bloqueada'),
    ], bigBridge);
    for (const toolsDeny of [['desconocida'], 'fs_read', [false]]) {
      let error;
      try { await runtime.handlers.agent_profile_save({ name: 'Inválido', instructions: 'x', tools: null, tools_deny: toolsDeny }); } catch (err) { error = err; }
      assert(!!error, 'una lista de bloqueadas inválida se rechaza');
    }
    const open = (await runtime.handlers.agent_profile_save({ name: 'Abierto', instructions: 'Todo menos sellar', tools: null, tools_deny: ['sellador_t0'] })).profile;
    assert(JSON.stringify(open.tools_deny) === '["sellador_t0"]', 'el bot guarda sus herramientas bloqueadas');
    const kept = (await runtime.handlers.agent_profile_save({ id: open.id, name: 'Abierto', instructions: 'Todo menos sellar', tools: null })).profile;
    assert(JSON.stringify(kept.tools_deny) === '["sellador_t0"]', 'editar sin indicar bloqueadas las conserva');
    const { session: openSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: open.id });
    const { session: plainSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const enabledIn = async (id) => (await runtime.handlers.agent_tools_list({ session_id: id })).tools.filter((t) => t.enabled).map((t) => t.name);
    assert(JSON.stringify(await enabledIn(openSession.id)) === JSON.stringify((await enabledIn(plainSession.id)).filter((name) => name !== 'sellador_t0')),
      'un bot con todas las herramientas arranca como una conversación normal sin las bloqueadas');
    const tools = ['fs_read', 'tools_load', 'sellador_t0', 'sellador_t1'];
    const { profile } = await runtime.handlers.agent_profile_save({ name: 'Sellos', instructions: 'Sella', tools, tools_deny: ['sellador_t0'] });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: profile.id });
    const enabledNames = async () => (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools
      .filter((t) => t.enabled).map((t) => t.name).sort();
    const expected = JSON.stringify(['fs_read', 'sellador_t1', 'tools_load']);
    assert(JSON.stringify(await enabledNames()) === expected, 'la bloqueada gana aunque figure en la lista permitida');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'sella' });
    assert(await waitIdle(session.id), 'el turno con tools_load y bloqueadas termina');
    assert(JSON.stringify(await enabledNames()) === expected, 'tools_load no carga una herramienta bloqueada');
    let error;
    try { await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['sellador_t0'] }); } catch (err) { error = err; }
    assert(!!error, 'la selección manual no habilita una herramienta bloqueada');
    await runtime.handlers.agent_profile_save({ ...profile, tools_deny: ['sellador_t0', 'fs_read'] });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'lee el archivo' });
    assert(await waitIdle(session.id), 'el turno con una herramienta recién bloqueada termina');
    assert(state.dispatchLog.length === 0, 'una herramienta recién bloqueada no se ejecuta aunque siga en la conversación');
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: null });
    assert(JSON.stringify(await enabledNames()) === JSON.stringify(['sellador_t1', 'tools_load']), 'restablecer excluye las bloqueadas');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    const schema = { type: 'object', properties: {} };
    const scopes = [];
    const memoryBridge = async (method, params) => {
      if (method === 'agent_internal_memory_context') scopes.push(params.memory_scope);
      if (method !== 'agent_internal_tools') return bridge(method, params);
      const result = await bridge(method, params);
      for (const name of ['memory_search', 'memory_remember', 'procedure_learn']) {
        result.tools.push({ name, module: 'agent', description: `Memoria ${name}`, gated: name !== 'memory_search', kind: 'backend', inputSchema: schema });
      }
      return result;
    };
    await openFaux([
      fauxAssistantMessage('con memoria propia'),
      fauxAssistantMessage([fauxToolCall('memory_search', { query: 'formato' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('sin memoria'),
    ], memoryBridge);
    let error;
    try { await runtime.handlers.agent_profile_save({ name: 'Inválido', instructions: 'x', tools: null, memory_scope: 'all' }); } catch (err) { error = err; }
    assert(!!error, 'un alcance de memoria desconocido se rechaza');
    const shared = (await runtime.handlers.agent_profile_save({ name: 'Compartido', instructions: 'x', tools: null })).profile;
    assert(!('memory_scope' in shared), 'el alcance por defecto no cambia la ficha guardada');
    const own = (await runtime.handlers.agent_profile_save({ name: 'Propio', instructions: 'x', tools: null, memory_scope: 'own' })).profile;
    assert(own.memory_scope === 'own', 'el bot guarda su alcance de memoria');
    const kept = (await runtime.handlers.agent_profile_save({ id: own.id, name: 'Propio', instructions: 'y', tools: null })).profile;
    assert(kept.memory_scope === 'own', 'editar sin indicar el alcance lo conserva');
    const { session: ownSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: own.id });
    await runtime.handlers.agent_message_send({ session_id: ownSession.id, content: 'hola' });
    assert(await waitIdle(ownSession.id), 'el turno con memoria propia termina');
    assert(scopes.at(-1) === 'own', 'la consulta de memoria recibe el alcance del bot');
    const none = (await runtime.handlers.agent_profile_save({ name: 'Sin memoria', instructions: 'x', tools: null, memory_scope: 'none' })).profile;
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: none.id });
    const enabled = (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools.filter((t) => t.enabled).map((t) => t.name);
    const { session: plain } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const plainEnabled = (await runtime.handlers.agent_tools_list({ session_id: plain.id })).tools.filter((t) => t.enabled).map((t) => t.name);
    const memoryTools = ['memory_search', 'memory_remember', 'procedure_learn'];
    assert(plainEnabled.includes('memory_search')
      && JSON.stringify(enabled) === JSON.stringify(plainEnabled.filter((name) => !memoryTools.includes(name))),
      'un bot sin memoria arranca como una conversación normal sin sus herramientas');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'busca en memoria' });
    assert(await waitIdle(session.id), 'el turno sin memoria termina');
    assert(scopes.at(-1) === 'none' && state.dispatchLog.length === 0, 'un bot sin memoria no consulta recuerdos');
    let blocked;
    try { await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['memory_search'] }); } catch (err) { blocked = err; }
    assert(!!blocked, 'la selección manual no devuelve la memoria a un bot sin memoria');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage('primer turno'),
      fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('no debería llegar'),
    ], bridge);
    for (const dailyTokens of [10, 1500.5, '2000', 200_000_000]) {
      let error;
      try { await runtime.handlers.agent_profile_save({ name: 'Inválido', instructions: 'x', tools: null, daily_tokens: dailyTokens }); } catch (err) { error = err; }
      assert(!!error, `un presupuesto diario inválido se rechaza: ${dailyTokens}`);
    }
    const internal = runtime._internal.state();
    const setUsage = (id, day, tokens) => internal.harness.commit(async (tx) => {
      const doc = await tx.doc(internal.ProfilesDoc);
      doc.usage = { ...(doc.usage || {}), [id]: { day, tokens } };
    }, internal.ctx);
    const today = require('../electron/agent-execution').localDay();
    const { profile } = await runtime.handlers.agent_profile_save({ name: 'Ahorrador', instructions: 'Gasta poco', tools: null, daily_tokens: 50_000 });
    assert(profile.daily_tokens === 50_000, 'el bot guarda su presupuesto diario');
    const kept = (await runtime.handlers.agent_profile_save({ id: profile.id, name: 'Ahorrador', instructions: 'Gasta poco', tools: null })).profile;
    assert(kept.daily_tokens === 50_000, 'editar sin indicar presupuesto lo conserva');
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: profile.id });
    await setUsage(profile.id, '2000-01-01', 10_000_000);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'hola' });
    assert(await waitIdle(session.id), 'el consumo de otro día no bloquea el turno');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(listed.token_budget && listed.token_budget.limit === 50_000 && listed.token_budget.used > 0 && listed.token_budget.used < 50_000,
      'cada respuesta suma su consumo al día actual del bot');
    await setUsage(profile.id, today, 49_999);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'lista los documentos' });
    assert(await waitIdle(session.id), 'el turno que agota el presupuesto se detiene');
    const paused = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(paused.resumable && paused.messages.some((message) => /presupuesto diario de tokens/.test(message.content || '')),
      'agotar el presupuesto a mitad de turno deja un punto reanudable');
    assert(!paused.messages.some((message) => message.content === 'no debería llegar'), 'sin presupuesto no se pide otra respuesta');
    let error;
    try { await runtime.handlers.agent_message_send({ session_id: session.id, content: 'sigue' }); } catch (err) { error = err; }
    assert(error && /presupuesto diario/.test(error.message), 'un bot sin presupuesto no admite turnos nuevos ni reanudar');
    const plain = (await runtime.handlers.agent_profile_save({ name: 'Libre', instructions: 'x', tools: null })).profile;
    assert(!('daily_tokens' in plain), 'sin presupuesto la ficha no cambia');
    await runtime.handlers.agent_profile_delete({ id: profile.id });
    const usage = (await internal.harness.snapshot(internal.ProfilesDoc, internal.ctx)).usage || {};
    assert(!(profile.id in usage), 'borrar el bot elimina su consumo');
    assert(state.dispatchLog.length <= 1, 'el turno pausado no repite herramientas');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const requests = [];
    const delegatedBridge = async (method, params) => {
      if (method === 'agent_internal_profile_usage') return { tokens: requests.length * 11 };
      if (method === 'agent_internal_dispatch' && params.name === 'subagent_run') {
        requests.push(params);
        return { result: JSON.stringify({ status: 'done', text: 'Revisión', usage: { input: 8, output: 3 } }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('subagent_run', { agent: 'Ahorrador delegado', task: 'Revisa' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Revisado'),
      fauxAssistantMessage([fauxToolCall('subagent_run', { agent: 'Ahorrador delegado', task: 'Repite' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Sin presupuesto'),
    ], delegatedBridge);
    const { profile } = await runtime.handlers.agent_profile_save({ name: 'Ahorrador delegado', instructions: 'Revisa',
      tools: null, daily_tokens: 1000, memory_scope: 'own' });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const { session: target } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: profile.id });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Delega la revisión' });
    assert(await waitIdle(session.id), 'la delegación con presupuesto termina');
    const listed = await runtime.handlers.agent_messages_list({ session_id: target.id });
    assert(listed.token_budget.used === 11, 'los tokens de subagent_run se cargan al agente destinatario');
    assert(requests[0].context.subagent.memory_scope === 'own'
      && requests[0].context.subagent.remaining_tokens === 1000, 'la delegación recibe el alcance y saldo del destinatario');
    const internal = runtime._internal.state();
    await internal.harness.commit(async (tx) => {
      const doc = await tx.doc(internal.ProfilesDoc);
      doc.usage ||= {};
      doc.usage[profile.id] = { day: require('../electron/agent-execution').localDay(), tokens: 1000 };
    }, internal.ctx);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Delega de nuevo' });
    assert(await waitIdle(session.id), 'la delegación agotada termina sin llamar al subagente');
    assert(requests.length === 1, 'un destinatario sin presupuesto no llega al backend');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage([fauxToolCall('db_clear', { turno: 1 }, { id: 'call_0' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('primero'),
      fauxAssistantMessage([fauxToolCall('db_clear', { turno: 2 }, { id: 'call_0' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('segundo'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    for (const turn of [1, 2]) {
      await runtime.handlers.agent_message_send({ session_id: session.id, content: `turno ${turn}` });
      assert(await waitFor(async () => (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals.length === 1),
        `el turno ${turn} pide su propia aprobación aunque el proveedor repita el id`);
      const [pending] = (await runtime.handlers.agent_messages_list({ session_id: session.id })).pending_approvals;
      assert(pending.params.turno === turn, `la aprobación del turno ${turn} lleva sus propios parámetros`);
      await runtime.handlers.agent_approve({ approval_id: pending.id });
      assert(await waitIdle(session.id), `el turno ${turn} termina`);
    }
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const repeated = listed.messages.flatMap((m) => m.tool_calls || []).filter((c) => c.id === 'call_0');
    assert(repeated.length === 2 && repeated.every((c) => c.status === 'done'), 'cada llamada repetida conserva su propio resultado');
    assert(new Set(state.dispatchLog.filter((id) => id.startsWith('call_0@task:'))).size === 2, 'cada turno ejecuta su llamada sin reutilizar la anterior');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-shots-'));
    const previousAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = appData;
    const shot = path.join(appData, 'Antares', 'ai-agent', 'drafts', 's1.screens', 'shot.jpg');
    const outside = path.join(appData, 'fuera.jpg');
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    fs.writeFileSync(shot, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    fs.writeFileSync(outside, Buffer.from([0xff, 0xd8]));
    const schema = { type: 'object', properties: {} };
    const computerBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'task_plan', gated: false, kind: 'backend', module: 'computer', inputSchema: schema },
          { name: 'desktop_peek', gated: false, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'desktop_peek') {
        return { result: JSON.stringify({ observation: { image: { path: params.params.outside ? outside : shot, mime: 'image/jpeg' } } }) };
      }
      if (method === 'agent_internal_dispatch' && params.name === 'task_plan') return { result: JSON.stringify({ recorded: true }) };
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('task_plan', { goal: 'Informe semanal', steps: [
        { title: 'Leer datos', status: 'done', evidence: 'fs_read devolvió 12 filas' },
        { title: 'Escribir informe', status: 'in_progress' },
      ] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('desktop_peek', {}), fauxToolCall('desktop_peek', { outside: true })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Sigo después'),
    ], computerBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'prepara el informe' });
    assert(await waitIdle(session.id), 'el turno con plan y capturas termina');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert(listed.plan && listed.plan.goal === 'Informe semanal' && listed.plan.steps.length === 2, 'la UI recibe el último plan publicado');
    assert(listed.plan.steps[0].evidence === 'fs_read devolvió 12 filas', 'el plan conserva la evidencia de cada paso');
    assert(listed.resumable === true && listed.running === false, 'un plan con pasos abiertos ofrece reanudar');
    const context = runtime._internal.shared.deps.chord.BACKGROUND_CONTEXT;
    const map = await runtime._internal.state().harness.snapshot(runtime._internal.state().SessionsDoc, context);
    const conv = await runtime._internal.state().harness.conversation(map.sessions[session.id].conversationId, context);
    const results = (await require('../electron/agent-projection').allEntries(conv))
      .filter((entry) => entry.kind === 'pi.tool-result' && entry.model[0].toolName === 'desktop_peek')
      .map((entry) => entry.model[0].content.filter((block) => block.type === 'image'));
    assert(results.length === 2, 'las dos observaciones quedan en el registro durable');
    assert(results.filter((images) => images.length === 1 && images[0].data === fs.readFileSync(shot).toString('base64')).length === 1,
      'la captura de los borradores del agente llega al modelo como imagen');
    assert(results.filter((images) => images.length === 0).length === 1, 'una imagen fuera de los borradores del agente no se adjunta');
    assert(!listed.messages.some((m) => (m.tool_calls || []).some((call) => String(call.result || '').includes('base64'))),
      'la UI no recibe los bytes de la captura');
    const { fauxProvider } = await import('@earendil-works/pi-ai');
    const textOnly = fauxProvider({ provider: 'texto', models: [{ id: 'solo-texto', input: ['text'] }] });
    runtime._internal._providerOverrides.set('texto', textOnly.provider);
    textOnly.setResponses([fauxAssistantMessage([fauxToolCall('desktop_peek', {})], { stopReason: 'toolUse' }), fauxAssistantMessage('visto')]);
    const { session: plain } = await runtime.handlers.agent_session_create({ provider: 'texto', model: 'solo-texto' });
    await runtime.handlers.agent_message_send({ session_id: plain.id, content: 'mira la pantalla' });
    assert(await waitIdle(plain.id), 'el turno del modelo sin visión termina');
    const plainMap = await runtime._internal.state().harness.snapshot(runtime._internal.state().SessionsDoc, context);
    const plainConv = await runtime._internal.state().harness.conversation(plainMap.sessions[plain.id].conversationId, context);
    const [plainResult] = (await require('../electron/agent-projection').allEntries(plainConv))
      .filter((entry) => entry.kind === 'pi.tool-result').map((entry) => entry.model[0].content);
    assert(plainResult.every((block) => block.type === 'text') && JSON.parse(plainResult[0].text).observation,
      'a un modelo sin visión no se le adjunta la captura y el resultado sigue siendo JSON');
    await runtime.shutdown();
    process.env.LOCALAPPDATA = previousAppData;
    fs.rmSync(appData, { recursive: true, force: true });
  }

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: {} };
    let probes = 0;
    const loopBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'task_plan', gated: false, kind: 'backend', module: 'computer', inputSchema: schema },
          { name: 'page_probe', gated: false, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'page_probe') {
        probes += 1;
        return { result: JSON.stringify({ error: 'sin cambios' }) };
      }
      if (method === 'agent_internal_dispatch' && params.name === 'task_plan') {
        const remaining = params.params.steps.filter((step) => step.status !== 'done' && step.status !== 'failed').map((step) => step.title);
        return { result: JSON.stringify({ recorded: true, remaining }) };
      }
      return bridge(method, params);
    };
    const faux = await openFaux([
      fauxAssistantMessage([fauxToolCall('task_plan', { goal: 'Publicar', steps: [{ title: 'Subir el archivo', status: 'in_progress' }] })], { stopReason: 'toolUse' }),
      ...[1, 2, 3, 4].map(() => fauxAssistantMessage([fauxToolCall('page_probe', { url: 'https://example.com' })], { stopReason: 'toolUse' })),
      fauxAssistantMessage('Listo, ya está publicado.'),
      fauxAssistantMessage([fauxToolCall('task_plan', { goal: 'Publicar', steps: [{ title: 'Subir el archivo', status: 'failed' }] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('No pude subirlo: la página no cambia. Necesito que inicies sesión.'),
    ], loopBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const notices = [];
    runtime._internal.shared.notify = (method, params) => notices.push([method, params.session_id]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'publica el archivo' });
    assert(await waitIdle(session.id), 'el turno con bucle y comprobación termina');
    assert(await waitFor(async () => notices.some(([method, id]) => method === 'agent.changed' && id === session.id)),
      'el motor avisa a la UI de los cambios de la conversación');
    runtime._internal.shared.notify = null;
    assert(probes === 3, 'la cuarta llamada idéntica se bloquea sin ejecutarse');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const blocked = listed.messages.flatMap((m) => m.tool_calls || []).filter((c) => c.name === 'page_probe');
    assert(blocked.length === 4 && /Ya llamaste a page_probe 3 veces/.test(String(blocked[3].result || '')),
      'el agente recibe por qué se bloqueó la repetición');
    const texts = listed.messages.filter((m) => m.role === 'assistant').map((m) => m.content);
    assert(texts.includes('Listo, ya está publicado.') && texts.at(-1).startsWith('No pude subirlo'),
      'una respuesta final con pasos sin verificar continúa hasta declarar el resultado real');
    assert(!listed.messages.some((m) => m.role === 'user' && String(m.content).includes('Comprobación de Antares')),
      'la petición interna de comprobación no aparece como mensaje del usuario');
    assert(listed.messages.filter((m) => m.role === 'user').length === 1, 'el chat solo muestra el mensaje del usuario');
    assert(faux.getPendingResponseCount() === 0, 'la comprobación se pide una sola vez');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: {} };
    let probes = 0;
    const retryBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'busy_probe', gated: false, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'busy_probe') {
        probes += 1;
        return { result: JSON.stringify(probes <= 3
          ? { error: 'ocupado', code: 'USER_BUSY', retryable: true, retry_after_ms: 1200 }
          : { ok: true }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      ...[1, 2, 3, 4].map(() => fauxAssistantMessage([fauxToolCall('busy_probe', {})], { stopReason: 'toolUse' })),
      fauxAssistantMessage('Listo'),
    ], retryBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'insiste' });
    assert(await waitIdle(session.id), 'el turno con fallos retryable termina');
    assert(probes === 4, 'un error retryable no consume el freno de repeticiones');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: {} };
    let probes = 0;
    const changingBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'changing_probe', gated: false, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'changing_probe') {
        probes += 1;
        return { result: JSON.stringify({ value: probes }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      ...[1, 2, 3, 4].map(() => fauxAssistantMessage([fauxToolCall('changing_probe', {})], { stopReason: 'toolUse' })),
      fauxAssistantMessage('Listo'),
    ], changingBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'avanza' });
    assert(await waitIdle(session.id), 'el turno con resultados cambiantes termina');
    assert(probes === 4, 'un resultado distinto no se bloquea como repetición');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: {} };
    let probes = 0;
    const gatedBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'gated_probe', gated: true, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'gated_probe') {
        probes += 1;
        return { result: JSON.stringify(probes <= 3
          ? { error: 'ocupado', code: 'USER_BUSY', retryable: true, recoverable: true, retry_after_ms: 900 }
          : { value: probes }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      ...[1, 2, 3, 4].map(() => fauxAssistantMessage([fauxToolCall('gated_probe', {})], { stopReason: 'toolUse' })),
      fauxAssistantMessage('Listo'),
    ], gatedBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'avanza con efecto' });
    assert(await waitIdle(session.id), 'el turno con efecto gated termina');
    assert(probes === 4, 'una acción gated con errores recuperables no se bloquea');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] };
    let probes = 0;
    let mode = 'changing';
    const clickBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'web_click', gated: true, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'web_click') {
        probes += 1;
        const url = mode === 'changing' ? `https://example.com/${probes}` : 'https://example.com/same';
        return { result: JSON.stringify({ clicked: '1', page: { url, title: '', text: '', elements: [] } }) };
      }
      return bridge(method, params);
    };
    const previousNative = runtime._internal.shared.nativeTools;
    runtime._internal.shared.nativeTools = { nativeToolSpecs: () => [] };
    try {
      await openFaux([
        ...[1, 2, 3, 4].map(() => fauxAssistantMessage([fauxToolCall('web_click', { ref: '1' })], { stopReason: 'toolUse' })),
        fauxAssistantMessage('Listo'),
        ...[1, 2, 3, 4].map(() => fauxAssistantMessage([fauxToolCall('web_click', { ref: '1' })], { stopReason: 'toolUse' })),
        fauxAssistantMessage('Listo'),
      ], clickBridge);
      const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
      await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' });
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'avanza' });
      assert(await waitIdle(session.id), 'el turno con clics que avanzan termina');
      assert(probes === 4, 'un clic que cambia de página no se bloquea');
      let listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
      let calls = listed.messages.flatMap((m) => m.tool_calls || []).filter((c) => c.name === 'web_click');
      assert(calls.length === 4 && calls.every((c) => c.status === 'done'), 'los cuatro clics de avance se ejecutan');

      mode = 'same';
      probes = 0;
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'repite' });
      assert(await waitIdle(session.id), 'el turno con clics en la misma página termina');
      assert(probes === 3, 'repetir en la misma página conserva el límite');
      listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
      calls = listed.messages.flatMap((m) => m.tool_calls || []).filter((c) => c.name === 'web_click');
      assert(/sin cambiar de página/.test(String(calls.at(-1).result || '')), 'el bloqueo explica que no hubo avance de página');
      await runtime.shutdown();
    } finally {
      runtime._internal.shared.nativeTools = previousNative;
    }
  }

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: {} };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const correctionBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'slow_correction_probe', gated: false, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'slow_correction_probe') {
        await gate;
        return { result: JSON.stringify({ ok: true }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('slow_correction_probe', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
      fauxAssistantMessage('corregido'),
    ], correctionBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'hazlo despacio' });
    assert(await waitFor(async () => (await runtime.handlers.agent_turn_status({ session_id: session.id })).running),
      'el turno lento sigue en curso');
    const { shared, requireSession } = require('../electron/agent-shared');
    const conversationId = (await requireSession(session.id)).conversationId;
    shared.turns.set(conversationId, {
      calls: new Map([['slow_correction_probe:{}', { count: 3, outcome: 'x', exempt: false }]]),
      remaining: null,
      checked: false,
    });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'reintenta', correction: true });
    assert(!shared.turns.get(conversationId)?.calls.size, 'una corrección reinicia el freno de repeticiones');
    release();
    assert(await waitIdle(session.id), 'el turno corregido termina');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: {} };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slowBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'slow_probe', gated: false, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'slow_probe') {
        await gate;
        return { result: JSON.stringify({ ok: true }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('slow_probe', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
    ], slowBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'prueba lenta' });
    const statusOf = async () => {
      const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
      const call = listed.messages.flatMap((m) => m.tool_calls || []).find((c) => c.name === 'slow_probe');
      return call && call.status;
    };
    assert(await waitFor(async () => (await statusOf()) === 'running'), 'una herramienta en ejecución se muestra en curso');
    assert((await statusOf()) !== 'interrupted', 'una herramienta en ejecución nunca aparece como interrumpida');
    release();
    assert(await waitIdle(session.id), 'el turno lento termina');
    assert((await statusOf()) === 'done', 'al terminar la herramienta pasa a hecha');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: {} };
    let progress = '';
    let finished = false;
    const streamBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'stream_probe', gated: false, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'stream_probe') return { result: null, dispatch: { op_id: 'op-stream' } };
      if (method === 'agent_internal_dispatch_result') {
        return finished
          ? { result: JSON.stringify({ exit_code: 0, stdout: progress }) }
          : { result: null, ...(progress ? { output: progress } : {}) };
      }
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('stream_probe', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
    ], streamBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'prueba con salida' });
    const callOf = async () => {
      const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
      return listed.messages.flatMap((m) => m.tool_calls || []).find((c) => c.name === 'stream_probe');
    };
    progress = 'uno\n';
    assert(await waitFor(async () => ((await callOf()) || {}).output === 'uno\n'), 'la salida en curso llega a la llamada mientras corre');
    progress = 'uno\ndos\n';
    assert(await waitFor(async () => ((await callOf()) || {}).output === 'uno\ndos\n'), 'la salida en curso crece sin repetir lo ya mostrado');
    assert((await callOf()).status === 'running', 'con salida parcial la herramienta sigue en curso');
    assert(Math.abs(Date.now() - (await callOf()).started_at) < 30_000, 'una herramienta en curso informa cuándo empezó');
    finished = true;
    assert(await waitIdle(session.id), 'el turno con salida en vivo termina');
    const done = await callOf();
    assert(done.status === 'done' && done.output === undefined && done.started_at === undefined && JSON.parse(done.result).stdout === 'uno\ndos\n',
      'al terminar se muestra el resultado y no la salida parcial');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    const schema = { type: 'object', properties: {} };
    const stopBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        result.tools.push({ name: 'stop_probe', gated: false, kind: 'backend', module: 'computer', inputSchema: schema });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === 'stop_probe') return { result: null, dispatch: { op_id: 'op-stop' } };
      if (method === 'agent_internal_dispatch_result') return { result: null, output: 'paso 1\npaso 2\n' };
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('stop_probe', {})], { stopReason: 'toolUse' }),
    ], stopBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'prueba que se detiene' });
    const callOf = async () => {
      const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
      return listed.messages.flatMap((m) => m.tool_calls || []).find((c) => c.name === 'stop_probe');
    };
    assert(await waitFor(async () => ((await callOf()) || {}).output === 'paso 1\npaso 2\n'), 'la salida parcial se ve antes de detener');
    await runtime.handlers.agent_turn_cancel({ session_id: session.id });
    assert(await waitIdle(session.id), 'el turno detenido termina');
    const stopped = await callOf();
    assert(stopped.status === 'interrupted', 'una herramienta detenida a medias aparece interrumpida, no fallida');
    assert(stopped.result.trimEnd() === 'paso 1\npaso 2','tras detener se conserva la salida parcial sin los avisos internos del motor');
    await runtime.shutdown();
  }

  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage([fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('hecho'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'espera mi aprobación' });
    assert(await waitFor(() => state.approvals.size === 1), 'la aprobación queda pendiente');
    await sleep(3100);
    const [approval] = state.approvals.values();
    const waiters = runtime._internal.shared.decisionWaiters.get(approval.id);
    assert(waiters && waiters.size === 1, 'una aprobación larga conserva una sola espera activa');
    await runtime.handlers.agent_approve({ approval_id: approval.id });
    assert(await waitIdle(session.id), 'la aprobación larga termina tras la decisión');
    assert(!runtime._internal.shared.decisionWaiters.has(approval.id), 'la decisión libera su espera y su listener');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    let started = false;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const cancellations = [];
    const delayedBridge = async (method, params) => {
      if (method === 'agent_internal_dispatch' && params.name === 'canvas_list') {
        started = true;
        await gate;
        return { result: null };
      }
      if (method === 'agent_internal_dispatch_cancel') cancellations.push(params);
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' }),
    ], delayedBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'consulta y detén' });
    assert(await waitFor(() => started), 'la llamada está esperando la reserva del backend');
    const cancelled = runtime.handlers.agent_turn_cancel({ session_id: session.id });
    await sleep(100);
    release();
    await cancelled;
    assert(await waitIdle(session.id), 'cancelar durante la reserva termina el turno');
    assert(cancellations.length === 1 && cancellations[0].session_id === session.id,
      'cancelar durante la reserva también detiene la operación del backend');
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    await openFaux([
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Proveedor temporalmente no disponible' }),
      fauxAssistantMessage('Recuperado'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'primer intento' });
    assert(await waitFor(async () => (await runtime.handlers.agent_turn_status({ session_id: session.id })).last_error),
      'el primer fallo queda visible');
    assert(await waitIdle(session.id), 'el intento fallido termina');
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'reintenta' });
    assert(await waitIdle(session.id), 'el reintento correcto termina');
    assert((await runtime.handlers.agent_turn_status({ session_id: session.id })).last_error === null,
      'una respuesta correcta limpia el error anterior');
    assert((await runtime.activitySnapshot()).find((item) => item.id === session.id).status === 'completed',
      'la bandeja muestra completado después de recuperarse');
    await runtime.shutdown();
  }

  {
    const { fauxProvider } = await import('@earendil-works/pi-ai');
    const { bridge } = makeBridge();
    const historyBridge = async (method, params) => {
      if (method === 'agent_internal_dispatch' && params.name === 'canvas_list') {
        return { result: JSON.stringify({ private_tool_result: 'Boreal comprobante privado' }) };
      }
      return bridge(method, params);
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-history-'));
    const options = { dir, dbPath: path.join(dir, 'agent.sqlite'), bridge: historyBridge, skipImport: true };
    const faux = fauxProvider();
    runtime._internal._providerOverrides.set('faux', faux.provider);
    await runtime.open(options);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([{ type: 'thinking', thinking: 'Boreal pensamiento privado' }, { type: 'text', text: 'Boreal carta número 42' }]),
      fauxAssistantMessage('Boreal conversación eliminada'),
    ]);
    const { session: source } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', title: 'Proyecto Boreal' });
    await runtime.handlers.agent_message_send({ session_id: source.id, content: 'revisa Boreal plantilla' });
    assert(await waitIdle(source.id), 'el historial de origen está guardado');
    const { session: deleted } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: deleted.id, content: 'Boreal borrado' });
    assert(await waitIdle(deleted.id), 'la conversación que se borrará termina');
    await runtime.handlers.agent_session_delete({ id: deleted.id });
    await runtime.shutdown();
    await runtime.open(options);
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall('sessions_search', { query: 'BÓREAL' }),
        fauxToolCall('sessions_search', { query: 'Boreal', limit: 1 }),
        fauxToolCall('sessions_search', { query: 'comprobante privado' }),
        fauxToolCall('sessions_search', { query: 'pensamiento privado' }),
        fauxToolCall('sessions_search', { query: 'Preferencia', session_id: source.id }),
        fauxToolCall('sessions_search', { query: 'Boreal', session_id: deleted.id }),
        fauxToolCall('sessions_search', { query: 'Boreal', limit: 11 }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Recuperé la carta 42 de Proyecto Boreal'),
    ]);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'recuerda Boreal' });
    assert(await waitIdle(session.id), 'la búsqueda entre conversaciones termina tras reiniciar SQLite');
    const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const calls = listed.messages.flatMap((message) => message.tool_calls || []).filter((call) => call.name === 'sessions_search');
    const found = JSON.parse(calls[0].result);
    assert(found.matches.length === 2 && found.matches.every((match) => match.session_id === source.id && match.message_id),
      'la búsqueda ignora tildes y devuelve mensajes de origen sin incluir el chat actual ni el borrado');
    assert(found.matches.some((match) => match.role === 'assistant' && match.excerpt.includes('42')),
      'el resultado contiene texto real del historial');
    assert(JSON.parse(calls[1].result).matches.length === 1 && JSON.parse(calls[1].result).truncated,
      'el límite acota los resultados e indica el recorte');
    assert(calls.slice(2, 6).every((call) => JSON.parse(call.result).matches.length === 0),
      'no revela resultados de herramientas, razonamiento, contexto inyectado ni sesiones borradas');
    assert(calls[6].status === 'failed', 'un límite inválido devuelve un error');
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const { bridge } = makeBridge();
    let polls = 0;
    const { getEventListeners } = require('node:events');
    const signals = new Set();
    const addEventListener = AbortSignal.prototype.addEventListener;
    AbortSignal.prototype.addEventListener = function (type, ...args) {
      if (type === 'abort') signals.add(this);
      return addEventListener.call(this, type, ...args);
    };
    let baseline;
    let growth = 0;
    const pollingBridge = async (method, params) => {
      if (method === 'agent_internal_dispatch' && params.name === 'canvas_list') return { result: null };
      if (method === 'agent_internal_dispatch_result') {
        polls += 1;
        if (!baseline) baseline = new Map([...signals].map((signal) => [signal, getEventListeners(signal, 'abort').length]));
        for (const [signal, count] of baseline) growth = Math.max(growth, getEventListeners(signal, 'abort').length - count);
        return { result: polls >= 14 ? '{"ok":true}' : null };
      }
      return bridge(method, params);
    };
    try {
      await openFaux([
        fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' }),
        fauxAssistantMessage('Lectura completa'),
      ], pollingBridge);
      const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'lectura que tarda' });
      assert(await waitIdle(session.id), 'un despacho con muchos sondeos termina');
      assert(polls >= 14 && growth <= 1, 'los sondeos sucesivos no acumulan listeners de aborto');
    } finally {
      AbortSignal.prototype.addEventListener = addEventListener;
      await runtime.shutdown();
    }
  }

  for (const [changing, expected] of [[true, 4], [false, 3]]) {
    const { bridge } = makeBridge();
    let source;
    await openFaux([
      fauxAssistantMessage('Avance comprobado'),
      ...Array.from({ length: 4 }, (_, index) => async () => {
        await runtime.handlers.agent_session_rename({ id: source.id, title: changing ? `Estado ${index}` : 'Sin cambios' });
        return fauxAssistantMessage([fauxToolCall('sessions_search', { query: 'Avance', session_id: source.id })], { stopReason: 'toolUse' });
      }),
      fauxAssistantMessage('Terminado'),
    ], bridge);
    source = (await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' })).session;
    await runtime.handlers.agent_message_send({ session_id: source.id, content: 'Registra el avance' });
    assert(await waitIdle(source.id), 'el historial para buscar está persistido');
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Busca cambios en el historial' });
    assert(await waitIdle(session.id), 'termina el seguimiento de progreso de la búsqueda');
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const calls = messages.flatMap((message) => message.tool_calls || []).filter((call) => call.name === 'sessions_search');
    assert(calls.length === 4 && calls.filter((call) => call.status === 'done').length === expected,
      `sessions_search: ${changing ? 'avanzar permite la cuarta lectura' : 'repetir sin cambios conserva el límite'}`);
    await runtime.shutdown();
  }

  for (const [name, gated, expected, changing] of [
    ['canvas_list', false, 4, true], ['canvas_list', false, 3, false],
    ['desktop_observe', true, 4, true], ['desktop_observe', true, 3, false], ['fs_write', true, 3, true],
  ]) {
    const { bridge } = makeBridge();
    let executed = 0;
    const changingBridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        const result = await bridge(method, params);
        if (name !== 'canvas_list') result.tools.push({
          name, gated, kind: 'backend', module: 'computer', inputSchema: { type: 'object', properties: {} },
        });
        return result;
      }
      if (method === 'agent_internal_dispatch' && params.name === name) {
        executed += 1;
        return { result: JSON.stringify({
          active_window: changing ? `Ventana ${executed}` : 'Sin cambios',
          ...(name === 'desktop_observe' ? { image: { path: `C:\\fuera\\captura-${executed}.jpg`, mime: 'image/jpeg' } } : {}),
        }) };
      }
      return bridge(method, params);
    };
    await openFaux([
      ...Array.from({ length: 4 }, () => fauxAssistantMessage([fauxToolCall(name, {})], { stopReason: 'toolUse' })),
      fauxAssistantMessage('Terminado'),
    ], changingBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_session_permissions_set({ id: session.id, permission_mode: 'full' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'comprueba el avance' });
    assert(await waitIdle(session.id), `termina la comprobación de repeticiones con ${name}`);
    const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const calls = messages.flatMap((message) => message.tool_calls || []).filter((call) => call.name === name);
    assert(executed === expected && calls.filter((call) => call.status === 'done').length === expected,
      `${name}: los resultados nuevos permiten observar avances y los efectos conservan su límite`);
    await runtime.shutdown();
  }

  {
    const { bridge } = makeBridge();
    await openFaux([], bridge);
    const created = [];
    for (let index = 0; index < 51; index += 1) {
      const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
      created.push(session.id);
    }
    const { sessions: visible } = await runtime.handlers.agent_sessions_list({});
    const activity = await runtime.activitySnapshot();
    assert(visible.length === 51 && visible.some((session) => session.id === created[0]), 'crear otra conversación no oculta las anteriores');
    assert((await runtime.handlers.agent_messages_list({ session_id: created[0] })).messages.length === 0,
      'la conversación más antigua sigue accesible');
    assert(activity.length === visible.length && activity.every((item) => visible.some((session) => session.id === item.id)),
      'la bandeja solo incluye las conversaciones que el usuario puede abrir');
    await runtime.shutdown();
  }

  {
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const { fauxProvider } = await import('@earendil-works/pi-ai');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-recovery-'));
    const dbPath = path.join(dir, 'agent.sqlite');
    const { bridge } = makeBridge();
    const faux = fauxProvider();
    runtime._internal._providerOverrides.set('faux', faux.provider);
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    faux.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Fallo recuperable de prueba' })]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'primer intento' });
    assert(await waitIdle(session.id), 'el turno fallido termina');
    assert((await runtime.activitySnapshot()).find((item) => item.id === session.id).status === 'failed',
      'la bandeja informa del fallo actual');
    const conv = await require('../electron/agent-shared').conversation(session.id);
    const entries = () => require('../electron/agent-projection').allEntries(conv);
    const failure = (await entries()).find((entry) => entry.model?.[0]?.errorMessage === 'Fallo recuperable de prueba');
    assert(!!failure, 'el fallo queda registrado en el historial durable');
    faux.setResponses([fauxAssistantMessage('', { stopReason: 'aborted' })]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'intento interrumpido' });
    assert(await waitIdle(session.id), 'el intento interrumpido termina');
    assert((await runtime.handlers.agent_turn_status({ session_id: session.id })).last_error === 'Fallo recuperable de prueba',
      'una respuesta interrumpida no afirma que el fallo se recuperó');
    faux.setResponses([fauxAssistantMessage('Respuesta correcta')]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'reintentar' });
    assert(await waitIdle(session.id), 'la respuesta de recuperación termina');
    assert((await runtime.handlers.agent_turn_status({ session_id: session.id })).last_error === null,
      'una respuesta correcta limpia el error actual');
    assert((await runtime.activitySnapshot()).find((item) => item.id === session.id).status === 'completed',
      'la bandeja refleja la recuperación');
    assert(JSON.stringify((await entries()).find((entry) => entry.id === failure.id)) === JSON.stringify(failure),
      'la recuperación conserva íntegra la entrada histórica del fallo');
    await runtime.shutdown();
    await runtime.open({ storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const restored = await runtime.handlers.agent_turn_status({ session_id: session.id });
    assert(restored.last_error === null && !restored.running, 'el error recuperado sigue limpio tras reabrir SQLite');
    assert((await runtime.activitySnapshot()).find((item) => item.id === session.id).status === 'completed',
      'la bandeja sigue recuperada tras reiniciar');
    const restoredConv = await require('../electron/agent-shared').conversation(session.id);
    assert(JSON.stringify((await require('../electron/agent-projection').allEntries(restoredConv))
      .find((entry) => entry.id === failure.id)) === JSON.stringify(failure), 'el historial del fallo también sobrevive al reinicio');
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const decision = 'cancel';
    const { bridge, state } = makeBridge();
    let checks = 0;
    const approvalBridge = async (method, params) => {
      if (method === 'agent_internal_approval_status') checks += 1;
      return bridge(method, params);
    };
    await openFaux([
      fauxAssistantMessage([fauxToolCall('db_clear', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Decisión recibida'),
    ], approvalBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'espera mi decisión' });
    assert(await waitFor(() => checks >= 2), `${decision}: la aprobación atraviesa varios sondeos`);
    const [approval] = state.approvals.values();
    assert(runtime._internal.shared.decisionWaiters.get(approval.id)?.size === 1,
      `${decision}: solo queda viva la espera actual de aprobación`);
    await runtime.handlers.agent_turn_cancel({ session_id: session.id });
    assert(await waitIdle(session.id), `${decision}: la decisión cierra el turno`);
    assert(!runtime._internal.shared.decisionWaiters.has(approval.id), `${decision}: no quedan esperas de aprobación residuales`);
    assert(state.dispatches.length === 0, `${decision}: respeta la decisión sin repetir el efecto`);
    await runtime.shutdown();
  }

  for (const kind of ['backend', 'native']) {
    const { bridge } = makeBridge();
    const cancelled = [];
    const counts = new Map();
    const dispatches = [];
    let boundaryRead;
    let settleBoundary;
    let release;
    let entered = false;
    const gate = new Promise((resolve) => { release = resolve; });
    const pollBridge = (method, params) => {
      if (method === 'agent_internal_dispatch') {
        dispatches.push(params.call_id);
        return { result: null };
      }
      if (method === 'agent_internal_dispatch_result') {
        const n = (counts.get(params.call_id) || 0) + 1;
        counts.set(params.call_id, n);
        if (n < 3) return { result: null };
        if (params.call_id === 'error') throw new Error('Consulta interrumpida');
        if (params.call_id === 'abort') {
          entered = true;
          return gate.then(() => ({ result: 'resultado tardío', output: 'salida tardía' }));
        }
        if (params.call_id === 'between') {
          boundaryRead = new Promise((resolve) => { settleBoundary = resolve; });
          return boundaryRead;
        }
        return { result: 'resultado final' };
      }
      if (method === 'agent_internal_dispatch_cancel') {
        cancelled.push(params.call_id);
        return Promise.resolve({ cancelled: true });
      }
      return bridge(method, params);
    };
    runtime._internal.shared.nativeTools = {
      nativeToolContext: async () => ({}),
      nativeToolSpecs: () => [{ name: 'native_poll', kind: 'native', gated: false, inputSchema: { type: 'object', properties: {} } }],
      runNativeTool: async () => { throw new Error('No se debe repetir un efecto recuperado'); },
    };
    await openFaux([], pollBridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const { dispatchApproved } = require('../electron/agent-execution');
    for (const outcome of ['complete', 'error', 'abort', 'between']) {
      const controller = new AbortController();
      const waiting = dispatchApproved({ session_id: session.id, call_id: outcome,
        method: kind === 'native' ? 'native_poll' : 'canvas_list', params: {}, id: 'ap-poll' }, { abortSignal: controller.signal });
      if (outcome === 'abort') {
        assert(await waitFor(() => entered), `${kind}: el sondeo entra en una consulta pendiente`);
        controller.abort();
        release();
      }
      if (outcome === 'between') {
        assert(await waitFor(() => !!boundaryRead), `${kind}: la lectura pendiente permite detener entre sondeos`);
        boundaryRead.then(() => controller.abort());
        settleBoundary({ result: null });
      }
      const result = await waiting.catch((error) => error);
      assert(getEventListeners(controller.signal, 'abort').length === 0, `${kind}/${outcome}: libera su listener al terminar`);
      controller.abort();
      assert(cancelled.length === (outcome === 'between' ? 2 : outcome === 'abort' ? 1 : 0), `${kind}/${outcome}: solo cancela el despacho que sigue activo`);
      assert(outcome === 'complete' ? result === 'resultado final'
        : outcome === 'error' ? result === runtime._internal.shared.INTERRUPTED_RESULT : result.name === 'AbortError',
        `${kind}/${outcome}: conserva el resultado correcto y descarta respuestas tardías`);
    }
    assert(dispatches.join() === 'complete,error,abort,between', `${kind}: cada despacho se inicia una sola vez`);
    assert(counts.get('abort') === 3 && counts.get('between') === 3 && cancelled.join() === 'abort,between', `${kind}: detener no deja sondeos ni cancelaciones residuales`);
    runtime._internal.shared.nativeTools = null;
    await runtime.shutdown();
  }

  {
    const { spawn } = require('node:child_process');
    const { createInterface } = require('node:readline');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-delegate-'));
    const script = String.raw`
import json
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from backend.core.agent import agent, agent_chat
from backend.handlers import agent_internal
from backend.core.integrations.types import JsonObject

store = agent.AgentStore(Path(sys.argv[1]))
reads = []
routes = []
started = threading.Event()
release = threading.Event()
cancellations = 0

def chat(provider: str, model: str, messages: list[JsonObject], *, system: str, tools: list[JsonObject]) -> JsonObject:
    routes.append({"provider": provider, "model": model, "tools": [tool["name"] for tool in tools]})
    if messages[0]["content"] == "espera":
        started.set()
        release.wait(20)
        return {"text": "Respuesta tardía", "calls": []}
    if len(messages) == 1:
        return {"calls": [{"id": name, "name": name, "params": {}} for name in ("canvas_list", "db_clear", "subagent_run")]}
    return {"text": provider + "/" + model, "calls": []}

def handler(name: str) -> Callable[[JsonObject], JsonObject]:
    def execute(params: JsonObject) -> JsonObject:
        reads.append(name)
        return {"documents": ["Plantilla verificada"]}
    return execute

agent_chat.chat = chat
agent_internal._store = lambda: store
agent.get_agent_store = lambda: store
runner = agent.AgentRunner(store, handler)
agent.get_agent_runner = lambda: runner
for line in sys.stdin:
    request = json.loads(line)
    try:
        method = request["method"]
        params = request["params"]
        if method == "test_state":
            result = {"routes": routes, "reads": reads, "started": started.is_set(), "cancellations": cancellations,
                      "legacy": store.get_session(params["session_id"]) is not None}
        elif method == "test_release":
            release.set()
            result = {}
        else:
            if method == "agent_internal_dispatch_cancel":
                cancellations += 1
            result = agent_internal.HANDLERS[method](params)
        print(json.dumps({"id": request["id"], "result": result}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"id": request["id"], "error": str(error)}), flush=True)
`;
    const child = spawn('uv', ['run', '--project', path.resolve(__dirname, '..'), '--locked', '--extra', 'dev',
      'python', '-u', '-c', script, dir], {
      cwd: path.resolve(__dirname, '..'), windowsHide: true,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    const pending = new Map();
    let sequence = 0;
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    const closed = new Promise((resolve) => child.once('close', resolve));
    const failPending = (error) => {
      for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
      pending.clear();
    };
    child.on('error', failPending);
    child.on('close', () => failPending(new Error(`El bridge Python terminó: ${stderr}`)));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const response = JSON.parse(line);
      const waiter = pending.get(response.id);
      if (!waiter) return;
      pending.delete(response.id);
      clearTimeout(waiter.timer);
      if (response.error) waiter.reject(new Error(response.error));
      else waiter.resolve(response.result);
    });
    const rpc = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout del bridge de prueba: ${method}; ${stderr}`)); }, 30_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    try {
      const { bridge } = makeBridge();
      const delegated = [];
      const wired = async (method, params) => {
        if (['agent_internal_dispatch', 'agent_internal_dispatch_result', 'agent_internal_dispatch_cancel'].includes(method)) {
          if (method === 'agent_internal_dispatch') delegated.push(params);
          return rpc(method, params);
        }
        return bridge(method, params);
      };
      const faux = await openFaux([], wired);
      const { profile } = await runtime.handlers.agent_profile_save({ name: 'Investigador real',
        instructions: 'Lee Canvas y resume.', tools: ['canvas_list', 'db_clear'] });
      const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
      const initial = (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools;
      await runtime.handlers.agent_tools_set({ session_id: session.id,
        names: [...new Set([...initial.filter((tool) => tool.enabled).map((tool) => tool.name), 'canvas_list'])] });
      const responses = (task) => [
        fauxAssistantMessage([fauxToolCall('subagent_run', { agent: profile.id, task })], { stopReason: 'toolUse' }),
        fauxAssistantMessage('Recibí el resultado del subagente'),
      ];
      const receipt = async () => {
        const listed = await runtime.handlers.agent_messages_list({ session_id: session.id });
        return JSON.parse(listed.messages.flatMap((message) => message.tool_calls || [])
          .filter((call) => call.name === 'subagent_run').at(-1).result);
      };
      faux.setResponses(responses('primera lectura'));
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'delega la revisión' });
      assert(await waitIdle(session.id), 'desktop y Python completan una delegación sin sesión legacy');
      const first = await receipt();
      assert(first.status === 'done' && first.text === 'faux/faux-1', 'el subagente usa el proveedor y modelo del chat desktop');
      assert(first.steps.map((step) => step.status).join() === 'done,failed,failed',
        'la lectura cruza el adapter y los efectos y la recursión quedan bloqueados');
      const { fauxProvider } = await import('@earendil-works/pi-ai');
      const next = fauxProvider({ provider: 'faux-next', models: [{ id: 'modelo-actual' }] });
      runtime._internal._providerOverrides.set('faux-next', next.provider);
      await runtime.handlers.agent_session_model_set({ id: session.id, provider: 'faux-next', model: 'modelo-actual' });
      next.setResponses(responses('segunda lectura'));
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'delega con el modelo nuevo' });
      assert(await waitIdle(session.id), 'la delegación termina después de cambiar de modelo');
      assert((await receipt()).text === 'faux-next/modelo-actual', 'Python recibe el modelo vigente después del cambio público');
      await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['subagent_run'] });
      next.setResponses(responses('lectura deshabilitada'));
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'comprueba los permisos actuales' });
      assert(await waitIdle(session.id), 'la delegación con lectura deshabilitada termina');
      assert((await receipt()).steps.every((step) => step.status === 'failed'), 'el subagente respeta las herramientas deshabilitadas en el chat');
      let state = await rpc('test_state', { session_id: session.id });
      assert(!state.legacy && state.reads.join() === 'canvas_list,canvas_list', 'no se crea una sesión legacy ni se ejecutan efectos o delegaciones recursivas');
      assert(state.routes[0].tools.join() === 'canvas_list' && state.routes.at(-1).tools.length === 0,
        'el modelo del subagente solo recibe las lecturas autorizadas por perfil y conversación');
      next.setResponses([fauxAssistantMessage([fauxToolCall('subagent_run', { agent: profile.id, task: 'espera' })], { stopReason: 'toolUse' })]);
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'delega y espera' });
      assert(await waitFor(async () => (await rpc('test_state', { session_id: session.id })).started), 'el proveedor falso del subagente queda en vuelo');
      await runtime.handlers.agent_turn_cancel({ session_id: session.id });
      assert(await waitIdle(session.id), 'Detener cierra el turno desktop con el subagente en vuelo');
      await rpc('test_release');
      const call = delegated.at(-1);
      let stopped;
      assert(await waitFor(async () => {
        stopped = await rpc('agent_internal_dispatch_result', { session_id: session.id, call_id: call.call_id });
        return stopped.dispatch.status !== 'running';
      }), 'el despacho Python también cierra tras liberar la respuesta tardía');
      state = await rpc('test_state', { session_id: session.id });
      assert(stopped.dispatch.status === 'uncertain' && !JSON.parse(stopped.result).text,
        'la respuesta posterior a Detener no se guarda como una delegación exitosa');
      assert(state.cancellations === 1, 'Detener envía una cancelación al subagente real');
    } finally {
      await runtime.shutdown();
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 3000);
      await closed;
      clearTimeout(timer);
      lines.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  finish();
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
