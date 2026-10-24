'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { assert, finish } = require('./helpers/harness');
const runtime = require('../electron/agent-runtime');

const LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-turn-log-'));
process.env.TURN_LOG_PATH = path.join(LOG_DIR, 'turns.jsonl');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function makeBridge() {
  const state = { dispatches: [], seq: 0 };
  const bridge = async (method, params) => {
    switch (method) {
      case 'agent_internal_tools':
        return {
          tools: [
            { name: 'canvas_list', description: 'Lista documentos de Canvas', gated: false, kind: 'backend', inputSchema: { type: 'object', properties: {} } },
            { name: 'task_plan', description: 'Declara el plan del turno', gated: false, kind: 'backend', inputSchema: { type: 'object', properties: {} } },
          ],
        };
      case 'agent_internal_provider':
        return { provider: params.provider, style: 'openai_chat', base_url: 'http://x', api_key: 'k', auth_type: 'api_key', extra_headers: {}, default_model: 'faux-1' };
      case 'agent_internal_dispatch': {
        const existing = state.dispatches.find((d) => d.session_id === params.session_id && d.call_id === params.call_id);
        if (existing) return { result: existing.result, dispatch: existing };
        const result = params.name === 'task_plan'
          ? JSON.stringify({ ok: true, remaining: ['paso pendiente'] })
          : JSON.stringify({ ok: true, tool: params.name });
        const record = { session_id: params.session_id, call_id: params.call_id, status: 'succeeded', result };
        state.dispatches.push(record);
        return { result: record.result, dispatch: record };
      }
      case 'agent_internal_dispatch_result':
        return { result: null };
      case 'agent_internal_dispatch_cancel':
        return { cancelled: false };
      case 'agent_internal_approvals_pending':
        return { approvals: [] };
      case 'agent_internal_mentions':
        return { modules: [], unknown: [], ambiguous: [] };
      case 'agent_internal_memory_context':
        return { context: '', items: [] };
      case 'agent_internal_artifacts':
        return { artifacts: [], questions: [], context: {} };
      case 'agent_internal_activity':
        return { attention: {} };
      default:
        throw new Error(`bridge desconocido: ${method}`);
    }
  };
  return { bridge, state };
}

function loggedTurns() {
  return fs.readFileSync(process.env.TURN_LOG_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

async function main() {
  const { MemoryStorage } = await import('@earendil-works/pi-durable');
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  const { bridge } = makeBridge();
  await runtime.open({ storage: new MemoryStorage(), bridge, skipImport: true });
  const faux = fauxProvider();
  runtime._internal._providerOverrides.set('faux', faux.provider);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' }),
    fauxAssistantMessage('Listado listo'),
    fauxAssistantMessage('hecho'),
    fauxAssistantMessage('falla', { stopReason: 'error', errorMessage: 'proveedor caido' }),
  ]);

  {
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Lista documentos de Canvas' });
    assert(await waitIdle(session.id), 'el turno con herramienta termina');

    const turns = loggedTurns();
    assert(turns.length === 1, 'el turno completado escribe exactamente una entrada');
    const [entry] = turns;
    assert(entry.status === 'ok', 'un turno sin error se registra como ok');
    assert(entry.session_id === session.id, 'la entrada lleva el session_id de la conversación');
    assert(entry.agent === 'faux/faux-1', 'la entrada lleva proveedor/modelo como agent');
    assert(entry.turn_id.startsWith('turn_'), 'cada entrada tiene turn_id');
    assert(entry.input_summary === 'Lista documentos de Canvas', 'input_summary toma el texto del usuario');
    assert(entry.output_summary === 'Listado listo', 'output_summary toma la respuesta final');
    assert(entry.error === null, 'un turno ok no lleva error');
    assert(Array.isArray(entry.tool_calls) && entry.tool_calls.length === 1, 'la llamada de herramienta queda registrada');
    const [call] = entry.tool_calls;
    assert(call.name === 'canvas_list' && call.applied === true, 'la llamada aplicó');
    assert(call.verified && call.verified.kind === 'capture' && /"ok":true/.test(call.verified.value),
      'la llamada guarda el resultado capturado como evidencia, no solo «se llamó»');
    assert(entry.started_at <= entry.ended_at, 'el intervalo del turno es coherente');

    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'mi clave es password=supersecreto1' });
    assert(await waitIdle(session.id), 'el turno con secreto termina');

    const turnsAfterSecret = loggedTurns();
    assert(turnsAfterSecret.length === 2, 'cada turno añade una línea');
    const secretEntry = turnsAfterSecret[1];
    assert(secretEntry.session_id === session.id, 'el segundo turno es de la misma sesión');
    assert(secretEntry.input_summary === 'mi clave es password=[redacted]', 'el secreto del input se redacta');
    assert(!JSON.stringify(secretEntry).includes('supersecreto1'), 'el secreto nunca llega al log');
  }

  {
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'rompe' });
    assert(await waitIdle(session.id), 'el turno con error de proveedor termina');

    const turns = loggedTurns();
    assert(turns.length === 3, 'el turno con error añade su línea');
    const failed = turns[2];
    assert(failed.status === 'error', 'un turno con error del proveedor se registra como error');
    assert(/caido/.test(failed.error || ''), 'la entrada conserva la causa del error');
    assert(failed.output_summary === 'falla', 'output_summary conserva la respuesta parcial');
    assert(Array.isArray(failed.tool_calls) && failed.tool_calls.length === 0, 'sin llamadas de herramienta el array queda vacío');
  }

  {
    const before = loggedTurns().length;
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('task_plan', { pasos: ['único'] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('cierro sin verificar el plan'),
      fauxAssistantMessage('hecho ahora sí'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'haz el encargo' });
    assert(await waitIdle(session.id), 'el turno con plan-check termina');

    const turns = loggedTurns();
    assert(turns.length === before + 2, 'la continuación de plan-check añade una segunda entrada');
    const [first, second] = turns.slice(before);
    assert(first.status === 'ok' && second.status === 'ok', 'ambos segmentos terminan ok');
    assert(first.turn_id !== second.turn_id, 'cada segmento lleva turn_id propio');
    assert(second.input_summary.startsWith('[Comprobación de Antares]'), 'la segunda entrada identifica el aviso de comprobación');
    assert(second.tool_calls.length === 0, 'el segmento de continuación no repite llamadas');
  }

  {
    const before = loggedTurns().length;
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    faux.setResponses([
      ...Array.from({ length: 40 }, (_, i) => fauxAssistantMessage([fauxToolCall('canvas_list', { paso: i })], { stopReason: 'toolUse' })),
      fauxAssistantMessage('no debería consumirse'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'agota el presupuesto' });
    assert(await waitIdle(session.id, 30000), 'el turno pausado por presupuesto termina');

    const turns = loggedTurns();
    assert(turns.length === before + 1, 'la pausa escribe una única entrada');
    const paused = turns[before];
    assert(paused.status === 'failed', 'el turno pausado por presupuesto se registra como failed');
    assert(paused.tool_calls.length === 40, 'la entrada conserva las llamadas acumuladas del turno');
    assert(paused.input_summary === 'agota el presupuesto', 'la entrada pausada es del turno interrumpido');

    faux.setResponses([fauxAssistantMessage('reanudado y listo')]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'sigue' });
    assert(await waitIdle(session.id), 'el turno siguiente termina');

    const after = loggedTurns();
    assert(after.length === before + 2, 'el turno siguiente añade su propia entrada');
    const fresh = after[before + 1];
    assert(fresh.status === 'ok' && fresh.tool_calls.length === 0, 'el turno siguiente no hereda llamadas del pausado');
    assert(fresh.input_summary === 'sigue', 'el turno siguiente registra su propio input');
    assert(fresh.turn_id !== paused.turn_id, 'el turno siguiente lleva turn_id propio');
  }

  await runtime.shutdown();
  fs.rmSync(LOG_DIR, { recursive: true, force: true });
  finish();
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
