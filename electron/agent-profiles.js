'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const yaml = require('js-yaml');

const MAX_FILE_BYTES = 64 * 1024;
const MAX_SKILLS = 256;
const RESULT_BUDGET = 5600;

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
    skills,
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

function fitSkillList(result) {
  while (JSON.stringify(result).length > RESULT_BUDGET) {
    const candidates = Object.keys(result).filter((key) =>
      (typeof result[key] === 'string' || Array.isArray(result[key])) && result[key].length);
    if (!candidates.length) throw new Error('El resultado de skills excede 5600 caracteres');
    const key = candidates.reduce((largest, current) =>
      JSON.stringify(result[current]).length > JSON.stringify(result[largest]).length ? current : largest);
    result[key] = result[key].slice(0, Math.floor(result[key].length / 2));
    result.truncated = true;
  }
  return result;
}

function listProfileSkills(profile, params = {}) {
  const { query = '', limit = 8 } = params;
  if (typeof query !== 'string' || query.length > 200) throw new Error('La búsqueda de skills admite hasta 200 caracteres');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('El límite debe estar entre 1 y 20');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [...profile.skills.values()].filter((skill) =>
    words.every((word) => `${skill.name} ${skill.description}`.toLowerCase().includes(word)));
  return fitSkillList({
    skills: matches.slice(0, limit).map(({ content, ...metadata }) => ({ ...metadata, description: metadata.description.slice(0, 240) })),
    total: matches.length, truncated: matches.length > limit,
  });
}

function mergeProfileSkills(profile, params, text) {
  let base;
  try { base = JSON.parse(text); } catch { return text; }
  if (!base || !Array.isArray(base.skills) || !Number.isInteger(base.total)) return text;
  const local = listProfileSkills(profile, params);
  const skills = [...local.skills, ...base.skills].slice(0, params?.limit ?? 8);
  const total = local.total + base.total;
  return JSON.stringify(fitSkillList({ ...base, skills, total,
    truncated: !!(local.truncated || base.truncated || skills.length < total) }));
}

function readProfileSkill(profile, params = {}) {
  const skill = [...profile.skills.values()].find((item) => item.id === params.skill_id);
  if (!skill) throw new Error('Skill no encontrada en el perfil; consulta skills_list');
  const { file_path: relative = 'SKILL.md', offset = 0 } = params;
  if (typeof relative !== 'string' || !relative || relative.length > 240 || /[:\0]/.test(relative)
    || path.isAbsolute(relative) || relative.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error('El archivo debe ser una ruta relativa dentro de la skill');
  }
  if (!Number.isInteger(offset) || offset < 0) throw new Error('El offset debe ser un entero no negativo');
  const directory = path.dirname(skill.location);
  const content = relative === 'SKILL.md' ? skill.content : readText(path.join(directory, relative), directory);
  let end = Math.min(content.length, offset + 4000);
  const result = {
    id: skill.id, name: skill.name, file_path: relative, content: content.slice(offset, end),
    offset, total_chars: content.length, next_offset: end < content.length ? end : null,
  };
  while (JSON.stringify(result).length > RESULT_BUDGET) {
    end = offset + Math.floor((end - offset) * 3 / 4);
    result.content = content.slice(offset, end);
    result.next_offset = end < content.length ? end : null;
  }
  return result;
}

module.exports = { loadAgentProfile, resolvePortableProfile, listProfileSkills, mergeProfileSkills, readProfileSkill };
