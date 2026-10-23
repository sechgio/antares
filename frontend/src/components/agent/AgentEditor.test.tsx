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
  const create = screen.getByRole('button', { name: 'Crear agente' });
  expect(create).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Nombre del agente'), { target: { value: 'Informe mensual' } });
  fireEvent.change(screen.getByLabelText('Indicaciones del agente'), { target: { value: 'Usa la plantilla de cortes' } });
  fireEvent.change(screen.getByLabelText('Mensaje inicial del agente'), { target: { value: 'Prepara el informe' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Usar todas las herramientas' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Permitir templates_catalog' }));
  await act(async () => { fireEvent.click(create); });
  expect(save).toHaveBeenCalledWith({ name: 'Informe mensual', description: '', instructions: 'Usa la plantilla de cortes',
    starter: 'Prepara el informe', tools: ['templates_catalog'] });
  expect(onSaved).toHaveBeenCalledWith(saved);
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

it('muestra el error del runtime sin cerrar el editor', async () => {
  vi.spyOn(agentApi, 'agentProfileSave').mockRejectedValue(new Error('Un agente no guarda contraseñas, claves ni tokens'));
  const onSaved = vi.fn();
  await act(async () => { render(<AgentEditor profile={saved} onClose={vi.fn()} onSaved={onSaved} onDeleted={vi.fn()} />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
  expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  expect(onSaved).not.toHaveBeenCalled();
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
