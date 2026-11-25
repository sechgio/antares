'use strict';

// Proxy MCP: cuando un servidor o el catálogo completo superan el umbral, sus esquemas no se
// inyectan al modelo; mcp_search consulta el catálogo cacheado y mcp_call valida y despacha la
// herramienta real con el mismo gating que una llamada directa.

const MCP_SEARCH = 'mcp_search';
const MCP_CALL = 'mcp_call';
const META = new Set([MCP_SEARCH, MCP_CALL]);
const DEFAULT_PER_SERVER = 40;
const DEFAULT_TOTAL = 128;
const MAX_RESULTS = 8;
const MAX_DESCRIPTION = 240;
const MAX_PROPERTY_DESCRIPTION = 120;

function limit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function thresholds() {
  return {
    perServer: limit('ANTARES_MCP_PROXY_PER_SERVER', DEFAULT_PER_SERVER),
    total: limit('ANTARES_MCP_PROXY_TOTAL', DEFAULT_TOTAL),
  };
}

function isMcp(spec) {
  return !!spec && typeof spec.mcp_server === 'string' && typeof spec.mcp_tool === 'string';
}

function normal(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function proxiedServers(specs) {
  const { perServer, total } = thresholds();
  const counts = new Map();
  for (const spec of specs) if (isMcp(spec)) counts.set(spec.mcp_server, (counts.get(spec.mcp_server) || 0) + 1);
  if (specs.length > total) return new Set(counts.keys());
  return new Set([...counts].filter(([, count]) => count > perServer).map(([server]) => server));
}

const SPECS = [
  {
    name: MCP_SEARCH,
    description:
      'MCP · mcp_search (sin efectos): busca por nombre y descripción en el catálogo de herramientas MCP conectadas que ' +
      'no están cargadas y devuelve las mejores con su esquema resumido. Úsala antes de mcp_call; para una herramienta ' +
      'que usarás varias veces, cárgala con tools_load y names.',
    gated: false,
    kind: 'meta',
    module: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Qué necesitas hacer o el nombre de la herramienta',
        },
        server: { type: 'string', description: 'Nombre del servidor MCP para limitar la búsqueda' },
      },
      required: ['query'],
    },
  },
  {
    name: MCP_CALL,
    description:
      'MCP · mcp_call (efecto: requiere aprobación del usuario): llama a una herramienta MCP encontrada con mcp_search. ' +
      'Los argumentos se validan contra su esquema real y la llamada pasa por los mismos permisos y aprobaciones que una directa.',
    gated: true,
    kind: 'meta',
    module: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', minLength: 1, description: 'Servidor MCP devuelto por mcp_search' },
        tool: { type: 'string', minLength: 1, description: 'Nombre de la herramienta devuelto por mcp_search' },
        args: { type: 'object', description: 'Argumentos según el esquema de la herramienta' },
      },
      required: ['server', 'tool'],
    },
  },
];

function summarize(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const properties = {};
  for (const [key, value] of Object.entries(schema.properties || {})) {
    const item = value && typeof value === 'object' ? value : {};
    properties[key] = {
      ...(item.type !== undefined ? { type: item.type } : {}),
      ...(Array.isArray(item.enum) ? { enum: item.enum.slice(0, 12) } : {}),
      ...(item.description ? { description: String(item.description).slice(0, MAX_PROPERTY_DESCRIPTION) } : {}),
    };
  }
  return {
    type: 'object',
    properties,
    ...(Array.isArray(schema.required) && schema.required.length ? { required: schema.required } : {}),
  };
}

function search(specs, args = {}) {
  const query = normal(args.query).trim();
  const words = query.split(/[^a-z0-9]+/).filter((word) => word.length > 1);
  const server = typeof args.server === 'string' && args.server.trim() ? normal(args.server.trim()) : '';
  const scored = specs
    .filter((spec) => isMcp(spec) && (!server || normal(spec.mcp_server) === server))
    .map((spec) => {
      const name = normal(spec.mcp_tool);
      const description = normal(spec.description);
      const score = words.reduce(
        (total, word) => total + (name.includes(word) ? 3 : 0) + (description.includes(word) ? 1 : 0),
        name === query ? 10 : 0,
      );
      return [spec, score];
    })
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))
    .slice(0, MAX_RESULTS);
  return {
    results: scored.map(([spec]) => ({
      server: spec.mcp_server,
      tool: spec.mcp_tool,
      name: spec.name,
      description: String(spec.description || '').slice(0, MAX_DESCRIPTION),
      input_schema: summarize(spec.inputSchema),
    })),
    ...(scored.length
      ? { next: 'Llama a mcp_call con server, tool y args, o carga las que repetirás con tools_load y names' }
      : { note: 'Sin coincidencias; prueba otras palabras o quita server' }),
  };
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Validación JSON Schema acotada a las palabras clave estructurales; el servidor MCP valida el resto.
function validate(schema, value, at = 'args') {
  if (!schema || typeof schema !== 'object') return null;
  const actual = typeOf(value);
  const types = schema.type === undefined ? [] : [].concat(schema.type);
  if (types.length && !types.some((type) => type === actual || (type === 'number' && actual === 'integer'))) {
    return `${at} debe ser ${types.join(' o ')}`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => same(option, value))) {
    return `${at} debe ser uno de ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`;
  }
  if (schema.const !== undefined && !same(schema.const, value)) return `${at} debe ser ${JSON.stringify(schema.const)}`;
  if (actual === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength)
      return `${at} necesita al menos ${schema.minLength} caracteres`;
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength)
      return `${at} admite hasta ${schema.maxLength} caracteres`;
  }
  if (actual === 'integer' || actual === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${at} debe ser ≥ ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${at} debe ser ≤ ${schema.maximum}`;
  }
  if (actual === 'array') {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems)
      return `${at} necesita al menos ${schema.minItems} elementos`;
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems)
      return `${at} admite hasta ${schema.maxItems} elementos`;
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      for (let index = 0; index < value.length; index += 1) {
        const problem = validate(schema.items, value[index], `${at}[${index}]`);
        if (problem) return problem;
      }
    }
  }
  if (actual === 'object') {
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return `falta ${at}.${key}`;
    }
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        const problem = validate(properties[key], item, `${at}.${key}`);
        if (problem) return problem;
      } else if (schema.additionalProperties === false) {
        return `${at}.${key} no está permitido`;
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const problem = validate(schema.additionalProperties, item, `${at}.${key}`);
        if (problem) return problem;
      }
    }
  }
  return null;
}

function resolveCall(specs, args) {
  const server = typeof args?.server === 'string' ? args.server.trim() : '';
  const tool = typeof args?.tool === 'string' ? args.tool.trim() : '';
  if (!server || !tool) return { error: 'mcp_call necesita server y tool; búscalos con mcp_search' };
  const candidates = specs.filter((spec) => isMcp(spec) && spec.mcp_tool === tool);
  const exact = candidates.filter((spec) => spec.mcp_server === server);
  const matches = exact.length ? exact : candidates.filter((spec) => normal(spec.mcp_server) === normal(server));
  if (!matches.length) return { error: `No hay una herramienta MCP «${tool}» en «${server}»; búscala con mcp_search` };
  if (matches.length > 1) return { error: `Hay varios servidores MCP llamados «${server}»; desconecta o renombra uno` };
  const callArgs = args.args === undefined ? {} : args.args;
  const schema = matches[0].inputSchema && typeof matches[0].inputSchema === 'object' ? matches[0].inputSchema : {};
  const problem = validate({ ...schema, type: 'object' }, callArgs);
  if (problem) {
    return { error: `Argumentos inválidos para ${server}/${tool}: ${problem}. Revisa su esquema con mcp_search` };
  }
  return { spec: matches[0], args: callArgs };
}

// Origen del resultado: el servidor de la llamada, o el pedido a mcp_search («catalogo» si buscó en todos).
function origin(args) {
  const server = typeof args?.server === 'string' && args.server.trim() ? args.server.trim() : 'catalogo';
  return `mcp:${server}`;
}

module.exports = {
  MCP_SEARCH,
  MCP_CALL,
  META,
  SPECS,
  thresholds,
  isMcp,
  proxiedServers,
  search,
  validate,
  resolveCall,
  origin,
};
