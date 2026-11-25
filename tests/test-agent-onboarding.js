'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateOnboarding, savePortableOnboarding, loadAgentProfile } = require('../electron/agent-profiles');
const { agentInstructions } = require('../electron/agent-prompts');

const valid = {
  confirmed: true,
  identity: { name: 'Antares', role: 'Asistente de código', tone: 'Directo y cálido', avatar: '✨' },
  user: 'Idioma: español\nZona horaria: Europe/Madrid\nTrabajo: respuestas breves',
};

test('validateOnboarding genera IDENTITY y USER acotados', () => {
  const data = validateOnboarding(valid);
  assert.match(data.identityMarkdown, /Nombre: Antares/);
  assert.match(data.identityMarkdown, /Avatar: ✨/);
  assert.ok(data.userMarkdown.length <= 4000);
  assert.throws(() => validateOnboarding({ ...valid, confirmed: false }), /confirmar/);
  assert.throws(() => validateOnboarding({ ...valid, user: `token=${'x'.repeat(20)}` }), /secreto/);
  assert.throws(
    () => validateOnboarding({ ...valid, identity: { ...valid.identity, name: 'x'.repeat(81) } }),
    /excede/,
  );
});

test('el orden estable del prompt es SYSTEM, SOUL, IDENTITY, AGENTS y USER', () => {
  const prompt = agentInstructions({
    name: 'Antares',
    instructions: 'AGENTS-CUSTOM',
    soul: 'SOUL-CUSTOM',
    identity: 'IDENTITY-CUSTOM',
    user: 'USER-CUSTOM',
  });
  for (const marker of ['SOUL-CUSTOM', 'IDENTITY-CUSTOM', 'AGENTS-CUSTOM', 'USER-CUSTOM']) {
    assert.ok(prompt.includes(marker), marker);
  }
  assert.ok(prompt.indexOf('SOUL-CUSTOM') < prompt.indexOf('IDENTITY-CUSTOM'));
  assert.ok(prompt.indexOf('IDENTITY-CUSTOM') < prompt.indexOf('AGENTS-CUSTOM'));
  assert.ok(prompt.indexOf('AGENTS-CUSTOM') < prompt.indexOf('USER-CUSTOM'));
});

test('la escritura portable guarda IDENTITY, USER y onboarded_at una sola vez', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-agent-home-'));
  const slug = 'agente-prueba';
  const dir = path.join(home, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'agent.json'),
    JSON.stringify({ name: 'Prueba', slug, model: 'faux-1', description: 'Perfil de prueba' }),
  );
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Trabaja con cuidado\n');
  const previous = process.env.AGENTS_HOME;
  process.env.AGENTS_HOME = home;
  try {
    const data = validateOnboarding(valid);
    const onboardedAt = savePortableOnboarding(slug, data);
    assert.ok(Number.isFinite(onboardedAt));
    const profile = loadAgentProfile(slug);
    assert.equal(profile.identity, data.identityMarkdown.trim());
    assert.equal(profile.user, data.userMarkdown.trim());
    assert.equal(profile.onboarded_at, onboardedAt);
    assert.ok(fs.readFileSync(path.join(dir, 'USER.md'), 'utf8').length <= 4001);
  } finally {
    if (previous === undefined) delete process.env.AGENTS_HOME;
    else process.env.AGENTS_HOME = previous;
  }
});
