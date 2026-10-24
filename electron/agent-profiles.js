'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

function readText(file, root) {
  try {
    const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error('La ruta sale de la carpeta del perfil');
    }
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
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
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw new Error(`No se puede leer ${directory}: ${error.message}`);
  }
  const skills = new Map();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name, 'SKILL.md');
    const content = readText(file, root);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match) throw new Error(`${file}: falta frontmatter YAML con name y description`);
    let metadata;
    try {
      metadata = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
    } catch (error) {
      throw new Error(`${file}: frontmatter YAML inválido: ${error.message}`);
    }
    const name = requiredText(metadata?.name, 'name', file);
    const description = requiredText(metadata?.description, 'description', file);
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
  return {
    name: metadata.name, slug, model: metadata.model, description: metadata.description,
    instructions: [baseInstructions, instructions].filter(Boolean).join('\n\n'),
    skills,
  };
}

function listProfileSkills(profile, params = {}) {
  const { query = '', limit = 8 } = params;
  if (typeof query !== 'string' || query.length > 200) throw new Error('La búsqueda de skills admite hasta 200 caracteres');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('El límite debe estar entre 1 y 20');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [...profile.skills.values()].filter((skill) =>
    words.every((word) => `${skill.name} ${skill.description}`.toLowerCase().includes(word)));
  return {
    skills: matches.slice(0, limit).map(({ content, ...metadata }) => metadata),
    total: matches.length, truncated: matches.length > limit,
  };
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
  const end = Math.min(content.length, offset + 4000);
  return {
    id: skill.id, name: skill.name, file_path: relative, content: content.slice(offset, end),
    offset, total_chars: content.length, next_offset: end < content.length ? end : null,
  };
}

module.exports = { loadAgentProfile, listProfileSkills, readProfileSkill };
