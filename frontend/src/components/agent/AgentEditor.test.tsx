import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentProfile } from '../../api/agentApi';
import AgentEditor from './AgentEditor';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));

const saved: AgentProfile = {
  id: 'p1', name: 'Informe mensual', description: 'Cortes', instructions: 'Usa la plantilla de cortes',
  starter: 'Prepara el informe', tools: ['templates_catalog'], created_at: 1, updated_at: 1,
};

beforeEach(() => {
  vi.restoreAllMocks();
  confirm.mockReset();
  vi.spyOn(agentApi, 'agentToolsList').mockResolvedValue({ tools: [
    { name: 'templates_catalog', kind: 'backend', gated: false },
    { name: 'artifact_print', kind: 'backend', gated: true },
  ] });
});

it('crea un agente con indicaciones y solo las herramientas elegidas', async () => {
  const save = vi.spyOn(agentApi, 'agentProfileSave').mockResolvedValue({ profile: saved });
  const onSaved = vi.fn();
  await act(async () => { render(<AgentEditor profile={null} onClose={vi.fn()} onSaved={onSaved} onDeleted={vi.fn()} />); });
  const create = screen.getByRole('button', { name: 'Crear y chatear' });
  expect(create).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Nombre del agente'), { target: { value: 'Informe mensual' } });
  fireEvent.change(screen.getByLabelText('Indicaciones del agente'), { target: { value: 'Usa la plantilla de cortes' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Color Verde' }));
  fireEvent.click(screen.getByText('Opciones avanzadas'));
  fireEvent.change(screen.getByLabelText('Mensaje inicial del agente'), { target: { value: 'Prepara el informe' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Usar todas las herramientas' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Permitir templates_catalog' }));
  await act(async () => { fireEvent.click(create); });
  expect(save).toHaveBeenCalledWith({ name: 'Informe mensual', color: '#0E7490', description: '', role: 'explorer', instructions: 'Usa la plantilla de cortes',
    starter: 'Prepara el informe', tools: ['templates_catalog'] });
  expect(onSaved).toHaveBeenCalledWith(saved);
});

it('permite empezar con nombre e instrucción sin abrir las opciones avanzadas', async () => {
  const save = vi.spyOn(agentApi, 'agentProfileSave').mockResolvedValue({ profile: saved });
  await act(async () => { render(<AgentEditor profile={null} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />); });
  expect(screen.getByLabelText('Descripción del agente')).not.toBeVisible();
  expect(screen.getByRole('radio', { name: 'Color Automático' })).toBeChecked();
  fireEvent.change(screen.getByLabelText('Nombre del agente'), { target: { value: 'Revisor' } });
  fireEvent.change(screen.getByLabelText('Indicaciones del agente'), { target: { value: 'Revisa mis informes' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Crear y chatear' })); });
  expect(save).toHaveBeenCalledWith({ name: 'Revisor', color: '', role: 'explorer', instructions: 'Revisa mis informes', description: '', starter: '', tools: null });
});

it('conserva el color al editar y permite volver al automático', async () => {
  const save = vi.spyOn(agentApi, 'agentProfileSave').mockResolvedValue({ profile: saved });
  await act(async () => { render(<AgentEditor profile={{ ...saved, color: '#0E7490' }} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />); });
  expect(screen.getByRole('radio', { name: 'Color Verde' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Color Automático' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id, color: '' }));
});

it('admite el envío del formulario y bloquea duplicados y cierre mientras guarda', async () => {
  let finish!: (result: { profile: AgentProfile }) => void;
  const save = vi.spyOn(agentApi, 'agentProfileSave').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const onClose = vi.fn();
  const onSaved = vi.fn();
  await act(async () => { render(<AgentEditor profile={saved} onClose={onClose} onSaved={onSaved} onDeleted={vi.fn()} />); });
  const form = screen.getByRole('dialog', { name: 'Editar agente Informe mensual' });
  await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(form).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByLabelText('Nombre del agente')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  fireEvent.keyDown(form, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { finish({ profile: saved }); });
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved);
});

it('edita conservando el id y borra solo tras confirmar', async () => {
  const save = vi.spyOn(agentApi, 'agentProfileSave').mockResolvedValue({ profile: saved });
  const remove = vi.spyOn(agentApi, 'agentProfileDelete').mockResolvedValue({ deleted: true });
  const onDeleted = vi.fn();
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await act(async () => { render(<AgentEditor profile={saved} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={onDeleted} />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
  expect(save.mock.calls[0][0]).toMatchObject({ id: 'p1', tools: ['templates_catalog'] });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Borrar' })); });
  expect(remove).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Borrar' })); });
  expect(remove).toHaveBeenCalledWith('p1');
  expect(onDeleted).toHaveBeenCalledWith('p1');
});

it('guarda el rol y advierte del alcance de un worker', async () => {
  const worker: AgentProfile = { ...saved, role: 'worker' };
  const save = vi.spyOn(agentApi, 'agentProfileSave').mockResolvedValue({ profile: worker });
  await act(async () => { render(<AgentEditor profile={saved} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />); });
  expect(screen.getByRole('button', { name: 'Explorador' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Worker' }));
  expect(screen.getByText(/cada acción pedirá tu aprobación/)).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
  expect(save.mock.calls[0][0]).toMatchObject({ id: 'p1', role: 'worker' });
});

it('muestra el error del runtime sin cerrar el editor', async () => {
  vi.spyOn(agentApi, 'agentProfileSave').mockRejectedValue(new Error('Un agente no guarda contraseñas, claves ni tokens'));
  const onSaved = vi.fn();
  await act(async () => { render(<AgentEditor profile={saved} onClose={vi.fn()} onSaved={onSaved} onDeleted={vi.fn()} />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
  expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  expect(screen.getByLabelText('Indicaciones del agente')).toHaveValue(saved.instructions);
});

it('explica la prioridad del pedido y el alcance de los cambios del agente', async () => {
  vi.spyOn(agentApi, 'agentProfileSave').mockResolvedValue({ profile: saved });
  await act(async () => { render(<AgentEditor profile={saved} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />); });
  expect(screen.getByText(/Tu pedido actual tiene prioridad sobre estas indicaciones/)).toHaveTextContent('estas prevalecen sobre las preferencias de memoria');
  expect(screen.getByText(/Las conversaciones existentes conservan las indicaciones con las que se crearon/)).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
  expect(addToast).toHaveBeenCalledWith({
    message: 'Agente actualizado. Los cambios se aplicarán a conversaciones nuevas.', type: 'success',
  });
});
