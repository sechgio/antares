// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadAgentProfile, listProfileSkills, readProfileSkill, mergeProfileSkills } = require('../../../electron/agent-profiles');
let home;

function write(relative, content) {
  const file = path.join(home, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function skill(directory, name, body = 'Instrucciones cargables.') {
  return write(`${directory}/SKILL.md`, `---\nname: ${name}\ndescription: Revisa documentos\n---\n${body}`);
}

function profile(slug = 'reviewer', metadata = {}) {
  write(`${slug}/agent.json`, JSON.stringify({ name: 'Revisor', slug, model: 'local-model', description: 'Revisa entregas', ...metadata }));
  write(`${slug}/AGENTS.md`, 'Rol: revisar. Tono: claro. Límites: solo lectura.');
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-profiles-'));
  vi.stubEnv('AGENTS_HOME', home);
  profile();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('perfiles portables', () => {
  it('1: lee metadatos, concatena AGENTS.md y registra cada skill para carga posterior', () => {
    skill('reviewer/skills/review', 'review');
    skill('reviewer/skills/summary', 'summary');
    const loaded = loadAgentProfile('reviewer', 'Sistema base');
    expect(loaded).toMatchObject({ name: 'Revisor', slug: 'reviewer', model: 'local-model', description: 'Revisa entregas' });
    expect(loaded.instructions).toBe('Sistema base\n\nRol: revisar. Tono: claro. Límites: solo lectura.');
    expect(listProfileSkills(loaded).skills.map((item) => item.name)).toEqual(['review', 'summary']);
    expect(listProfileSkills(loaded).skills[0]).not.toHaveProperty('content');
    expect(readProfileSkill(loaded, { skill_id: 'profile:review' }).content).toContain('Instrucciones cargables.');
  });

  it('2: comparte skills entre agentes y resuelve propia > compartida por name', () => {
    profile('writer');
    skill('_shared/skills/common', 'common');
    skill('_shared/skills/review', 'review', 'Compartida');
    skill('reviewer/skills/custom-folder', 'review', 'Propia');
    const reviewer = loadAgentProfile('reviewer');
    const writer = loadAgentProfile('writer');
    expect([...reviewer.skills.keys()]).toEqual(['common', 'review']);
    expect(readProfileSkill(reviewer, { skill_id: 'profile:review' }).content).toContain('Propia');
    expect(readProfileSkill(writer, { skill_id: 'profile:review' }).content).toContain('Compartida');
    expect(writer.skills.has('common')).toBe(true);
  });

  it('3: resuelve AGENTS_HOME sin rutas fijas y vuelve a ./agents si falta la variable', () => {
    expect(loadAgentProfile('reviewer').slug).toBe('reviewer');
    const configuredHome = home;
    home = path.join(home, 'agents');
    profile('default-agent');
    home = configuredHome;
    vi.stubEnv('AGENTS_HOME', '');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(home);
    try {
      expect(loadAgentProfile('default-agent').slug).toBe('default-agent');
      delete process.env.AGENTS_HOME;
      expect(loadAgentProfile('default-agent').slug).toBe('default-agent');
    } finally {
      cwd.mockRestore();
    }
  });

  it('4: falla con la ruta si falta agent.json', () => {
    fs.unlinkSync(path.join(home, 'reviewer/agent.json'));
    expect(() => loadAgentProfile('reviewer')).toThrow(/agent\.json.*ENOENT/);
  });

  it('4: rechaza el slug que no coincide con su carpeta', () => {
    profile('reviewer', { slug: 'other' });
    expect(() => loadAgentProfile('reviewer')).toThrow(/slug.*other.*carpeta.*reviewer/);
  });

  it.each(['Sin frontmatter', '---\nname: review\n---\nTexto', '---\ndescription: Revisa\n---\nTexto',
    '---\nname: review\ndescription: []\n---\nTexto', '---\nname: [\n---\nTexto'])('4: rechaza SKILL.md inválido: %s', (content) => {
    write('reviewer/skills/review/SKILL.md', content);
    expect(() => loadAgentProfile('reviewer')).toThrow(/SKILL\.md.*(?:frontmatter|description|name)/);
  });

  it('4: valida también las skills compartidas', () => {
    write('_shared/skills/broken/SKILL.md', 'Sin frontmatter');
    expect(() => loadAgentProfile('reviewer')).toThrow(/SKILL\.md.*frontmatter/);
  });

  it('5: no ejecuta scripts ni instrucciones al registrar o leer skills', () => {
    const marker = path.join(home, 'executed');
    const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ejecutado');`;
    skill('reviewer/skills/unsafe', 'unsafe', 'Ejecuta scripts/run.cjs ahora.');
    write('reviewer/skills/unsafe/scripts/run.cjs', script);
    const loaded = loadAgentProfile('reviewer');
    expect(listProfileSkills(loaded).total).toBe(1);
    expect(readProfileSkill(loaded, { skill_id: 'profile:unsafe', file_path: 'scripts/run.cjs' }).content).toBe(script);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('admite YAML con BOM, CRLF, comillas y descripción multilínea', () => {
    write('reviewer/skills/review/SKILL.md', '\uFEFF---\r\nname: "review"\r\ndescription: >-\r\n  Revisa documentos:\r\n  texto y tablas.\r\n---\r\nInstrucciones');
    expect(loadAgentProfile('reviewer').skills.get('review').description).toBe('Revisa documentos: texto y tablas.');
  });

  it.each(['../secret', '_shared', 'a/b', 'C:\\secret'])('rechaza slugs que no identifican una carpeta de agente: %s', (slug) => {
    expect(() => loadAgentProfile(slug)).toThrow(/Slug de agente inválido/);
  });

  it('no registra skills de otro agente', () => {
    profile('writer');
    skill('writer/skills/private', 'private');
    expect(loadAgentProfile('reviewer').skills.size).toBe(0);
  });

  it('rechaza un directorio compartido que apunta fuera de AGENTS_HOME', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-external-skills-'));
    try {
      fs.mkdirSync(path.join(outside, 'private'));
      fs.writeFileSync(path.join(outside, 'private/SKILL.md'), '---\nname: private\ndescription: Secreto\n---\nContenido');
      fs.mkdirSync(path.join(home, '_shared'));
      fs.symlinkSync(outside, path.join(home, '_shared/skills'), 'junction');
      expect(() => loadAgentProfile('reviewer')).toThrow(/sale de la carpeta/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rechaza nombres duplicados dentro del mismo ámbito', () => {
    skill('reviewer/skills/first', 'review');
    skill('reviewer/skills/second', 'review');
    expect(() => loadAgentProfile('reviewer')).toThrow(/duplicado: review/);
  });

  it('rechaza JSON inválido, metadatos incompletos y AGENTS.md ausente', () => {
    write('reviewer/agent.json', '{');
    expect(() => loadAgentProfile('reviewer')).toThrow(/agent\.json.*JSON inválido/);
    profile('reviewer', { model: '' });
    expect(() => loadAgentProfile('reviewer')).toThrow(/agent\.json.*model/);
    profile();
    fs.unlinkSync(path.join(home, 'reviewer/AGENTS.md'));
    expect(() => loadAgentProfile('reviewer')).toThrow(/AGENTS\.md/);
  });

  it('filtra metadatos y permite leer las instrucciones completas por páginas', () => {
    skill('reviewer/skills/long', 'long', 'x'.repeat(9000));
    const loaded = loadAgentProfile('reviewer');
    expect(listProfileSkills(loaded, { query: 'LONG documentos', limit: 1 }).total).toBe(1);
    expect(listProfileSkills(loaded, { query: 'inexistente' }).total).toBe(0);
    let content = '';
    let offset = 0;
    do {
      const page = readProfileSkill(loaded, { skill_id: 'profile:long', offset });
      content += page.content;
      offset = page.next_offset;
    } while (offset !== null);
    expect(content).toBe(loaded.skills.get('long').content);
  });

  it('rechaza archivos de skills y auxiliares que superan 64 KiB', () => {
    skill('reviewer/skills/large', 'large', 'x'.repeat(64 * 1024));
    expect(() => loadAgentProfile('reviewer')).toThrow(/64 KiB/);
    skill('reviewer/skills/large', 'large');
    const loaded = loadAgentProfile('reviewer');
    write('reviewer/skills/large/scripts/large.txt', 'x'.repeat(64 * 1024 + 1));
    expect(() => readProfileSkill(loaded, { skill_id: 'profile:large', file_path: 'scripts/large.txt' })).toThrow(/64 KiB/);
  });

  it.each([
    ['nombre', `name: ${'n'.repeat(65)}\ndescription: Texto`],
    ['descripción', `name: review\ndescription: ${'d'.repeat(1025)}`],
    ['frontmatter', `name: review\ndescription: Texto\nextra: ${'x'.repeat(8192)}`],
  ])('acota %s', (_label, header) => {
    write('reviewer/skills/review/SKILL.md', `---\n${header}\n---\nTexto`);
    expect(() => loadAgentProfile('reviewer')).toThrow(/64|1024|8192/);
  });

  it('rechaza UTF-8 inválido y catálogos con más de 256 skills', () => {
    const file = skill('reviewer/skills/review', 'review');
    fs.appendFileSync(file, Buffer.from([0xff]));
    expect(() => loadAgentProfile('reviewer')).toThrow(/UTF-8/);
    skill('reviewer/skills/review', 'review');
    for (let i = 0; i < 256; i++) skill(`reviewer/skills/item-${i}`, `item-${i}`);
    expect(() => loadAgentProfile('reviewer')).toThrow(/256/);
  });

  it('respeta el presupuesto serializado en listados y páginas con escapes', () => {
    for (let i = 0; i < 20; i++) {
      write(`reviewer/skills/item-${i}/SKILL.md`, `---\nname: item-${i}\ndescription: ${'d'.repeat(1024)}\n---\n${'\u0001'.repeat(9000)}`);
    }
    const loaded = loadAgentProfile('reviewer');
    const list = listProfileSkills(loaded, { limit: 20 });
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(5600);
    expect(list).toMatchObject({ total: 20, truncated: true });
    let content = '';
    let offset = 0;
    do {
      const page = readProfileSkill(loaded, { skill_id: 'profile:item-0', offset });
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(5600);
      content += page.content;
      offset = page.next_offset;
    } while (offset !== null);
    expect(content).toBe(loaded.skills.get('item-0').content);
  });

  it('combina fuentes sin perder IDs, totales, límites ni errores del catálogo base', () => {
    skill('reviewer/skills/review', 'review');
    const loaded = loadAgentProfile('reviewer');
    const base = { skills: [{ id: 'abcdef', name: 'review', description: 'Biblioteca' }], total: 30, truncated: true, notice: 'Aviso' };
    const merged = JSON.parse(mergeProfileSkills(loaded, { limit: 2 }, JSON.stringify(base)));
    expect(merged.skills.map((item) => item.id)).toEqual(['profile:review', 'abcdef']);
    expect(merged).toMatchObject({ total: 31, truncated: true, notice: 'Aviso' });
    expect(JSON.parse(mergeProfileSkills(loaded, { query: 'Biblioteca', limit: 1 }, JSON.stringify(base))).total).toBe(30);
    for (const text of ['respuesta sin JSON', '{"error":"No disponible"}']) {
      expect(mergeProfileSkills(loaded, {}, text)).toBe(text);
    }
  });

  it('rechaza traversal y enlaces hacia archivos fuera de la skill', () => {
    skill('reviewer/skills/review', 'review');
    const loaded = loadAgentProfile('reviewer');
    for (const file_path of ['../agent.json', '..\\agent.json', 'C:\\secret', '/secret']) {
      expect(() => readProfileSkill(loaded, { skill_id: 'profile:review', file_path })).toThrow(/ruta relativa/);
    }
    const outside = write('outside/secret.txt', 'Secreto');
    fs.symlinkSync(path.dirname(outside), path.join(home, 'reviewer/skills/review/link'), 'junction');
    expect(() => readProfileSkill(loaded, { skill_id: 'profile:review', file_path: 'link/secret.txt' })).toThrow(/sale de la carpeta/);
  });
});

describe('integración con el arranque del agente', () => {
  const runtime = require('../../../electron/agent-runtime');
  const { conversation, ctx } = require('../../../electron/agent-shared');

  afterEach(async () => {
    await runtime.shutdown();
    runtime._internal._providerOverrides.delete('faux');
  });

  async function fixture(catalog = []) {
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
    const faux = fauxProvider();
    runtime._internal._providerOverrides.set('faux', faux.provider);
    const bridge = vi.fn(async (method, params) => {
      if (method === 'agent_internal_tools') return { tools: ['skills_list', 'skills_read'].map((name) => ({
        name, module: 'agent', kind: 'backend', gated: false,
        inputSchema: { type: 'object', properties: { skill_id: { type: 'string' } } },
      })) };
      if (method === 'agent_internal_provider') return { provider: params.provider, style: 'openai_chat', default_model: 'faux-2' };
      if (method === 'agent_internal_approvals_pending') return { approvals: [] };
      if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [] };
      if (method === 'agent_internal_memory_context') return { context: '' };
      if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
      if (method === 'agent_internal_dispatch') {
        if (params.name === 'skills_read') return { result: JSON.stringify({ content: 'Contenido de biblioteca', id: params.params.skill_id }) };
        const matches = catalog.filter((item) => !params.params.query || `${item.name} ${item.description}`.includes(params.params.query));
        const limit = params.params.limit ?? 8;
        return { result: JSON.stringify({ skills: matches.slice(0, limit), total: matches.length, truncated: matches.length > limit }) };
      }
      throw new Error(`Puente inesperado: ${method}`);
    });
    const open = async () => {
      await runtime.open({ storage: await openNodeSqliteStorage(path.join(home, 'runtime.sqlite')), dir: home, bridge, skipImport: true });
      await require('../../../electron/agent-tasks').stop();
    };
    await open();
    return { open, bridge, faux, fauxAssistantMessage, fauxToolCall };
  }

  it('inicia por profile_id, usa su modelo y sirve skills del perfil junto al catálogo base, también tras reiniciar', async () => {
    profile('reviewer', { model: 'faux-1' });
    const f = await fixture();
    skill('_shared/skills/common', 'common');
    skill('reviewer/skills/review', 'review', 'Instrucción del perfil portable');
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' });
    expect(session.model).toBe('faux-1');
    let conv = await conversation(session.id);
    expect((await conv.agent(ctx())).instructions).toContain('Rol: revisar. Tono: claro. Límites: solo lectura.');
    expect((await conv.agent(ctx())).instructions).toContain('Eres el agente de Antares');
    expect((await conv.agent(ctx())).instructions).not.toContain('Instrucción del perfil portable');
    for (const restart of [false, true]) {
      if (restart) {
        await runtime.shutdown();
        await f.open();
        conv = await conversation(session.id);
      }
      f.faux.setResponses([
        f.fauxAssistantMessage([f.fauxToolCall('skills_list', {})], { stopReason: 'toolUse' }),
        f.fauxAssistantMessage([f.fauxToolCall('skills_read', { skill_id: 'profile:review' })], { stopReason: 'toolUse' }),
        f.fauxAssistantMessage('Revisión completada'),
      ]);
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Revisa con la skill.' });
      await conv.waitForIdle(ctx());
      await vi.waitFor(async () => {
        const entries = await conv.entries({}, 500, undefined, ctx());
        const results = entries.items.filter((entry) => entry.kind === 'pi.tool-result');
        expect(results).toHaveLength(restart ? 4 : 2);
        expect(JSON.stringify(results.slice(-2))).toContain('Instrucción del perfil portable');
        expect(JSON.stringify(results.slice(-2))).toContain('common');
      }, { timeout: 10000 });
    }
    expect(f.bridge.mock.calls.filter(([method, params]) => method === 'agent_internal_dispatch' && params.name === 'skills_list')).toHaveLength(2);
    expect(f.bridge.mock.calls.filter(([method, params]) => method === 'agent_internal_dispatch' && params.name === 'skills_read')).toHaveLength(0);
  }, 30000);

  it('conserva las skills de biblioteca y sus lecturas al seleccionar un perfil portable', async () => {
    profile('reviewer', { model: 'faux-1' });
    skill('_shared/skills/common', 'common');
    const libraryId = 'abcdef0123456789abcdef01';
    const f = await fixture([{ id: libraryId, name: 'library', description: 'Biblioteca autorizada' }]);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' });
    f.faux.setResponses([
      f.fauxAssistantMessage([f.fauxToolCall('skills_list', {})], { stopReason: 'toolUse' }),
      f.fauxAssistantMessage([f.fauxToolCall('skills_read', { skill_id: libraryId })], { stopReason: 'toolUse' }),
      f.fauxAssistantMessage([f.fauxToolCall('skills_read', { skill_id: 'profile:common' })], { stopReason: 'toolUse' }),
      f.fauxAssistantMessage('Terminado'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Consulta ambas fuentes.' });
    const conv = await conversation(session.id);
    await conv.waitForIdle(ctx());
    const { items } = await conv.entries({}, 500, undefined, ctx());
    const results = items.filter((entry) => entry.kind === 'pi.tool-result').flatMap((entry) => entry.model);
    const listed = JSON.parse(results.find((result) => result.toolName === 'skills_list').content[0].text);
    expect(listed.skills.map((item) => item.id)).toEqual(['profile:common', libraryId]);
    expect(listed.total).toBe(2);
    expect(JSON.stringify(results)).toContain('Contenido de biblioteca');
    expect(results.every((result) => !result.isError)).toBe(true);
  }, 30000);

  it.each(['ausente', 'JSON inválido', 'skill inválida'])('aísla un perfil %s al reabrir y permite recuperarlo', async (failure) => {
    profile('reviewer', { model: 'faux-1' });
    const f = await fixture();
    const healthy = (await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' })).session;
    const portable = (await runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' })).session;
    await runtime.shutdown();
    if (failure === 'ausente') fs.unlinkSync(path.join(home, 'reviewer/agent.json'));
    if (failure === 'JSON inválido') write('reviewer/agent.json', '{');
    if (failure === 'skill inválida') write('reviewer/skills/review/SKILL.md', 'Sin frontmatter');
    await f.open();
    expect((await runtime.handlers.agent_sessions_list()).sessions).toHaveLength(2);
    f.faux.setResponses([f.fauxAssistantMessage('Chat sano')]);
    await runtime.handlers.agent_message_send({ session_id: healthy.id, content: 'Saluda.' });
    await (await conversation(healthy.id)).waitForIdle(ctx());
    await expect(runtime.handlers.agent_message_send({ session_id: portable.id, content: 'Saluda.' })).rejects.toThrow(/agent\.json|SKILL\.md/);
    profile('reviewer', { model: 'faux-1' });
    skill('reviewer/skills/review', 'review');
    f.faux.setResponses([f.fauxAssistantMessage('Perfil recuperado')]);
    await runtime.handlers.agent_message_send({ session_id: portable.id, content: 'Saluda.' });
    const conv = await conversation(portable.id);
    await conv.waitForIdle(ctx());
    expect(JSON.stringify((await conv.entries({}, 500, undefined, ctx())).items)).toContain('Perfil recuperado');
  }, 30000);

  it('respeta un modelo explícito y da prioridad al perfil guardado aunque la carpeta coincida', async () => {
    await fixture();
    const explicit = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: 'reviewer' });
    expect(explicit.session.model).toBe('faux-1');
    const state = runtime._internal.state();
    await state.harness.commit(async (tx) => {
      const doc = await tx.doc(state.ProfilesDoc);
      doc.profiles.reviewer = { id: 'reviewer', name: 'Guardado', instructions: 'Instrucción guardada', tools: null };
    }, ctx());
    write('reviewer/agent.json', 'JSON inválido que no debe leerse');
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' });
    expect(session.model).toBe('faux-2');
    expect(session.profile).toEqual({ id: 'reviewer', name: 'Guardado' });
    expect((await (await conversation(session.id)).agent(ctx())).instructions).toContain('Instrucción guardada');
  });

  it('falla antes de crear la conversación si el perfil portable es inválido', async () => {
    await fixture();
    const state = runtime._internal.state();
    const create = vi.spyOn(state.harness, 'createConversation');
    try {
      await expect(runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'missing' })).rejects.toThrow(/agent\.json/);
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });
});
