// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadAgentProfile, listProfileSkills, readProfileSkill } = require('../../../electron/agent-profiles');
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

  it('la skill de muestra incluida se puede registrar y cargar', () => {
    const example = fs.readFileSync(new URL('../../../agents/_shared/skills/example/SKILL.md', import.meta.url), 'utf8');
    write('_shared/skills/example/SKILL.md', example);
    const loaded = loadAgentProfile('reviewer');
    expect(readProfileSkill(loaded, { skill_id: 'profile:example' }).content).toContain('evidencia concreta');
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

  async function fixture() {
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
      if (method === 'agent_internal_dispatch') return { result: JSON.stringify({ skills: [], source: 'backend' }) };
      throw new Error(`Puente inesperado: ${method}`);
    });
    const open = async () => {
      await runtime.open({ storage: await openNodeSqliteStorage(path.join(home, 'runtime.sqlite')), dir: home, bridge, skipImport: true });
      await require('../../../electron/agent-tasks').stop();
    };
    await open();
    return { open, bridge, faux, fauxAssistantMessage, fauxToolCall };
  }

  it('inicia por profile_id, usa su modelo y sirve skills reales sin enviarlas al backend, también tras reiniciar', async () => {
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
    expect(f.bridge.mock.calls.filter(([method]) => method === 'agent_internal_dispatch')).toHaveLength(0);
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
