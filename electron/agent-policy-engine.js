'use strict';

// Motor de política granular del agente. Módulo puro: sin IO, sin harness, sin bridge.
//
// Una regla con scope es { scope, value, decision } donde scope es
// path|command|domain|app|mcp y decision es allow|ask|deny. La duración la fija
// dónde se guarda la regla: PolicyDoc (persistente global), sesión (conversación)
// o memoria de turno (volátil). Una aprobación simple sin remember es el «once».
//
// Propiedades de seguridad del matching de comandos:
// - allow/ask: TODOS los segmentos del comando deben coincidir con la regla.
//   «git» no cubre «git status && rm x» porque el segundo segmento no empieza por git.
// - deny: basta que UN segmento coincida; es la dirección segura.
// - Redirección o ejecución dinámica (>, <, `, $() bloquean el match de allow/ask:
//   «git status > archivo» escribe y nunca hereda un allow de lectura.

const SCOPES = Object.freeze(['path', 'command', 'domain', 'app', 'mcp']);
const DECISIONS = Object.freeze(['allow', 'ask', 'deny']);
const MAX_SCOPED_RULES = 200;
const MAX_VALUE_CHARS = 240;

const SEGMENT_SPLIT = /&&|\|\||[;|]/;
const COMMAND_LINE_BREAKS = /[\r\n\v\f\u2028\u2029]+/g;
const DYNAMIC_OR_REDIRECT = /[`$<>]/;
const WINDOWS = process.platform === 'win32';

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCommandText(value) {
  return normalizeWhitespace(String(value || '').replace(COMMAND_LINE_BREAKS, ';'));
}

function normalizePathValue(value) {
  let out = normalizeWhitespace(value).replace(/[\\/]+/g, WINDOWS ? '\\' : '/');
  if (WINDOWS) out = out.toLowerCase();
  if (out.length > 1) out = out.replace(/[\\/]+$/, '');
  return out;
}

function isFilesystemRoot(normalized) {
  if (!normalized) return false;
  if (WINDOWS) return /^[a-z]:$/.test(normalized) || normalized === '\\\\' || normalized === '\\';
  return normalized === '/';
}

function normalizeDomainValue(value) {
  return normalizeWhitespace(value).toLowerCase().replace(/\.$/, '');
}

function normalizeCommandValue(value) {
  return normalizeCommandText(value).toLowerCase();
}

function normalizeScopeValue(scope, value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  if (scope === 'path') return normalizePathValue(raw);
  if (scope === 'domain') return normalizeDomainValue(raw);
  if (scope === 'command') return normalizeCommandValue(raw);
  if (scope === 'app') return raw.toLowerCase();
  if (scope === 'mcp') return normalizeCommandValue(raw);
  return raw;
}

function validateScopedRules(raw) {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('Las reglas con alcance deben ser una lista');
  if (raw.length > MAX_SCOPED_RULES) throw new Error(`Demasiadas reglas con alcance (máximo ${MAX_SCOPED_RULES})`);
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Regla con alcance no válida');
    const scope = String(entry.scope || '');
    const decision = String(entry.decision || '');
    if (!SCOPES.includes(scope)) throw new Error(`Alcance no válido: ${scope || 'vacío'}`);
    if (!DECISIONS.includes(decision)) throw new Error(`Decisión no válida: ${decision || 'vacía'}`);
    const value = normalizeScopeValue(scope, entry.value);
    if (!value || value.length > MAX_VALUE_CHARS) throw new Error('La regla con alcance necesita un valor acotado');
    if (decision === 'allow') validateAllowValue(scope, value);
    if (scope === 'mcp' && !/^[^\s/]+(\/[^\s/]+)?$/.test(value)) {
      throw new Error('La regla MCP usa «servidor» o «servidor/herramienta»');
    }
    const key = `${scope}:${value}`;
    if (seen.has(key)) throw new Error(`Regla duplicada: ${key}`);
    seen.add(key);
    out.push({ scope, value, decision });
  }
  return out;
}

function validateAllowValue(scope, value) {
  if (scope === 'path') {
    if (isFilesystemRoot(value) || value.length < 3) {
      throw new Error('Un permiso de ruta no puede cubrir el disco completo');
    }
    if (/[*?]/.test(value)) throw new Error('Un permiso de ruta no admite comodines');
  }
  if (scope === 'command') {
    if (!/[\p{L}\p{N}]/u.test(value)) throw new Error('Un permiso de comando necesita un comando concreto');
    if (DYNAMIC_OR_REDIRECT.test(value)) {
      throw new Error('Un permiso de comando no puede contener redirección ni ejecución dinámica');
    }
  }
  if (scope === 'domain' && (!/^[\p{L}\p{N}._-]+$/u.test(value) || value.length < 3)) {
    throw new Error('Un permiso de dominio necesita un host válido');
  }
  if (scope === 'app' && (value.length > 40 || !/[\p{L}\p{N}]/u.test(value))) {
    throw new Error('Un permiso de app necesita un alias válido');
  }
}

function extractTargets(name, args, context) {
  const tool = String(name || '');
  const params = args && typeof args === 'object' ? args : {};
  const ctx = context && typeof context === 'object' ? context : {};
  const targets = { paths: [] };
  if (tool === 'shell_run' || tool === 'shell_job_start') {
    if (typeof params.command === 'string' && params.command.trim()) targets.command = params.command;
  }
  for (const key of ['path', 'source', 'destination', 'output', 'file', 'folder']) {
    if (typeof params[key] === 'string' && params[key].trim()) targets.paths.push(params[key]);
  }
  if (Array.isArray(params.paths)) {
    for (const value of params.paths) if (typeof value === 'string' && value.trim()) targets.paths.push(value);
  }
  if (typeof ctx.domain === 'string' && ctx.domain) targets.domain = ctx.domain;
  else if (typeof params.url === 'string' && params.url.trim()) {
    const rawUrl = params.url.trim();
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    try {
      targets.domain = String(new URL(candidate).hostname || '')
        .toLowerCase()
        .replace(/\.$/, '');
    } catch {}
  }
  const computer = ctx.computer && typeof ctx.computer === 'object' ? ctx.computer : null;
  if (computer && typeof computer.app === 'string' && computer.app.trim())
    targets.app = computer.app.trim().toLowerCase();
  else if (typeof params.app === 'string' && params.app.trim()) targets.app = params.app.trim().toLowerCase();
  const mcpBody = tool.startsWith('mcp2__') ? tool.slice(6) : tool.startsWith('mcp__') ? tool.slice(5) : '';
  if (mcpBody) {
    if (ctx && typeof ctx.mcp_server === 'string' && ctx.mcp_server.trim()) {
      // Los alias mcp2 llevan hashes irreversibles; la identidad real del
      // servidor y la herramienta llega en el spec anunciado por el backend.
      targets.mcp_server = ctx.mcp_server.trim().toLowerCase();
      if (typeof ctx.mcp_tool === 'string' && ctx.mcp_tool.trim()) targets.mcp_tool = ctx.mcp_tool.trim().toLowerCase();
    } else {
      const sep = mcpBody.indexOf('__');
      if (sep > 0) {
        targets.mcp_server = mcpBody.slice(0, sep).toLowerCase();
        targets.mcp_tool = mcpBody.slice(sep + 2).toLowerCase();
      }
    }
  }
  return targets;
}

function segmentsOf(command) {
  return normalizeCommandText(command)
    .split(SEGMENT_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
}

function tokensOf(text) {
  return normalizeCommandValue(text).split(' ').filter(Boolean);
}

function segmentMatches(ruleTokens, segment) {
  const segmentTokens = tokensOf(segment);
  if (!segmentTokens.length || ruleTokens.length > segmentTokens.length) return false;
  return ruleTokens.every((token, index) => segmentTokens[index] === token);
}

function commandMatches(rule, command, strict) {
  const value = normalizeCommandValue(rule);
  const text = normalizeCommandText(command);
  if (!value || !text) return false;
  const ruleTokens = tokensOf(value);
  if (!ruleTokens.length) return false;
  if (strict && DYNAMIC_OR_REDIRECT.test(text)) return false;
  const segments = segmentsOf(text);
  if (!segments.length) return false;
  if (strict) return segments.every((segment) => segmentMatches(ruleTokens, segment));
  return segments.some((segment) => segmentMatches(ruleTokens, segment));
}

function pathMatches(rule, target) {
  const rulePath = normalizePathValue(rule);
  const targetPath = normalizePathValue(target);
  if (!rulePath || !targetPath) return false;
  if (targetPath === rulePath) return true;
  const separator = WINDOWS ? '\\' : '/';
  return targetPath.startsWith(rulePath + separator);
}

function domainMatches(rule, target) {
  const ruleDomain = normalizeDomainValue(rule);
  const targetDomain = normalizeDomainValue(target);
  if (!ruleDomain || !targetDomain) return false;
  return targetDomain === ruleDomain || targetDomain.endsWith(`.${ruleDomain}`);
}

function mcpMatches(rule, targets) {
  const value = normalizeCommandValue(rule);
  if (!value || !targets.mcp_server) return false;
  const slash = value.indexOf('/');
  if (slash === -1) return targets.mcp_server === value;
  return targets.mcp_server === value.slice(0, slash) && targets.mcp_tool === value.slice(slash + 1);
}

function specificity(rule, targets) {
  if (rule.scope === 'command') {
    if (!targets.command) return 0;
    const strict = rule.decision !== 'deny';
    return commandMatches(rule.value, targets.command, strict) ? tokensOf(rule.value).length : 0;
  }
  if (rule.scope === 'path') {
    let best = 0;
    for (const target of targets.paths || []) {
      if (pathMatches(rule.value, target)) best = Math.max(best, normalizePathValue(rule.value).length);
    }
    return best;
  }
  if (rule.scope === 'domain')
    return targets.domain && domainMatches(rule.value, targets.domain) ? normalizeDomainValue(rule.value).length : 0;
  if (rule.scope === 'app') return targets.app && targets.app === String(rule.value).toLowerCase() ? 1 : 0;
  if (rule.scope === 'mcp') return mcpMatches(rule.value, targets) ? (String(rule.value).includes('/') ? 2 : 1) : 0;
  return 0;
}

function evaluateScoped(rules, targets) {
  if (!Array.isArray(rules) || !rules.length || !targets) return null;
  let deny = null;
  let ask = null;
  let allow = null;
  for (const rule of rules) {
    if (!rule || !SCOPES.includes(rule.scope) || !DECISIONS.includes(rule.decision)) continue;
    const score = specificity(rule, targets);
    if (!score) continue;
    const match = { rule, score };
    if (rule.decision === 'deny' && (!deny || score >= deny.score)) deny = match;
    else if (rule.decision === 'ask' && (!ask || score >= ask.score)) ask = match;
    else if (rule.decision === 'allow' && (!allow || score >= allow.score)) allow = match;
  }
  // Precedencia: deny gana siempre; ask fuerza revisión manual; allow es lo más específico restante.
  if (deny) return { decision: 'deny', rule: deny.rule, reason: describeRule(deny.rule) };
  if (ask) return { decision: 'ask', rule: ask.rule, reason: describeRule(ask.rule) };
  if (allow) return { decision: 'allow', rule: allow.rule, reason: describeRule(allow.rule) };
  return null;
}

function describeRule(rule) {
  const labels = { path: 'ruta', command: 'comando', domain: 'dominio', app: 'app', mcp: 'herramienta MCP' };
  return `${labels[rule.scope] || rule.scope} «${rule.value}»`;
}

const turnRules = new Map();

function addTurnRule(conversationId, rule) {
  const key = String(conversationId || '');
  if (!key) return;
  const list = turnRules.get(key) || [];
  list.push(rule);
  turnRules.set(key, list.slice(-50));
}

function turnRulesFor(conversationId) {
  return turnRules.get(String(conversationId || '')) || [];
}

function clearTurnRules(conversationId) {
  turnRules.delete(String(conversationId || ''));
}

module.exports = {
  SCOPES,
  DECISIONS,
  MAX_SCOPED_RULES,
  validateScopedRules,
  normalizeScopeValue,
  extractTargets,
  evaluateScoped,
  commandMatches,
  pathMatches,
  domainMatches,
  addTurnRule,
  turnRulesFor,
  clearTurnRules,
};
