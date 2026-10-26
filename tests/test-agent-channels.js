'use strict';

const { assert, finish } = require('./helpers/harness');
const { CHANNELS, channelFor, channelLabel, validateRules } = require('../electron/agent-channels');
const channels = require('../shared/agent-channels.json');
const catalog = require('../shared/ipc-method-catalog.json');

try {
  assert(channelFor('shell_run', 'computer') === 'terminal', 'shell_run pertenece al terminal');
  assert(channelFor('fs_write', 'computer') === 'files', 'fs_write pertenece a archivos');
  assert(channelFor('fs_read', 'computer') === 'files', 'las lecturas comparten canal sin regla');
  assert(channelFor('desktop_click', 'computer') === 'desktop', 'el escritorio tiene su canal');
  assert(channelFor('web_click', 'computer') === 'desktop', 'el navegador comparte canal con el escritorio');
  assert(channelFor('gdrive_upload', 'connections') === 'cloud', 'las conexiones caen en nube');
  assert(channelFor('mcp__srv__do', null) === 'mcp' && channelFor('mcp2__srv-0123456789ab__do-0123456789ab', null) === 'mcp',
    'MCP tiene su propio canal, también con los nombres actuales mcp2__');
  assert(channelFor('document_generate', 'documents') === 'documents', 'los documentos tienen su canal');
  assert(channelFor('memory_remember', 'agent') === 'memory', 'la memoria tiene su canal');
  assert(channelFor('task_schedule', 'agent') === 'agenda', 'la agenda tiene su canal');
  assert(channelFor('metodo_nuevo', 'conversion') === 'other', 'un método desconocido cae en otros');
  assert(channelLabel('cloud') === CHANNELS.cloud.label, 'la etiqueta sale del catálogo compartido');

  assert(JSON.stringify(validateRules(null)) === '{}', 'sin reglas no cambia nada');
  assert(JSON.stringify(validateRules({ files: 'allow', terminal: 'ask' })) === '{"files":"allow","terminal":"ask"}',
    'se aceptan reglas válidas');
  assert(throws(() => validateRules({ terminal: 'allow' })), 'el terminal nunca se auto-permite');
  assert(throws(() => validateRules({ other: 'allow' })), '«Otros» no se puede permitir en bloque');
  assert(throws(() => validateRules({ files: 'nope' })), 'un valor desconocido se rechaza');
  assert(throws(() => validateRules({ nope: 'ask' })), 'un canal desconocido se rechaza');
  assert(throws(() => validateRules([])), 'una lista no es un mapa de reglas');

  for (const channel of new Set([
    ...Object.values(channels.methods),
    ...channels.prefixes.map(([, value]) => value),
    ...Object.values(channels.modules),
  ])) {
    assert(!!CHANNELS[channel], `el canal declarado ${channel} existe en el catálogo`);
  }
  const ruleProps = catalog.methods.agent_session_rules_set.inputSchema.properties.rules.properties;
  assert(JSON.stringify(Object.keys(ruleProps).sort()) === JSON.stringify(Object.keys(CHANNELS).sort()),
    'el esquema IPC de reglas cubre exactamente los canales del catálogo');
  assert(JSON.stringify(ruleProps.other.enum) === '["ask","deny"]', 'el esquema también prohíbe permitir «Otros»');
  finish();
} catch (err) {
  console.error(err);
  process.exit(1);
}

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
