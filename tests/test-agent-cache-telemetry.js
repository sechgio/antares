'use strict';

const appLog = require('../electron/app-log');
const { assert, finish } = require('./helpers/harness');

const { withCacheTelemetry } = require('../electron/agent-cache-telemetry');

const USAGE = { input: 10, output: 2, cacheRead: 30, cacheWrite: 5, totalTokens: 47 };

function fakeApi(usage = USAGE) {
  const queue = [];
  const stream = (_model, _context, options) => {
    const payload = queue.shift();
    return {
      result: async () => {
        await options.onPayload(payload, {});
        return { usage: { ...usage } };
      },
    };
  };
  return { api: withCacheTelemetry({ stream, streamSimple: stream }), queue };
}

function system(text, cached = false) {
  return [{ type: 'text', text, ...(cached ? { cache_control: { type: 'ephemeral' } } : {}) }];
}

function user(text, cached = false) {
  return { role: 'user', content: [{ type: 'text', text, ...(cached ? { cache_control: { type: 'ephemeral' } } : {}) }] };
}

const assistant = { role: 'assistant', content: [{ type: 'text', text: 'respuesta' }] };
const tools = [{ type: 'function', function: { name: 'fs_read', description: 'lee', parameters: { type: 'object' } } }];

async function main() {
  const events = [];
  const originalAppendLogEvent = appLog.appendLogEvent;
  appLog.appendLogEvent = (level, event, fields) => { events.push({ level, event, fields }); };
  const latest = (name) => {
    const entry = [...events].reverse().find((item) => item.event === name);
    return entry ? { event: entry.event, ...entry.fields } : null;
  };
  const send = async (api, queue, sessionId, body, options = {}, model = {}, context = {}) => {
    queue.push(body);
    return api.streamSimple(model, context, { sessionId, ...options }).result();
  };
  try {
    const { api, queue } = fakeApi();
    const session = 'cache-telemetry-session-1';

    await send(api, queue, session, { system: system('prompt estable', true), tools, messages: [user('contenido privado', true)] });
    let prefix = latest('agent.cache_prefix');
    assert(prefix && prefix.event === 'agent.cache_prefix' && prefix.break === 'initial'
      && prefix.messages === 1 && prefix.tools === 1 && prefix.system_blocks === 1
      && prefix.system_json_chars > 0,
    'la primera petición abre el prefijo con system, tools e historial contados');
    assert(/^[0-9a-f]{16}$/.test(prefix.system_hash) && /^[0-9a-f]{16}$/.test(prefix.tools_hash)
      && /^[0-9a-f]{16}$/.test(prefix.history_hash) && /^[0-9a-f]{16}$/.test(prefix.session),
    'el log lleva hashes del prefijo y de la sesión');
    assert(!JSON.stringify(prefix).includes('contenido privado') && !JSON.stringify(prefix).includes('prompt estable'),
      'el log no incluye contenido del usuario ni del sistema');

    await send(api, queue, session, { system: system('prompt estable'), tools, messages: [user('contenido privado'), assistant] });
    prefix = latest('agent.cache_prefix');
    assert(prefix.break === 'none' && prefix.messages === 2 && prefix.previous_messages === 1,
      'mover cache_control y ampliar el historial conserva el prefijo');

    await send(api, queue, session, { system: system('prompt cambiado'), tools, messages: [user('contenido privado'), assistant] });
    prefix = latest('agent.cache_prefix');
    assert(prefix.break === 'system' && prefix.history_index === null,
      'un cambio en el system rompe el prefijo por system');

    await send(api, queue, session, { system: system('prompt cambiado'), tools: [...tools, {
      type: 'function', function: { name: 'fs_write', description: 'escribe', parameters: { type: 'object' } },
    }], messages: [user('contenido privado'), assistant] });
    prefix = latest('agent.cache_prefix');
    assert(prefix.break === 'tools' && prefix.tools === 2,
      'un cambio en tools rompe el prefijo por tools');

    await send(api, queue, session, { system: system('prompt cambiado'), tools: [...tools, {
      type: 'function', function: { name: 'fs_write', description: 'escribe', parameters: { type: 'object' } },
    }], messages: [user('contenido privado'), { role: 'assistant', content: [{ type: 'text', text: 'otra respuesta' }] }] });
    prefix = latest('agent.cache_prefix');
    assert(prefix.break === 'history' && prefix.history_index === 1,
      'un cambio en el historial informa el índice donde se rompe el prefijo');

    const usage = latest('agent.cache_usage');
    assert(usage && usage.event === 'agent.cache_usage' && usage.cache_read === 30 && usage.input === 10
      && usage.cache_write === 5 && usage.prompt === 45 && usage.cache_read_percent === 66.7,
    'el usage registra tokens y el porcentaje leído de caché');
    assert(usage.request_hash === prefix.request_hash,
      'usage y petición comparten el hash de la petición');
    assert(events.some((entry) => entry.level === 'INFO' && entry.event === 'agent.cache_prefix'),
      'el prefijo se escribe en el log estructurado con nivel INFO');

    await send(api, queue, 'cache-telemetry-session-2', { system: system('prompt estable'), tools, messages: [user('otro')] });
    assert(latest('agent.cache_prefix').break === 'initial', 'cada sesión compara solo con su petición anterior');

    const routed = 'cache-telemetry-routed';
    const primary = { provider: 'custom', api: 'openai-completions', id: 'grok-4', baseUrl: 'https://api.x.ai/v1' };
    const endpoint = { ...primary, baseUrl: 'https://proxy.example/v1' };
    const body = { model: 'grok-4', messages: [user('hola')], prompt_cache_key: 'private-routing-key' };
    await send(api, queue, routed, body, {}, primary);
    const original = latest('agent.cache_prefix');
    await send(api, queue, routed, body, {}, endpoint);
    const changedEndpoint = latest('agent.cache_prefix');
    assert(changedEndpoint.break === 'initial' && changedEndpoint.session === original.session &&
      changedEndpoint.request_hash !== original.request_hash, 'un cambio de endpoint abre otra serie de caché');
    await send(api, queue, routed, { ...body, model: 'otro' }, {}, primary);
    assert(latest('agent.cache_prefix').break === 'initial', 'el modelo del payload también delimita la caché');
    await send(api, queue, routed, body, {}, primary);
    assert(latest('agent.cache_prefix').break === 'none' && !JSON.stringify(events).includes('private-routing-key'),
      'se retoma la comparación del destino original y la clave de caché queda fuera de los logs');

    const rebuilding = 'cache-telemetry-rebuilds';
    const checkpoint = user('The conversation history before this point was compacted into the following summary:\n<summary>Seguimos.</summary>');
    const toolOutput = { role: 'toolResult', toolCallId: 'call-1', content: [{ type: 'text', text: 'resultado' }] };
    const pruned = { ...toolOutput, content: [{ type: 'text', text: '[Resultado de fs_read omitido para ahorrar contexto: 3500 caracteres]' }] };
    await send(api, queue, rebuilding, { messages: [user('antes'), toolOutput] });
    await send(api, queue, rebuilding, { messages: [checkpoint, toolOutput] }, {}, {}, { messages: [checkpoint, toolOutput] });
    const compacted = latest('agent.cache_prefix');
    assert(compacted.break === 'history' && compacted.expected_rebuild === 'compaction' && compacted.request_gap_ms >= 0,
      'un checkpoint nuevo identifica una reconstrucción esperada sin inferir el TTL real');
    await send(api, queue, rebuilding, { messages: [checkpoint, pruned] }, {}, {}, { messages: [checkpoint, pruned] });
    assert(latest('agent.cache_prefix').expected_rebuild === 'tool_pruning',
      'un cambio de historial causado por poda tiene su propio diagnóstico');

    const openai = 'cache-telemetry-session-openai';
    await send(api, queue, openai, { messages: [{ role: 'system', content: 'prompt' }, user('hola')] });
    assert(latest('agent.cache_prefix').break === 'initial' && latest('agent.cache_prefix').system_blocks === 1,
      'un system al frente de messages también cuenta como prefijo');
    await send(api, queue, openai, { messages: [{ role: 'system', content: 'prompt' }, user('hola'), assistant] });
    assert(latest('agent.cache_prefix').break === 'none' && latest('agent.cache_prefix').previous_messages === 1,
      'el formato OpenAI conserva el prefijo al ampliar el historial');

    await send(api, queue, 'cache-telemetry-session-blocks', {
      system: [...system('uno'), { type: 'text', text: 'dos' }], messages: [],
    });
    assert(latest('agent.cache_prefix').system_blocks === 2, 'cada bloque del system cuenta por separado');

    const before = events.length;
    await send(api, queue, undefined, { system: system('sin sesión'), tools, messages: [] });
    assert(events.length === before, 'sin sessionId no se registra telemetría');

    const zero = fakeApi({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
    await send(zero.api, zero.queue, 'cache-telemetry-zero', { messages: [] });
    const zeroUsage = latest('agent.cache_usage');
    assert(zeroUsage.prompt === 0 && zeroUsage.cache_read_percent === null,
      'sin prompt el porcentaje de caché es null');

    const caller = fakeApi();
    await send(caller.api, caller.queue, 'cache-telemetry-caller', { tools, messages: [] }, {
      onPayload: async (payload) => {
        payload.tools = [...payload.tools, {
          type: 'function', function: { name: 'fs_write', description: 'escribe', parameters: { type: 'object' } },
        }];
        return payload;
      },
    });
    assert(latest('agent.cache_prefix').tools === 2,
      'la telemetría observa el payload devuelto por el onPayload del llamador');

    const lru = fakeApi();
    for (let i = 0; i < 257; i += 1) {
      await send(lru.api, lru.queue, `cache-telemetry-lru-${i}`, { messages: [] });
    }
    await send(lru.api, lru.queue, 'cache-telemetry-lru-0', { messages: [] });
    assert(latest('agent.cache_prefix').break === 'initial',
      'el mapa olvida la sesión más antigua al superar 256');
  } finally {
    appLog.appendLogEvent = originalAppendLogEvent;
  }

  finish();
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
