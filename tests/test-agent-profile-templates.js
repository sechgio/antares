'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { exportTemplate, validateTemplate, TEMPLATE_FORMAT } = require('../electron/agent-profile-templates');

const profile = {
  id: 'abc123',
  name: 'Revisor fiscal',
  color: '#FFAA00',
  description: 'Revisa facturas',
  role: 'reviewer',
  instructions: 'Sé riguroso',
  starter: 'Hola',
  tools: ['fs_read', 'fs_write'],
  tools_deny: ['shell_run'],
  memory_scope: 'own',
  daily_tokens: 50000,
  model: { provider: 'openai', model: 'gpt-4' },
  created_at: 1,
  updated_at: 2,
};

test('export omite identidad local y estado, conserva configuración', () => {
  const bundle = exportTemplate(profile);
  assert.equal(bundle.format, TEMPLATE_FORMAT);
  assert.equal(bundle.name, 'Revisor fiscal');
  assert.deepEqual(bundle.tools, ['fs_read', 'fs_write']);
  assert.deepEqual(bundle.tools_deny, ['shell_run']);
  assert.equal(bundle.memory_scope, 'own');
  assert.deepEqual(bundle.model, { provider: 'openai', model: 'gpt-4' });
  assert.ok(!('id' in bundle) && !('created_at' in bundle) && !('updated_at' in bundle), 'sin identidad ni timestamps locales');
});

test('export de perfil mínimo no inventa campos', () => {
  const bundle = exportTemplate({ id: 'x', name: 'n', role: 'explorer', instructions: 'i', tools: null });
  assert.deepEqual(Object.keys(bundle).filter((k) => k !== 'format').sort(), ['instructions', 'name', 'role']);
  assert.ok(!('tools' in bundle), 'tools null significa todas: no se exporta');
});

test('validate acepta exportación roundtrip y produce params de creación', () => {
  const params = validateTemplate(exportTemplate(profile));
  assert.equal(params.name, 'Revisor fiscal');
  assert.equal(params.role, 'reviewer');
  assert.deepEqual(params.tools, ['fs_read', 'fs_write']);
  assert.equal(params.daily_tokens, 50000);
});

test('validate rechaza formato desconocido, campos extra y tipos malos', () => {
  assert.throws(() => validateTemplate(null), /objeto JSON/);
  assert.throws(() => validateTemplate({ format: 'otro/v9', name: 'x' }), /Formato de plantilla no reconocido/);
  assert.throws(() => validateTemplate({ format: TEMPLATE_FORMAT }), /necesita un nombre/);
  assert.throws(() => validateTemplate({ format: TEMPLATE_FORMAT, name: 'x', api_key: 'secreto' }), /campos no reconocidos/);
  assert.throws(() => validateTemplate({ format: TEMPLATE_FORMAT, name: 'x', tools: 'fs_read' }), /lista de texto/);
  assert.throws(() => validateTemplate({ format: TEMPLATE_FORMAT, name: 'x', tools: [1] }), /lista de texto/);
  assert.throws(() => validateTemplate({ format: TEMPLATE_FORMAT, name: 'x', model: { provider: 1 } }), /proveedor y modelo/);
  assert.throws(() => validateTemplate({ format: TEMPLATE_FORMAT, name: 'x', daily_tokens: 'mil' }), /entero/);
});

test('validate rechaza plantillas gigantes', () => {
  const big = { format: TEMPLATE_FORMAT, name: 'x', instructions: 'y'.repeat(70 * 1024) };
  assert.throws(() => validateTemplate(big), /tamaño máximo/);
});
