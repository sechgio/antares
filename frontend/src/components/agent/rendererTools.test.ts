import { afterEach, expect, it, vi } from 'vitest';
import { executeRendererTool } from './rendererTools';
import { registerAgentCanvasEditor } from './canvasEditor';
import { createEmptyDocument } from '../canvas/types';

const external = vi.hoisted(() => ({ getUser: vi.fn(), createEspacio: vi.fn(), fetchEspacios: vi.fn(), updateTarea: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: external.getUser } } }));
vi.mock('../espacios/api/espaciosApi', () => ({ createEspacio: external.createEspacio, fetchEspacios: external.fetchEspacios, updateTarea: external.updateTarea }));

afterEach(() => vi.restoreAllMocks());

it('los descriptores de Padrones y Volantes salen de sus contratos actuales', async () => {
  const padron = await executeRendererTool('padron_describe', {}) as { fields: unknown[]; formats: { value: string }[] };
  expect(padron.fields.length).toBeGreaterThan(0);
  expect(padron.formats.map((item) => item.value)).toContain('water-cut-notice');
  await expect(executeRendererTool('volantes_describe', {})).resolves.toMatchObject({ required: expect.arrayContaining(['reservorio']) });
});

it('datos ausentes y formatos inválidos no generan un PDF', async () => {
  await expect(executeRendererTool('padron_export_pdf', { format: 'inventado' })).rejects.toThrow('Formato');
  await expect(executeRendererTool('volantes_export_pdf', { rows: [{ distrito: 'Lima' }] })).rejects.toThrow('Completa');
});

it('una plantilla con editor dirty no se exporta ni se cambia', async () => {
  const doc = createEmptyDocument('Prueba');
  const apply = vi.fn();
  const release = registerAgentCanvasEditor({ get: () => doc, dirty: () => true, apply, open: vi.fn() });
  try {
    await expect(executeRendererTool('document_render', { document: doc })).rejects.toThrow('cambios sin guardar');
    await expect(executeRendererTool('canvas_fill_fields', { id: doc.id, values: { NOMBRE: 'Ana' } })).rejects.toThrow('cambios sin guardar');
    expect(apply).not.toHaveBeenCalled();
  } finally { release(); }
});

it('un nombre de herramienta no permite ejecutar código arbitrario', async () => {
  await expect(executeRendererTool('eval', { code: 'alert(1)' })).rejects.toThrow('no disponible');
});

it('Espacios exige sesión y revalida la cuenta antes de aplicar la acción', async () => {
  external.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(executeRendererTool('espacios_list', {})).rejects.toThrow('Inicia sesión');
  external.getUser.mockResolvedValue({ data: { user: { id: 'account-b', email: 'prueba@example.invalid' } }, error: null });
  await expect(executeRendererTool('espacios_espacio_create', { _expected_account_id: 'account-a', input: { name: 'Equipo' } })).rejects.toThrow('cuenta cambió');
  expect(external.createEspacio).not.toHaveBeenCalled();
  external.createEspacio.mockResolvedValue({ id: 'space1' });
  await expect(executeRendererTool('espacios_espacio_create', { _expected_account_id: 'account-b', input: { name: 'Equipo' } })).resolves.toEqual({ id: 'space1' });
  expect(external.createEspacio).toHaveBeenCalledWith('Equipo', 'account-b', undefined);
  external.createEspacio.mockClear();
  await expect(executeRendererTool('espacios_espacio_create', { _expected_account_id: 'account-b', input: { name: ' ' } })).rejects.toThrow('Completa');
  expect(external.createEspacio).not.toHaveBeenCalled();
  await expect(executeRendererTool('espacios_espacio_update', { id: 'space1', input: { owner_id: 'account-a' } })).rejects.toThrow('no permitido');
});

it('una respuesta perdida tras una escritura de Espacios conserva la incertidumbre', async () => {
  external.getUser.mockResolvedValue({ data: { user: { id: 'account-a' } }, error: null });
  external.createEspacio.mockRejectedValue(new Error('TypeError: Failed to fetch'));
  await expect(executeRendererTool('espacios_espacio_create', { input: { name: 'Equipo' } })).rejects.toMatchObject({ name: 'AgentEffectUncertainError' });
  external.createEspacio.mockRejectedValue(new Error('Permiso denegado [42501]'));
  await expect(executeRendererTool('espacios_espacio_create', { input: { name: 'Equipo' } })).rejects.toMatchObject({ name: 'Error' });
});

it('actualizar una tarea exige la revisión y la transmite sin cambiarla', async () => {
  external.getUser.mockResolvedValue({ data: { user: { id: 'account-a' } }, error: null });
  external.updateTarea.mockClear();
  const params = { id: 'task-1', input: { title: 'Corregida' } };
  await expect(executeRendererTool('espacios_tarea_update', params)).rejects.toThrow('Consulta la revisión');
  expect(external.updateTarea).not.toHaveBeenCalled();

  const revision = '2026-10-13T10:00:00Z';
  external.updateTarea.mockResolvedValue({ id: 'task-1', title: 'Corregida' });
  await expect(executeRendererTool('espacios_tarea_update', { ...params, expected_updated_at: revision }))
    .resolves.toMatchObject({ id: 'task-1' });
  expect(external.updateTarea).toHaveBeenCalledWith('task-1', params.input, revision);
});
