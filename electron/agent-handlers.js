'use strict';

// Dispatch `native:agent`: los diez métodos públicos agent_* corren sobre el
// runtime durable del proceso principal (electron/agent-runtime.js).

const AGENT_METHODS = new Set([
  'agent_sessions_list',
  'agent_session_create',
  'agent_session_delete',
  'agent_messages_list',
  'agent_message_send',
  'agent_tools_list',
  'agent_turn_status',
  'agent_turn_cancel',
  'agent_approve',
  'agent_deny',
]);

async function handleAgentCall(method, params) {
  const runtime = require('./agent-runtime');
  await runtime.open();
  const handler = runtime.handlers[method];
  if (!handler) throw new Error(`Método de agente no soportado: ${method}`);
  return { handled: true, result: await handler(params || {}) };
}

module.exports = { AGENT_METHODS, handleAgentCall };
