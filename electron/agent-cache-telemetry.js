'use strict';

const crypto = require('node:crypto');
const appLog = require('./app-log');
const { stableJson } = require('./stable-json');
const { unwrapCompactionSummary } = require('./agent-compaction');

const MAX_SCOPES = 256;
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
  while (
    index < messages.length &&
    messages[index] &&
    (messages[index].role === 'system' || messages[index].role === 'developer')
  ) {
    system.push(messages[index]);
    index += 1;
  }
  const historyHashes = messages.slice(index).map(digest);
  return {
    systemHash: digest(system),
    systemBlocks: system.length,
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
  while (
    historyIndex < previous.historyHashes.length &&
    historyIndex < current.historyHashes.length &&
    previous.historyHashes[historyIndex] === current.historyHashes[historyIndex]
  )
    historyIndex += 1;
  const previousMessages = previous.historyHashes.length;
  if (previous.systemHash !== current.systemHash) return { break: 'system', historyIndex: null, previousMessages };
  if (previous.toolsHash !== current.toolsHash) return { break: 'tools', historyIndex: null, previousMessages };
  if (historyIndex < previousMessages) return { break: 'history', historyIndex, previousMessages };
  return { break: 'none', historyIndex: null, previousMessages };
}

function emit(event, fields) {
  try {
    appLog.appendLogEvent('INFO', event, fields);
  } catch {}
}

function contextChanges(context) {
  const messages = context?.messages || [];
  const firstUser = messages.find((message) => message.role === 'user');
  const content = firstUser?.content;
  const text = typeof content === 'string' ? content : content?.[0]?.text;
  const summary = unwrapCompactionSummary(text);
  const pruned = messages
    .filter((message) => message.role === 'toolResult' && Array.isArray(message.content) &&
      message.content.some((block) => block.type === 'text' && /\[Resultado de [^\n]+ omitido para ahorrar contexto:/.test(block.text)))
    .map((message) => message.toolCallId);
  return { checkpoint: summary ? textDigest(summary) : null, pruned: pruned.length ? digest(pruned) : null };
}

function recordRequest(sessionId, model, context, payload, retention) {
  if (!sessionId) return null;
  const sessionHash = textDigest(sessionId).slice(0, 16);
  const key = digest([
    sessionId,
    model?.provider,
    model?.api,
    model?.baseUrl,
    model?.id,
    payload?.model,
    payload?.prompt_cache_key,
    retention,
  ]);
  const current = { ...prefixSegments(payload), ...contextChanges(context), at: Date.now() };
  const previous = sessions.get(key);
  const comparison = comparePrefixes(previous, current);
  let expectedRebuild = null;
  if (previous && comparison.break !== 'none') {
    if (current.checkpoint && current.checkpoint !== previous.checkpoint) expectedRebuild = 'compaction';
    else if (comparison.break === 'history' && current.pruned && current.pruned !== previous.pruned)
      expectedRebuild = 'tool_pruning';
  }
  sessions.delete(key);
  sessions.set(key, current);
  if (sessions.size > MAX_SCOPES) sessions.delete(sessions.keys().next().value);
  const requestHash = textDigest(`${key}:${current.systemHash}:${current.toolsHash}:${current.historyHash}`);
  const scope = key.slice(0, 16);
  emit('agent.cache_prefix', {
    session: sessionHash,
    scope,
    request_hash: requestHash.slice(0, 16),
    break: comparison.break,
    expected_rebuild: expectedRebuild,
    request_gap_ms: previous ? Math.max(0, current.at - previous.at) : null,
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
  return { session: sessionHash, scope, requestHash };
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
    scope: request.scope,
    request_hash: request.requestHash.slice(0, 16),
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    prompt,
    cache_read_percent: prompt > 0 ? Math.round((cacheRead * 1000) / prompt) / 10 : null,
  });
}

function withCacheTelemetry(api) {
  const wrap = (stream) => (model, context, options) => {
    const sessionId = options && typeof options.sessionId === 'string' ? options.sessionId : '';
    let request = null;
    const streamed = stream(model, context, {
      ...options,
      onPayload: async (payload, target) => {
        const next = options && options.onPayload ? await options.onPayload(payload, target) : undefined;
        const observed = next === undefined ? payload : next;
        try {
          request = recordRequest(sessionId, { ...model, ...target }, context, observed, options?.cacheRetention);
        } catch {
          request = null;
        }
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
          try {
            recordUsage(request, message);
          } catch {}
        }
        return message;
      };
    } catch {}
    return streamed;
  };
  return { ...api, stream: wrap(api.stream), streamSimple: wrap(api.streamSimple) };
}

module.exports = { withCacheTelemetry };
