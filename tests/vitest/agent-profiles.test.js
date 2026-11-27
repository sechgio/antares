import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { loadAgentProfile } = require('../../electron/agent-profiles');
let home;

function runSkills(name, profile, params = {}, catalog = []) {
  const root = path.resolve(import.meta.dirname, '../..');
  return JSON.parse(
    execFileSync(
      'uv',
      [
        'run',
        '--project',
        root,
        '--locked',
        '--extra',
        'dev',
        'python',
        path.join(root, 'tests/helpers/agent_skills_probe.py'),
      ],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: root, PYTHONUTF8: '1' },
        input: JSON.stringify({ name, params, catalog, profile_skills: [...profile.skills.values()] }),
      },
    ),
  );
}

const listProfileSkills = (profile, params) => runSkills('skills_list', profile, params);
const readProfileSkill = (profile, params) => runSkills('skills_read', profile, params);

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
  write(
    `${slug}/agent.json`,
    JSON.stringify({
      name: 'Revisor',
      slug,
      model: 'local-model',
      description: 'Revisa entregas',
      onboarded_at: 1,
      ...metadata,
    }),
  );
  write(`${slug}/AGENTS.md`, 'Rol: revisar. Tono: claro. Límites: solo lectura.');
}

beforeEach(() => {
  home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'antares-profiles-')));
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
    expect(loaded).toMatchObject({
      name: 'Revisor',
      slug: 'reviewer',
      model: 'local-model',
      description: 'Revisa entregas',
    });
    expect(loaded.instructions).toBe('Sistema base\n\nRol: revisar. Tono: claro. Límites: solo lectura.');
    expect(listProfileSkills(loaded).skills.map((item) => item.name)).toEqual(['review', 'summary']);
    expect(listProfileSkills(loaded).skills[0]).not.toHaveProperty('content');
    expect(readProfileSkill(loaded, { skill_id: 'profile:review' }).content).toContain('Instrucciones cargables.');
  }, 30000);

  it('lee SOUL.md y USER.md opcionales con límite de tamaño', () => {
    expect(loadAgentProfile('reviewer')).not.toHaveProperty('soul');
    expect(loadAgentProfile('reviewer')).not.toHaveProperty('user');
    write('reviewer/SOUL.md', '﻿Tono cercano y directo.\n');
    write('reviewer/USER.md', 'Se llama Ana y prefiere tablas.');
    expect(loadAgentProfile('reviewer')).toMatchObject({
      instructions: 'Rol: revisar. Tono: claro. Límites: solo lectura.',
      soul: 'Tono cercano y directo.',
      user: 'Se llama Ana y prefiere tablas.',
    });
    write('reviewer/USER.md', 'x'.repeat(4001));
    expect(() => loadAgentProfile('reviewer')).toThrow(/USER\.md.*4000/);
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

  it.each([
    'Sin frontmatter',
    '---\nname: review\n---\nTexto',
    '---\ndescription: Revisa\n---\nTexto',
    '---\nname: review\ndescription: []\n---\nTexto',
    '---\nname: [\n---\nTexto',
  ])('4: rechaza SKILL.md inválido: %s', (content) => {
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
    write(
      'reviewer/skills/review/SKILL.md',
      '\uFEFF---\r\nname: "review"\r\ndescription: >-\r\n  Revisa documentos:\r\n  texto y tablas.\r\n---\r\nInstrucciones',
    );
    expect(loadAgentProfile('reviewer').skills.get('review').description).toBe('Revisa documentos: texto y tablas.');
  });

  it.each(['../secret', '_shared', 'a/b', 'C:\\secret'])(
    'rechaza slugs que no identifican una carpeta de agente: %s',
    (slug) => {
      expect(() => loadAgentProfile(slug)).toThrow(/Slug de agente inválido/);
    },
  );

  it('no registra skills de otro agente', () => {
    profile('writer');
    skill('writer/skills/private', 'private');
    expect(loadAgentProfile('reviewer').skills.size).toBe(0);
  });

  it('rechaza un directorio compartido que apunta fuera de AGENTS_HOME', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-external-skills-'));
    try {
      fs.mkdirSync(path.join(outside, 'private'));
      fs.writeFileSync(
        path.join(outside, 'private/SKILL.md'),
        '---\nname: private\ndescription: Secreto\n---\nContenido',
      );
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
    const pages = runSkills('skills_pages', loaded, { skill_id: 'profile:long' });
    const content = pages.map((page) => page.content).join('');
    expect(content).toBe(loaded.skills.get('long').content);
  });

  it('rechaza archivos de skills y auxiliares que superan 64 KiB', () => {
    skill('reviewer/skills/large', 'large', 'x'.repeat(64 * 1024));
    expect(() => loadAgentProfile('reviewer')).toThrow(/64 KiB/);
    skill('reviewer/skills/large', 'large');
    const loaded = loadAgentProfile('reviewer');
    write('reviewer/skills/large/scripts/large.txt', 'x'.repeat(64 * 1024 + 1));
    expect(() => readProfileSkill(loaded, { skill_id: 'profile:large', file_path: 'scripts/large.txt' })).toThrow(
      /64 KiB/,
    );
  });

  it('conserva la búsqueda por minúsculas del formato portable', () => {
    skill('reviewer/skills/street', 'Straße');
    const loaded = loadAgentProfile('reviewer');
    expect(listProfileSkills(loaded, { query: 'straße' }).total).toBe(1);
    expect(listProfileSkills(loaded, { query: 'STRASSE' }).total).toBe(0);
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
      write(
        `reviewer/skills/item-${i}/SKILL.md`,
        `---\nname: item-${i}\ndescription: ${'d'.repeat(1024)}\n---\n${'\u0001'.repeat(9000)}`,
      );
    }
    const loaded = loadAgentProfile('reviewer');
    const list = listProfileSkills(loaded, { limit: 20 });
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(5600);
    expect(list).toMatchObject({ total: 20, truncated: true });
    const pages = runSkills('skills_pages', loaded, { skill_id: 'profile:item-0' });
    for (const page of pages) {
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(5600);
    }
    const content = pages.map((page) => page.content).join('');
    expect(content).toBe(loaded.skills.get('item-0').content);
  });

  it('combina fuentes sin perder IDs, totales ni límites del catálogo base', () => {
    skill('reviewer/skills/review', 'review');
    const loaded = loadAgentProfile('reviewer');
    const catalog = Array.from({ length: 30 }, (_, i) => ({
      id: i.toString(16).padStart(24, '0'),
      name: `base-${i}`,
      description: 'Biblioteca',
    }));
    const merged = runSkills('skills_list', loaded, { limit: 2 }, catalog);
    expect(merged.skills.map((item) => item.id)).toEqual(['profile:review', catalog[0].id]);
    expect(merged).toMatchObject({ total: 31, truncated: true });
    expect(runSkills('skills_list', loaded, { query: 'Biblioteca', limit: 1 }, catalog).total).toBe(30);
  });

  it('conserva offsets UTF-16 y el techo serializado con emojis en contenido y metadatos', () => {
    for (let i = 0; i < 12; i++) {
      write(
        `reviewer/skills/emoji-${i}/SKILL.md`,
        `---\nname: emoji-${i}\ndescription: ${'😀'.repeat(480)}\n---\n${'😀'.repeat(4000)}`,
      );
    }
    const loaded = loadAgentProfile('reviewer');
    const list = listProfileSkills(loaded, { limit: 12 });
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(5600);
    expect(list.skills.every((item) => item.description.length <= 240)).toBe(true);
    const pages = runSkills('skills_pages', loaded, { skill_id: 'profile:emoji-0', offset: 4001 });
    expect(pages[0].total_chars).toBe(loaded.skills.get('emoji-0').content.length);
    expect(pages.every((page) => JSON.stringify(page).length <= 5600)).toBe(true);
    expect(pages.map((page) => page.content).join('')).toBe(loaded.skills.get('emoji-0').content.slice(4001));
  });

  it('rechaza traversal y enlaces hacia archivos fuera de la skill', () => {
    skill('reviewer/skills/review', 'review');
    const loaded = loadAgentProfile('reviewer');
    for (const file_path of ['../agent.json', '..\\agent.json', 'C:\\secret', '/secret']) {
      expect(() => readProfileSkill(loaded, { skill_id: 'profile:review', file_path })).toThrow(/ruta relativa/);
    }
    const outside = write('outside/secret.txt', 'Secreto');
    fs.symlinkSync(path.dirname(outside), path.join(home, 'reviewer/skills/review/link'), 'junction');
    expect(() => readProfileSkill(loaded, { skill_id: 'profile:review', file_path: 'link/secret.txt' })).toThrow(
      /sale de la carpeta/,
    );
  });

  it('carga hooks declarativos con contexto recortado y tools sin duplicados', () => {
    write(
      'reviewer/hooks.json',
      JSON.stringify({
        hooks: [
          { event: 'subagentStart', context: '  Revisa el contrato.  ' },
          { event: 'preToolUse', context: 'Confirma el ámbito.', tools: ['canvas_list', 'canvas_list'] },
          { event: 'postToolUse', context: 'Anota el resultado.' },
        ],
      }),
    );
    const loaded = loadAgentProfile('reviewer');
    expect(loaded.hooks).toEqual([
      { event: 'subagentStart', context: 'Revisa el contrato.' },
      { event: 'preToolUse', context: 'Confirma el ámbito.', tools: ['canvas_list'] },
      { event: 'postToolUse', context: 'Anota el resultado.' },
    ]);
  });

  it('sin hooks.json el perfil no declara hooks', () => {
    expect(loadAgentProfile('reviewer').hooks).toEqual([]);
  });

  it.each([
    ['JSON inválido', '{', /hooks\.json.*JSON inválido/],
    ['raíz no objeto', '[]', /objeto con «hooks»/],
    ['campo extra en la raíz', JSON.stringify({ hooks: [], command: 'rm' }), /campo no admitido: command/],
    ['hooks no es lista', JSON.stringify({ hooks: {} }), /lista «hooks»/],
    [
      'más de 32 hooks',
      JSON.stringify({ hooks: Array.from({ length: 33 }, () => ({ event: 'subagentStop', context: 'x' })) }),
      /máximo de 32 hooks/,
    ],
    ['hook no objeto', JSON.stringify({ hooks: ['x'] }), /hook 1: se espera un objeto/],
    [
      'campo no admitido',
      JSON.stringify({ hooks: [{ event: 'subagentStart', context: 'x', command: 'rm' }] }),
      /campo no admitido: command/,
    ],
    ['evento inválido', JSON.stringify({ hooks: [{ event: 'beforeAll', context: 'x' }] }), /event debe ser/],
    [
      'contexto vacío',
      JSON.stringify({ hooks: [{ event: 'subagentStart', context: '   ' }] }),
      /context de texto no vacío/,
    ],
    [
      'contexto excesivo',
      JSON.stringify({ hooks: [{ event: 'subagentStart', context: 'x'.repeat(2001) }] }),
      /context excede 2000/,
    ],
    [
      'texto total excesivo',
      JSON.stringify({
        hooks: Array.from({ length: 5 }, () => ({ event: 'subagentStop', context: 'x'.repeat(2000) })),
      }),
      /excede 8000/,
    ],
    [
      'tools en subagentStart',
      JSON.stringify({ hooks: [{ event: 'subagentStart', context: 'x', tools: ['canvas_list'] }] }),
      /tools solo se admite/,
    ],
    ['tools vacío', JSON.stringify({ hooks: [{ event: 'preToolUse', context: 'x', tools: [] }] }), /lista de nombres/],
    [
      'tool inválida',
      JSON.stringify({ hooks: [{ event: 'preToolUse', context: 'x', tools: ['Canvas List'] }] }),
      /lista de nombres/,
    ],
  ])('rechaza hooks inválidos: %s', (_label, content, pattern) => {
    write('reviewer/hooks.json', content);
    expect(() => loadAgentProfile('reviewer')).toThrow(pattern);
  });

  it('filtra el contexto declarado por evento y herramienta', () => {
    const hooks = require('../../electron/agent-hooks');
    const profile = {
      name: 'Revisor',
      hooks: [
        { event: 'preToolUse', context: 'Ámbito general.' },
        { event: 'preToolUse', context: 'Solo canvas.', tools: ['canvas_list'] },
        { event: 'postToolUse', context: 'Cierre.', tools: ['otra'] },
      ],
    };
    expect(hooks.contextFor(profile, 'preToolUse', 'canvas_list')).toContain('Ámbito general.');
    expect(hooks.contextFor(profile, 'preToolUse', 'canvas_list')).toContain('Solo canvas.');
    expect(hooks.contextFor(profile, 'preToolUse', 'otra')).toContain('Ámbito general.');
    expect(hooks.contextFor(profile, 'preToolUse', 'otra')).not.toContain('Solo canvas.');
    expect(hooks.contextFor(profile, 'postToolUse', 'canvas_list')).toBe('');
    expect(hooks.contextFor({ hooks: [] }, 'preToolUse', 'x')).toBe('');
    expect(hooks.contextFor(null, 'subagentStart')).toBe('');
  });
});

describe('integración con el arranque del agente', () => {
  const runtime = require('../../electron/agent-runtime');
  const { conversation, ctx, shared } = require('../../electron/agent-shared');

  afterEach(async () => {
    await runtime.shutdown();
    runtime._internal._providerOverrides.delete('faux');
  });

  async function fixture(catalog = [], memoryContext = () => '') {
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
    const faux = fauxProvider();
    runtime._internal._providerOverrides.set('faux', faux.provider);
    const bridge = vi.fn(async (method, params) => {
      if (method === 'agent_internal_tools')
        return {
          tools: ['skills_list', 'skills_read'].map((name) => ({
            name,
            module: 'agent',
            kind: 'backend',
            gated: false,
            inputSchema: { type: 'object', properties: { skill_id: { type: 'string' } } },
          })),
        };
      if (method === 'agent_internal_provider')
        return { provider: params.provider, style: 'openai_chat', default_model: 'faux-2' };
      if (method === 'agent_internal_approvals_pending') return { approvals: [] };
      if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [] };
      if (method === 'agent_internal_memory_revision') return { revision: 1 };
      if (method === 'agent_internal_memory_context') return { context: memoryContext(params) };
      if (method === 'agent_internal_profile_usage') return { tokens: 0 };
      if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
      if (method === 'agent_internal_dispatch') {
        return {
          result: JSON.stringify(
            runSkills(
              params.name,
              { skills: new Map((params.context?.profile_skills || []).map((item) => [item.name, item])) },
              params.params,
              catalog,
            ),
          ),
        };
      }
      throw new Error(`Puente inesperado: ${method}`);
    });
    const open = async () => {
      await runtime.open({
        storage: await openNodeSqliteStorage(path.join(home, 'runtime.sqlite')),
        dir: home,
        bridge,
        skipImport: true,
      });
      await require('../../electron/agent-tasks').stop();
    };
    await open();
    return { open, bridge, faux, fauxAssistantMessage, fauxToolCall };
  }

  it('aplica el alcance de memoria del perfil en el mismo chat, también al revertirlo y reiniciar', async () => {
    const memory = 'Recuerdo privado de prueba';
    const f = await fixture([], ({ memory_scope }) => (memory_scope === 'own' ? memory : ''));
    const { profile: saved } = await runtime.handlers.agent_profile_save({
      name: 'Perfil con memoria', instructions: 'Ayuda al usuario.', tools: [], memory_scope: 'own',
    });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1', profile_id: saved.id });
    async function send(content) {
      let seen;
      f.faux.setResponses([(context) => {
        seen = JSON.stringify(context.messages);
        return f.fauxAssistantMessage('Listo');
      }]);
      await runtime.handlers.agent_message_send({ session_id: session.id, content });
      await (await conversation(session.id)).waitForIdle(ctx());
      await vi.waitFor(() => expect(seen).toContain(content));
      return seen;
    }
    expect(await send('Consulta la memoria')).toContain(memory);
    await runtime.handlers.agent_profile_save({ ...saved, memory_scope: 'none' });
    await runtime.shutdown();
    await f.open();
    expect(await send('Trabaja sin memoria')).not.toContain(memory);
    await runtime.handlers.agent_profile_save(saved);
    expect(await send('Vuelve a consultar la memoria')).toContain(memory);
  });

  it.each(['actual', 'anterior'])('detiene las rutinas si el agente se borró en la versión %s', async (version) => {
    const f = await fixture();
    const handlers = runtime.handlers;
    const { profile: saved } = await handlers.agent_profile_save({ name: 'Agente', instructions: 'Revisa.', tools: [] });
    const { session } = await handlers.agent_session_create({ provider: 'faux', profile_id: saved.id });
    const dueAt = new Date(Date.now() + 3_600_000).toISOString();
    const task = { session_id: session.id, content: 'Revisa.', due_at: dueAt };
    const { scheduled: routine } = await handlers.agent_tasks_save({ ...task, every_minutes: 60 });
    const { scheduled: once } = await handlers.agent_tasks_save(task);
    const pastRun = { at: 1, due_at: 1, status: 'needs_input', silent: false };
    await shared.state.harness.commit(async (tx) => {
      const current = (await tx.doc(shared.state.TasksDoc)).tasks[routine.id];
      current.status = 'needs_input';
      current.question = '¿Qué periodo reviso?';
      current.runs = [pastRun];
    }, ctx());
    if (version === 'actual') {
      await handlers.agent_profile_delete({ id: saved.id });
    } else {
      await shared.state.harness.commit(async (tx) => {
        delete (await tx.doc(shared.state.ProfilesDoc)).profiles[saved.id];
      }, ctx());
    }
    await runtime.shutdown();
    await f.open();
    expect((await handlers.agent_sessions_list()).sessions.map(({ id }) => id)).toContain(session.id);
    expect((await handlers.agent_tasks_list({})).tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: routine.id, status: 'cancelled', runs: [pastRun] }),
      expect.objectContaining({ id: once.id, status: 'pending' }),
    ]));
    await expect(handlers.agent_tasks_run({ id: routine.id })).rejects.toThrow(/cancelado/);
    await expect(handlers.agent_tasks_respond({ id: routine.id, response: 'Junio' })).rejects.toThrow(/no está esperando/);
    await expect(handlers.agent_tasks_save({ ...task, every_minutes: 60 })).rejects.toThrow(/ya no existe/);
  });

  it.each(['owner', 'target'])('cancela una rutina dirigida si se borra el perfil %s', async (side) => {
    await fixture();
    const handlers = runtime.handlers;
    const model = { provider: 'faux', model: 'faux-1' };
    const owner = (await handlers.agent_profile_save({ name: 'Origen', instructions: 'Organiza.', tools: [] })).profile;
    const target = (await handlers.agent_profile_save({ name: 'Destino', instructions: 'Revisa.', tools: [] })).profile;
    const { session } = await handlers.agent_session_create({ ...model, profile_id: owner.id });
    const { session: destination } = await handlers.agent_session_create({ ...model, profile_id: target.id });
    const { scheduled } = await handlers.agent_tasks_save({
      session_id: session.id,
      agent: target.id,
      content: 'Revisa el informe.',
      due_at: new Date(Date.now() + 3_600_000).toISOString(),
      every_minutes: 60,
    });
    expect(scheduled.target_session_id).toBe(destination.id);
    await handlers.agent_profile_delete({ id: side === 'owner' ? owner.id : target.id });
    await expect(handlers.agent_tasks_run({ id: scheduled.id })).rejects.toThrow(/cancelado/);
  });

  it('retoma la presentación de un perfil portable hasta que se confirma', async () => {
    profile('reviewer', { model: 'faux-1', onboarded_at: undefined });
    const f = await fixture();
    const handlers = runtime.handlers;
    f.faux.setResponses([f.fauxAssistantMessage('¿Para qué me necesitas?'), f.fauxAssistantMessage('¿Me cuentas el objetivo?')]);
    const { session: first } = await handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' });
    await (await conversation(first.id)).waitForIdle(ctx());
    expect(loadAgentProfile('reviewer').onboarded_at).toBeUndefined();
    const { session: retry } = await handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' });
    await (await conversation(retry.id)).waitForIdle(ctx());
    expect((await handlers.agent_messages_list({ session_id: retry.id })).messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: '¿Me cuentas el objetivo?' }),
    ]));
    await require('../../electron/agent-profiles').saveSessionOnboarding(retry.id, {
      confirmed: true, identity: { name: 'Revisor', role: 'Revisa entregas', tone: 'Claro' }, user: 'Prefiere respuestas breves.',
    });
    await runtime.shutdown();
    await f.open();
    expect(loadAgentProfile('reviewer').onboarded_at).toEqual(expect.any(Number));
    const { session: next } = await handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' });
    expect((await handlers.agent_messages_list({ session_id: next.id })).messages).toHaveLength(0);
  });

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
        f.fauxAssistantMessage([f.fauxToolCall('skills_read', { skill_id: 'profile:review' })], {
          stopReason: 'toolUse',
        }),
        f.fauxAssistantMessage('Revisión completada'),
      ]);
      await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Revisa con la skill.' });
      await conv.waitForIdle(ctx());
      await vi.waitFor(
        async () => {
          const entries = await conv.entries({}, 500, undefined, ctx());
          const results = entries.items.filter((entry) => entry.kind === 'pi.tool-result');
          expect(results).toHaveLength(restart ? 4 : 2);
          expect(JSON.stringify(results.slice(-2))).toContain('Instrucción del perfil portable');
          expect(JSON.stringify(results.slice(-2))).toContain('common');
        },
        { timeout: 10000 },
      );
    }
    expect(
      f.bridge.mock.calls.filter(
        ([method, params]) => method === 'agent_internal_dispatch' && params.name === 'skills_list',
      ),
    ).toHaveLength(2);
    expect(
      f.bridge.mock.calls.filter(
        ([method, params]) => method === 'agent_internal_dispatch' && params.name === 'skills_read',
      ),
    ).toHaveLength(2);
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
      f.fauxAssistantMessage([f.fauxToolCall('skills_read', { skill_id: 'profile:common' })], {
        stopReason: 'toolUse',
      }),
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

  it.each(['ausente', 'JSON inválido', 'skill inválida'])(
    'aísla un perfil %s al reabrir y permite recuperarlo',
    async (failure) => {
      profile('reviewer', { model: 'faux-1' });
      const f = await fixture();
      const healthy = (await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' })).session;
      const portable = (await runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' }))
        .session;
      await runtime.shutdown();
      if (failure === 'ausente') fs.unlinkSync(path.join(home, 'reviewer/agent.json'));
      if (failure === 'JSON inválido') write('reviewer/agent.json', '{');
      if (failure === 'skill inválida') write('reviewer/skills/review/SKILL.md', 'Sin frontmatter');
      await f.open();
      expect((await runtime.handlers.agent_sessions_list()).sessions).toHaveLength(2);
      f.faux.setResponses([f.fauxAssistantMessage('Chat sano')]);
      await runtime.handlers.agent_message_send({ session_id: healthy.id, content: 'Saluda.' });
      await (await conversation(healthy.id)).waitForIdle(ctx());
      await expect(
        runtime.handlers.agent_message_send({ session_id: portable.id, content: 'Saluda.' }),
      ).rejects.toThrow(/agent\.json|SKILL\.md/);
      profile('reviewer', { model: 'faux-1' });
      skill('reviewer/skills/review', 'review');
      f.faux.setResponses([f.fauxAssistantMessage('Perfil recuperado')]);
      await runtime.handlers.agent_message_send({ session_id: portable.id, content: 'Saluda.' });
      const conv = await conversation(portable.id);
      await conv.waitForIdle(ctx());
      expect(JSON.stringify((await conv.entries({}, 500, undefined, ctx())).items)).toContain('Perfil recuperado');
    },
    30000,
  );

  it('respeta un modelo explícito y da prioridad al perfil guardado aunque la carpeta coincida', async () => {
    await fixture();
    const explicit = await runtime.handlers.agent_session_create({
      provider: 'faux',
      model: 'faux-1',
      profile_id: 'reviewer',
    });
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

  it('ensambla SYSTEM_PROMPT, SOUL.md, AGENTS.md y USER.md en orden estable', async () => {
    const { SYSTEM_PROMPT, agentInstructions } = require('../../electron/agent-prompts');
    profile('reviewer', { model: 'faux-1' });
    await fixture();
    const plain = (await runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' })).session;
    const before = (await (await conversation(plain.id)).agent(ctx())).instructions;
    expect(before).toBe(agentInstructions(loadAgentProfile('reviewer')));
    expect(before).not.toMatch(/SOUL\.md|USER\.md/);
    write('reviewer/SOUL.md', 'Tono cercano.');
    write('reviewer/USER.md', 'Prefiere tablas.');
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'reviewer' });
    const text = (await (await conversation(session.id)).agent(ctx())).instructions;
    const order = ['Tono cercano.', 'Rol: revisar.', 'Prefiere tablas.'].map((part) => text.indexOf(part));
    expect(text.startsWith(`${SYSTEM_PROMPT}\n\n`)).toBe(true);
    expect(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1]))).toBe(true);
    expect(text).toBe(agentInstructions(loadAgentProfile('reviewer')));
  });

  it('guarda SOUL/USER en perfiles y exporta la plantilla con y sin USER', async () => {
    await fixture();
    const { profile: saved } = await runtime.handlers.agent_profile_save({
      name: 'Redactor',
      instructions: 'Redacta informes.',
      soul: 'Tono formal.',
      user: 'Firma como Ana.',
      tools: null,
    });
    const { profile: edited } = await runtime.handlers.agent_profile_save({
      id: saved.id,
      name: 'Redactor',
      instructions: 'Redacta informes breves.',
      tools: null,
    });
    expect(edited).toMatchObject({ soul: 'Tono formal.', user: 'Firma como Ana.' });
    const full = (await runtime.handlers.agent_template_export({ id: saved.id, include_user: true })).template;
    expect(full).toMatchObject({ format: 'antares-agent-template/v1', soul: 'Tono formal.', user: 'Firma como Ana.' });
    const shared = (await runtime.handlers.agent_template_export({ id: saved.id, include_user: false })).template;
    expect(shared.soul).toBe('Tono formal.');
    expect(shared).not.toHaveProperty('user');
    const { profile: imported } = await runtime.handlers.agent_template_import({ template: shared });
    expect(imported.soul).toBe('Tono formal.');
    expect(imported).not.toHaveProperty('user');
    await expect(
      runtime.handlers.agent_profile_save({ name: 'Largo', instructions: '', soul: 'x'.repeat(4001), tools: null }),
    ).rejects.toThrow(/SOUL.*4000/);
  });

  it('falla antes de crear la conversación si el perfil portable es inválido', async () => {
    await fixture();
    const state = runtime._internal.state();
    const create = vi.spyOn(state.harness, 'createConversation');
    try {
      await expect(runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'missing' })).rejects.toThrow(
        /agent\.json/,
      );
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });
});
