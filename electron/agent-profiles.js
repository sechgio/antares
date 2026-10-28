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

// Hooks declarativos: solo contexto y registro, nunca comandos ni permisos.
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
    if (!Array.isArray(raw.tools) || raw.tools.length === 0 || raw.tools.length > 32
      || raw.tools.some((tool) => typeof tool !== 'string' || !/^[a-z0-9_]+$/.test(tool))) {
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
  const skills = loadSkills(path.join(root, '_shared', 'skills'), root);
  for (const [name, skill] of loadSkills(path.join(directory, 'skills'), directory)) skills.set(name, skill);
  if (skills.size > MAX_SKILLS) throw new Error(`${directory}: supera el máximo de 256 skills`);
  return {
    name: metadata.name, slug, model: metadata.model, description: metadata.description,
    instructions: [baseInstructions, instructions].filter(Boolean).join('\n\n'),
    skills, hooks: loadHooks(directory, directory),
  };
}

function resolvePortableProfile(registry, conversationId) {
  const entry = registry.get(conversationId);
  if (!entry) return null;
  if (entry.kind === 'loaded') return entry.profile;
  const profile = loadAgentProfile(entry.slug);
  registry.set(conversationId, { kind: 'loaded', profile });
  return profile;
}

module.exports = { loadAgentProfile, resolvePortableProfile };
