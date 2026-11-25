'use strict';

// Plantillas portables de agentes: exporta un perfil a un paquete JSON sin
// identidad local ni estado, y valida paquetes importados antes de crearlos.
// Las credenciales nunca viajan: el modelo referencia proveedor+nombre, no llaves.

const TEMPLATE_FORMAT = 'antares-agent-template/v1';
const MAX_BUNDLE_CHARS = 64 * 1024;

const PROFILE_FIELDS = [
  'name',
  'color',
  'description',
  'role',
  'instructions',
  'soul',
  'user',
  'starter',
  'memory_scope',
  'daily_tokens',
];

// includeUser=false omite USER.md (datos del usuario) al compartir la plantilla.
function exportTemplate(profile, { includeUser = true } = {}) {
  if (!profile || typeof profile !== 'object') throw new Error('El perfil no existe');
  const bundle = { format: TEMPLATE_FORMAT, name: profile.name };
  for (const field of PROFILE_FIELDS.slice(1)) {
    if (field === 'user' && !includeUser) continue;
    if (profile[field] !== undefined) bundle[field] = profile[field];
  }
  if (Array.isArray(profile.tools)) bundle.tools = [...profile.tools];
  if (Array.isArray(profile.tools_deny) && profile.tools_deny.length) bundle.tools_deny = [...profile.tools_deny];
  if (profile.model) bundle.model = { provider: profile.model.provider, model: profile.model.model };
  return bundle;
}

function validStringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('La plantilla debe ser un objeto JSON');
  }
  if (raw.format !== TEMPLATE_FORMAT) {
    throw new Error(`Formato de plantilla no reconocido: se esperaba ${TEMPLATE_FORMAT}`);
  }
  const serialized = JSON.stringify(raw);
  if (serialized.length > MAX_BUNDLE_CHARS) throw new Error('La plantilla excede el tamaño máximo');
  const unknown = Object.keys(raw).filter(
    (key) =>
      key !== 'format' && key !== 'tools' && key !== 'tools_deny' && key !== 'model' && !PROFILE_FIELDS.includes(key),
  );
  if (unknown.length) throw new Error(`La plantilla tiene campos no reconocidos: ${unknown.join(', ')}`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('La plantilla necesita un nombre');
  for (const field of ['color', 'description', 'role', 'instructions', 'soul', 'user', 'starter', 'memory_scope']) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') throw new Error(`El campo ${field} debe ser texto`);
  }
  if (raw.daily_tokens !== undefined && raw.daily_tokens !== null && !Number.isInteger(raw.daily_tokens)) {
    throw new Error('El presupuesto diario debe ser un entero o vacío');
  }
  if (raw.tools !== undefined && !validStringList(raw.tools))
    throw new Error('Las herramientas deben ser una lista de texto');
  if (raw.tools_deny !== undefined && !validStringList(raw.tools_deny))
    throw new Error('Las herramientas bloqueadas deben ser una lista de texto');
  if (raw.model !== undefined) {
    if (
      !raw.model ||
      typeof raw.model !== 'object' ||
      typeof raw.model.provider !== 'string' ||
      typeof raw.model.model !== 'string'
    ) {
      throw new Error('El modelo debe indicar proveedor y modelo');
    }
  }
  const params = {};
  for (const field of PROFILE_FIELDS) {
    if (raw[field] !== undefined) params[field] = raw[field];
  }
  if (raw.tools !== undefined) params.tools = raw.tools;
  if (raw.tools_deny !== undefined) params.tools_deny = raw.tools_deny;
  if (raw.model !== undefined) params.model = { provider: raw.model.provider, model: raw.model.model };
  return params;
}

module.exports = { TEMPLATE_FORMAT, exportTemplate, validateTemplate };
