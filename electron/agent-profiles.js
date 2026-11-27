'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const yaml = require('js-yaml');

const MAX_FILE_BYTES = 64 * 1024;
const MAX_SKILLS = 256;
const MAX_HOOKS = 32;
const MAX_HOOK_CONTEXT = 2000;
const MAX_HOOK_TOTAL = 8000;
const MAX_IDENTITY_CHARS = 4000;
const MAX_USER_CHARS = 4000;
const ONBOARDING_SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|bearer\s+[A-Za-z0-9._~+/-]{16,}|(?:password|contraseña|clave|api[_ -]?key|token|secret)\s*[:=]\s*\S+)/i;
const HOOK_EVENTS = new Set(['subagentStart', 'subagentStop', 'preToolUse', 'postToolUse']);
const HOOK_TOOL_EVENTS = new Set(['preToolUse', 'postToolUse']);

function readText(file, root) {
  try {
    const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error('La ruta sale de la carpeta del perfil');
    }
    const handle = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = fs.readSync(handle, buffer, size, buffer.length - size, null);
        if (!read) break;
        size += read;
      }
      if (size > MAX_FILE_BYTES) throw new Error('El archivo excede 64 KiB');
      const content = buffer.subarray(0, size);
      if (!isUtf8(content)) throw new Error('El archivo debe ser texto UTF-8');
      return content.toString('utf8').replace(/^\uFEFF/, '');
    } finally {
      fs.closeSync(handle);
    }
  } catch (error) {
    throw new Error(`No se puede leer ${file}: ${error.message}`);
  }
}

// SOUL.md (personalidad y tono), IDENTITY.md (identidad acordada) y USER.md (preferencias estables) son opcionales.
function optionalText(file, root) {
  if (!fs.existsSync(file)) return '';
  const text = readText(file, root).trim();
  if (text.length > MAX_IDENTITY_CHARS) throw new Error(`${file}: excede ${MAX_IDENTITY_CHARS} caracteres`);
  return text;
}

function requiredText(value, field, file) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${file}: falta un ${field} de texto no vacío`);
  }
  return value;
}

function loadSkills(directory, root) {
  let handle;
  try {
    handle = fs.opendirSync(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw new Error(`No se puede leer ${directory}: ${error.message}`);
  }
  const entries = [];
  try {
    let entry;
    while ((entry = handle.readSync())) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      entries.push(entry);
      if (entries.length > MAX_SKILLS) throw new Error(`${directory}: supera el máximo de 256 skills`);
    }
  } finally {
    handle.closeSync();
  }
  const skills = new Map();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name, 'SKILL.md');
    const content = readText(file, root);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match) throw new Error(`${file}: falta frontmatter YAML con name y description`);
    if (match[1].length > 8192) throw new Error(`${file}: el frontmatter excede 8192 caracteres`);
    let metadata;
    try {
      metadata = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
    } catch (error) {
      throw new Error(`${file}: frontmatter YAML inválido: ${error.message}`);
    }
    const name = requiredText(metadata?.name, 'name', file);
    const description = requiredText(metadata?.description, 'description', file);
    if (name.length > 64) throw new Error(`${file}: name excede 64 caracteres`);
    if (description.length > 1024) throw new Error(`${file}: description excede 1024 caracteres`);
    if (skills.has(name)) throw new Error(`${file}: name de skill duplicado: ${name}`);
    skills.set(name, { id: `profile:${name}`, name, description, location: file, content });
  }
  return skills;
}

function loadHooks(directory, root) {
  const file = path.join(directory, 'hooks.json');
  if (!fs.existsSync(file)) return [];
  let document;
  try {
    document = JSON.parse(readText(file, root));
  } catch (error) {
    throw new Error(`${file}: JSON inválido: ${error.message}`);
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`${file}: se espera un objeto con «hooks»`);
  }
  const extra = Object.keys(document).find((key) => key !== 'hooks');
  if (extra) throw new Error(`${file}: campo no admitido: ${extra}`);
  if (!Array.isArray(document.hooks)) throw new Error(`${file}: falta una lista «hooks»`);
  if (document.hooks.length > MAX_HOOKS) throw new Error(`${file}: supera el máximo de ${MAX_HOOKS} hooks`);
  let total = 0;
  return document.hooks.map((raw, index) => {
    const label = `${file}: hook ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label}: se espera un objeto`);
    const unknown = Object.keys(raw).find((key) => !['event', 'context', 'tools'].includes(key));
    if (unknown) throw new Error(`${label}: campo no admitido: ${unknown}`);
    if (!HOOK_EVENTS.has(raw.event)) {
      throw new Error(`${label}: event debe ser subagentStart, subagentStop, preToolUse o postToolUse`);
    }
    if (typeof raw.context !== 'string' || !raw.context.trim()) {
      throw new Error(`${label}: falta un context de texto no vacío`);
    }
    const context = raw.context.trim();
    if (context.length > MAX_HOOK_CONTEXT) throw new Error(`${label}: context excede ${MAX_HOOK_CONTEXT} caracteres`);
    total += context.length;
    if (total > MAX_HOOK_TOTAL) throw new Error(`${file}: el texto de los hooks excede ${MAX_HOOK_TOTAL} caracteres`);
    if (raw.tools === undefined) return { event: raw.event, context };
    if (!HOOK_TOOL_EVENTS.has(raw.event)) throw new Error(`${label}: tools solo se admite en preToolUse y postToolUse`);
    if (
      !Array.isArray(raw.tools) ||
      raw.tools.length === 0 ||
      raw.tools.length > 32 ||
      raw.tools.some((tool) => typeof tool !== 'string' || !/^[a-z0-9_]+$/.test(tool))
    ) {
      throw new Error(`${label}: tools debe ser una lista de nombres de herramienta`);
    }
    return { event: raw.event, context, tools: [...new Set(raw.tools)] };
  });
}

function loadAgentProfile(slug, baseInstructions = '') {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    throw new Error('Slug de agente inválido: usa el nombre de su carpeta, sin rutas');
  }
  const root = path.resolve(process.env.AGENTS_HOME || './agents');
  const directory = path.join(root, slug);
  const file = path.join(directory, 'agent.json');
  let metadata;
  const json = readText(file, root);
  try {
    metadata = JSON.parse(json);
  } catch (error) {
    throw new Error(`${file}: JSON inválido: ${error.message}`);
  }
  for (const field of ['name', 'slug', 'model', 'description']) {
    requiredText(metadata?.[field], field, file);
  }
  if (metadata.slug !== slug) {
    throw new Error(`${file}: el slug «${metadata.slug}» no coincide con la carpeta «${slug}»`);
  }
  const instructions = readText(path.join(directory, 'AGENTS.md'), directory);
  const soul = optionalText(path.join(directory, 'SOUL.md'), directory);
  const identity = optionalText(path.join(directory, 'IDENTITY.md'), directory);
  const user = optionalText(path.join(directory, 'USER.md'), directory);
  const skills = loadSkills(path.join(root, '_shared', 'skills'), root);
  for (const [name, skill] of loadSkills(path.join(directory, 'skills'), directory)) skills.set(name, skill);
  if (skills.size > MAX_SKILLS) throw new Error(`${directory}: supera el máximo de 256 skills`);
  return {
    name: metadata.name,
    slug,
    model: metadata.model,
    description: metadata.description,
    instructions: [baseInstructions, instructions].filter(Boolean).join('\n\n'),
    ...(soul ? { soul } : {}),
    ...(identity ? { identity } : {}),
    ...(user ? { user } : {}),
    skills,
    hooks: loadHooks(directory, directory),
    ...(Number.isFinite(metadata.onboarded_at) ? { onboarded_at: metadata.onboarded_at } : {}),
  };
}

function inlineText(value, label, max) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error('Falta ' + label);
  if (text.length > max) throw new Error(label + ' excede ' + max + ' caracteres');
  if (ONBOARDING_SECRET_RE.test(text)) throw new Error(label + ' parece contener un secreto');
  return text;
}

function validateOnboarding(params = {}) {
  if (params.confirmed !== true) throw new Error('El usuario debe confirmar explícitamente antes de guardar');
  const raw = params.identity;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('identity debe ser un objeto');
  const identity = {
    name: inlineText(raw.name, 'el nombre del agente', 80),
    role: inlineText(raw.role, 'el rol del agente', 160),
    tone: inlineText(raw.tone, 'el tono del agente', 240),
    ...(raw.avatar ? { avatar: inlineText(raw.avatar, 'el avatar del agente', 32) } : {}),
  };
  const user = String(params.user || '').trim();
  if (!user) throw new Error('Faltan las preferencias del usuario');
  if (user.length > MAX_USER_CHARS) throw new Error('USER.md excede ' + MAX_USER_CHARS + ' caracteres');
  if (ONBOARDING_SECRET_RE.test(user)) throw new Error('USER.md parece contener un secreto');
  const lines = [
    '# Identidad del agente',
    '',
    '- Nombre: ' + identity.name,
    '- Rol: ' + identity.role,
    '- Tono: ' + identity.tone,
    ...(identity.avatar ? ['- Avatar: ' + identity.avatar] : []),
    '',
  ];
  return { identityMarkdown: lines.join('\n'), userMarkdown: user + '\n' };
}

function writeTextAtomic(file, content) {
  const temporary = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function savePortableOnboarding(slug, data) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new Error('Slug de agente inválido');
  const root = path.resolve(process.env.AGENTS_HOME || './agents');
  const directory = path.join(root, slug);
  const file = path.join(directory, 'agent.json');
  const metadata = JSON.parse(readText(file, root));
  writeTextAtomic(path.join(directory, 'IDENTITY.md'), data.identityMarkdown);
  writeTextAtomic(path.join(directory, 'USER.md'), data.userMarkdown);
  metadata.onboarded_at = Date.now();
  writeTextAtomic(file, JSON.stringify(metadata, null, 2) + '\n');
  return metadata.onboarded_at;
}

function markPortableOnboarded(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new Error('Slug de agente inválido');
  const root = path.resolve(process.env.AGENTS_HOME || './agents');
  const directory = path.join(root, slug);
  const file = path.join(directory, 'agent.json');
  const metadata = JSON.parse(readText(file, root));
  if (!Number.isFinite(metadata.onboarded_at)) {
    metadata.onboarded_at = Date.now();
    writeTextAtomic(file, JSON.stringify(metadata, null, 2) + '\n');
  }
  return metadata.onboarded_at;
}

async function saveSessionOnboarding(sessionId, params) {
  const data = validateOnboarding(params);
  const { shared, sessions, ctx } = require('./agent-shared');
  const session = (await sessions())[String(sessionId || '')];
  if (!session || !session.profile || !session.profile.id) throw new Error('Esta conversación no tiene un agente de perfil');
  if (session.profile.portable) {
    const onboardedAt = savePortableOnboarding(session.profile.id, data);
    return { saved: true, onboarded_at: onboardedAt };
  }
  let onboardedAt = 0;
  const saved = await shared.state.harness.commit(async (tx) => {
    const doc = await tx.doc(shared.state.ProfilesDoc);
    const profile = doc.profiles[session.profile.id];
    if (!profile) return false;
    onboardedAt = Date.now();
    profile.identity = data.identityMarkdown;
    profile.user = data.userMarkdown;
    profile.onboarded_at = onboardedAt;
    profile.updated_at = onboardedAt;
    return true;
  }, ctx());
  if (!saved) throw new Error('El agente ya no existe');
  return { saved: true, onboarded_at: onboardedAt };
}

function resolvePortableProfile(registry, conversationId) {
  const entry = registry.get(conversationId);
  if (!entry) return null;
  if (entry.kind === 'loaded') return entry.profile;
  const profile = loadAgentProfile(entry.slug);
  registry.set(conversationId, { kind: 'loaded', profile });
  return profile;
}

// Destino de un encargo dirigido: perfil guardado por id o nombre único, o el
// perfil de una sesión viva (cubre agentes portables). Devuelve la sesión viva
// más reciente del perfil destino: el encargo corre con las reglas, tools y
// permisos de esa conversación y nada del perfil origen se hereda.
async function resolveTargetSession(agent) {
  const { sessions, profiles, validation } = require('./agent-shared');
  const wanted = String(agent || '').trim();
  if (!wanted) throw validation('Indica el agente destino del encargo');
  const saved = await profiles();
  const exact = saved[wanted] || null;
  const named = Object.values(saved).filter(
    (profile) => String(profile.name || '').trim().toLowerCase() === wanted.toLowerCase(),
  );
  const profileId = exact ? exact.id : named.length === 1 ? named[0].id : null;
  const live = Object.values(await sessions()).filter((item) => !item.deleted && item.profile);
  let candidates;
  if (profileId) {
    candidates = live.filter((item) => item.profile.id === profileId);
  } else {
    if (named.length > 1) throw validation(`«${wanted}» coincide con varios agentes; usa su identificador`);
    candidates = live.filter(
      (item) =>
        item.profile.id === wanted ||
        String(item.profile.name || '').trim().toLowerCase() === wanted.toLowerCase(),
    );
    if (new Set(candidates.map((item) => item.profile.id)).size > 1) {
      throw validation(`«${wanted}» coincide con varios agentes; usa su identificador`);
    }
    if (!candidates.length) throw validation(`No se encontró un agente único con esa referencia: «${wanted}»`);
  }
  const target = candidates
    .slice()
    .sort((a, b) => (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0))[0];
  if (!target) {
    throw validation(`El agente «${(exact || named[0] || {}).name || wanted}» no tiene una conversación abierta`);
  }
  return target;
}

module.exports = {
  loadAgentProfile,
  resolvePortableProfile,
  saveSessionOnboarding,
  validateOnboarding,
  markPortableOnboarded,
  savePortableOnboarding,
  resolveTargetSession,
};
