'use strict';

const catalog = require('../shared/agent-channels.json');

const CHANNELS = catalog.channels;
const RULES = Object.freeze(['ask', 'allow', 'deny']);
const PREFIXES = catalog.prefixes || [];

function channelFor(name, moduleId) {
  const method = String(name || '');
  if (Object.prototype.hasOwnProperty.call(catalog.methods, method)) return catalog.methods[method];
  for (const [prefix, channel] of PREFIXES) {
    if (method.startsWith(prefix)) return channel;
  }
  const module = String(moduleId || '');
  if (Object.prototype.hasOwnProperty.call(catalog.modules, module)) return catalog.modules[module];
  return catalog.default || 'other';
}

function channelLabel(channel) {
  const entry = CHANNELS[channel];
  return entry ? entry.label : CHANNELS.other.label;
}

function validateRules(raw) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Las reglas por canal no son válidas');
  const rules = {};
  for (const [channel, value] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(CHANNELS, channel) || !RULES.includes(value)) {
      throw new Error(`Regla de canal no válida: ${channel}`);
    }
    if ((channel === 'terminal' || channel === 'other') && value === 'allow') {
      throw new Error(channel === 'terminal'
        ? 'El terminal siempre requiere aprobación'
        : '«Otros» no se puede permitir en bloque; revisa sus acciones una a una');
    }
    rules[channel] = value;
  }
  return rules;
}

module.exports = { CHANNELS, RULES, channelFor, channelLabel, validateRules };
