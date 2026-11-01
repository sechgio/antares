'use strict';

const crypto = require('node:crypto');
const appLog = require('./app-log');
const { stableJson } = require('./stable-json');

// Telemetría local del prefijo cacheable: solo hashes, etiquetas y conteos.
// El contenido del usuario se usa solo para calcular hashes; nunca se escribe.
// Los eventos van al log estructurado de observabilidad, no a la consola.
// completeSimple (compactación) queda fuera a propósito: su prompt resume la
// conversación y no debe compararse con la petición normal anterior.
// El mapa conserva 256 sesiones por LRU; hashear cuesta O(payload), el mismo
// payload que ya se envía al proveedor.
const MAX_SESSIONS = 256;
const CACHE_CONTROL = new Set(['cache_control']);
const sessions = new Map();

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value, CACHE_CONTROL)).digest('hex');
}

function textDigest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function prefixSegments(payload) {
  const messages = payload && Array.isArray(payload.messages) ? payload.messages : [];
  const system = [];
  if (payload && payload.system !== undefined) {
    system.push(...(Array.isArray(payload.system) ? payload.system : [payload.system]));
  }
  let index = 0;
  while (index < messages.length && messages[index]
    && (messages[index].role === 'system' || messages[index].role === 'developer')) {
    system.push(messages[index]);
    index += 1;
  }
  const historyHashes = messages.slice(index).map(digest);
  return {
    systemHash: digest(system),
    systemBlocks: system.length,
    // Longitud del JSON canónico, no del texto: incluye claves y sintaxis.
    systemJsonChars: system.reduce((total, part) => total + stableJson(part, CACHE_CONTROL).length, 0),
    toolsHash: digest(payload && payload.tools !== undefined ? payload.tools : []),
    toolCount: Array.isArray(payload && payload.tools) ? payload.tools.length : 0,
    historyHashes,
    historyHash: digest(historyHashes),
  };
}

function comparePrefixes(previous, current) {
  if (!previous) return { break: 'initial', historyIndex: null, previousMessages: null };
  let historyIndex = 0;
  while (historyIndex < previous.historyHashes.length && historyIndex < current.historyHashes.length
    && previous.historyHashes[historyIndex] === current.historyHashes[historyIndex]) historyIndex += 1;
  const previousMessages = previous.historyHashes.length;
  if (previous.systemHash !== current.systemHash) return { break: 'system', historyIndex: null, previousMessages };
  if (previous.toolsHash !== current.toolsHash) return { break: 'tools', historyIndex: null, previousMessages };
  if (historyIndex < previousMessages) return { break: 'history', historyIndex, previousMessages };
  return { break: 'none', historyIndex: null, previousMessages };
}

function emit(event, fields) {
  try {
    appLog.appendLogEvent('INFO', event, fields);
  } catch { }
}

function recordRequest(sessionId, payload) {
  const key = String(sessionId || '');
  if (!key) return null;
  const current = prefixSegments(payload);
  const comparison = comparePrefixes(sessions.get(key), current);
  sessions.delete(key);
  sessions.set(key, current);
  if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  const requestHash = textDigest(`${current.systemHash}:${current.toolsHash}:${current.historyHash}`);
  const sessionHash = textDigest(key).slice(0, 16);
  emit('agent.cache_prefix', {
    session: sessionHash,
    request_hash: requestHash.slice(0, 16),
    break: comparison.break,
    history_index: comparison.historyIndex,
    messages: current.historyHashes.length,
    previous_messages: comparison.previousMessages,
    system_blocks: current.systemBlocks,
    system_json_chars: current.systemJsonChars,
    tools: current.toolCount,
    system_hash: current.systemHash.slice(0, 16),
    tools_hash: current.toolsHash.slice(0, 16),
    history_hash: current.historyHash.slice(0, 16),
  });
  return { session: sessionHash, requestHash };
}

function recordUsage(request, message) {
  const usage = message && message.usage;
  if (!request || !usage) return;
  const count = (value) => Math.max(0, Number(value) || 0);
  const input = count(usage.input);
  const output = count(usage.output);
  const cacheRead = count(usage.cacheRead);
  const cacheWrite = count(usage.cacheWrite);
  const prompt = input + cacheRead + cacheWrite;
  emit('agent.cache_usage', {
    session: request.session,
    request_hash: request.requestHash.slice(0, 16),
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    prompt,
    cache_read_percent: prompt > 0 ? Math.round((cacheRead * 1000) / prompt) / 10 : null,
  });
}

// Envuelve stream/streamSimple para observar el payload que recibe el
// proveedor y el usage del mensaje final. La telemetría nunca debe alterar la
// petición.
function withCacheTelemetry(api) {
  const wrap = (stream) => (model, context, options) => {
    const sessionId = options && typeof options.sessionId === 'string' ? options.sessionId : '';
    let request = null;
    const streamed = stream(model, context, {
      ...options,
      onPayload: async (payload, target) => {
        const next = options && options.onPayload ? await options.onPayload(payload, target) : undefined;
        const observed = next === undefined ? payload : next;
        try { request = recordRequest(sessionId, observed); } catch { request = null; }
        return observed;
      },
    });
    if (!sessionId || !streamed || typeof streamed.result !== 'function') return streamed;
    let reported = false;
    try {
      const result = streamed.result.bind(streamed);
      streamed.result = async () => {
        const message = await result();
        if (!reported) {
          reported = true;
          try { recordUsage(request, message); } catch { }
        }
        return message;
      };
    } catch { }
    return streamed;
  };
  return { ...api, stream: wrap(api.stream), streamSimple: wrap(api.streamSimple) };
}

module.exports = { withCacheTelemetry };
