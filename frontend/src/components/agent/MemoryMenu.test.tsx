import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentMemoryItem } from '../../api/agentApi';
import MemoryMenu from './MemoryMenu';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));

const procedure: AgentMemoryItem = {
  id: 'm1', kind: 'procedure', title: 'Informe mensual', status: 'active', reason: null, version: 2, updated_at: 2,
  when: 'Cuando pidan el informe mensual', steps: [{ tool: 'artifact_print', purpose: 'Imprimir el PDF revisado' }],
  source: { kind: 'agent', session_id: 's1', op_ids: ['op1', 'op2'] },
  versions: [{ version: 1, created_at: 1, source: { kind: 'agent' } }, { version: 2, created_at: 2, source: { kind: 'agent' } }],
};
const suspended: AgentMemoryItem = {
  ...procedure, id: 'm2', title: 'Sellado', status: 'suspended', reason: 'La herramienta sellador_apply cambió', version: 1,
  versions: [{ version: 1, created_at: 1, source: { kind: 'agent' } }],
};
const journal: AgentMemoryItem = {
  id: 'j1', kind: 'journal', title: 'Visita de obra', status: 'active', reason: null, version: 1, updated_at: 1,
  date: '2026-10-30', content: 'Se revisó el metrado',
  source: { kind: 'agent', session_id: 's1' },
  versions: [{ version: 1, created_at: 1, source: { kind: 'agent', session_id: 's1' } }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  confirm.mockReset();
  vi.spyOn(agentApi, 'agentMemoryList').mockResolvedValue({ items: [procedure, suspended] });
});

async function open() {
  render(<MemoryMenu />);
  await act(async () => { fireEvent.click(screen.getByLabelText('Memoria del agente')); });
}

it('muestra qué aprendió, su fuente, su versión y por qué se suspendió', async () => {
  await open();
  expect(screen.getByText('Informe mensual')).toBeInTheDocument();
  expect(screen.getAllByText('Aprendido de 2 comprobantes')).toHaveLength(2);
  expect(screen.getAllByText('v2')).toHaveLength(1);
  expect(screen.getByText('Suspendido: La herramienta sellador_apply cambió')).toBeInTheDocument();
  expect(screen.getByText(/no conceden permisos/)).toBeInTheDocument();
});

it('corrige, revierte y desactiva creando versiones por el usuario', async () => {
  const corrected = { ...procedure, version: 3, when: 'Solo el día 1', source: { kind: 'user' as const } };
  const update = vi.spyOn(agentApi, 'agentMemoryUpdate').mockResolvedValue({ item: corrected });
  await open();
  fireEvent.click(screen.getAllByText('Corregir')[0]);
  fireEvent.change(screen.getByLabelText('Corregir Informe mensual'), { target: { value: 'Solo el día 1' } });
  await act(async () => { fireEvent.click(screen.getByText('Guardar corrección')); });
  expect(update).toHaveBeenLastCalledWith({ id: 'm1', action: 'edit', when: 'Solo el día 1' });
  expect(screen.getByText('Corregido por ti')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByText('Volver a v2')); });
  expect(update).toHaveBeenLastCalledWith({ id: 'm1', action: 'revert', version: 2 });
  await act(async () => { fireEvent.click(screen.getByText('Activar')); });
  expect(update).toHaveBeenLastCalledWith({ id: 'm2', action: 'enable' });
});

it('borra sólo tras confirmar', async () => {
  const remove = vi.spyOn(agentApi, 'agentMemoryDelete').mockResolvedValue({ deleted: true });
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await open();
  await act(async () => { fireEvent.click(screen.getAllByText('Borrar')[0]); });
  expect(remove).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getAllByText('Borrar')[0]); });
  expect(remove).toHaveBeenCalledWith('m1');
  expect(screen.queryByText('Informe mensual')).not.toBeInTheDocument();
});

it('hace visible el alcance de la memoria por perfil y la prioridad del pedido y las indicaciones del agente', async () => {
  vi.mocked(agentApi.agentMemoryList).mockResolvedValue({ items: [{
    id: 'p1', kind: 'preference', title: 'Estilo', content: 'Breve y cálido', status: 'active', reason: null,
    version: 1, updated_at: 1, source: { kind: 'agent', session_id: 's1' },
    versions: [{ version: 1, created_at: 1, source: { kind: 'agent', session_id: 's1' } }],
  }] });
  await open();
  expect(screen.getByText(/Cada perfil conserva sus propios recuerdos; los recuerdos globales anteriores siguen disponibles/)).toBeVisible();
  expect(screen.getByText(/Tu pedido actual tiene prioridad; después, las indicaciones del agente y, por último, las preferencias de memoria/)).toBeVisible();
  expect(screen.getByText('Indicado en una conversación')).toBeInTheDocument();
});

it('corrige la fecha del diario junto con su contenido', async () => {
  const corrected = { ...journal, version: 2, source: { kind: 'user' as const } };
  const update = vi.spyOn(agentApi, 'agentMemoryUpdate').mockResolvedValue({ item: corrected });
  vi.mocked(agentApi.agentMemoryList).mockResolvedValue({ items: [journal] });
  await open();
  fireEvent.click(screen.getByText('Corregir'));
  fireEvent.change(screen.getByLabelText('Fecha de Visita de obra'), { target: { value: '2026-11-02' } });
  await act(async () => { fireEvent.click(screen.getByText('Guardar corrección')); });
  expect(update).toHaveBeenLastCalledWith({ id: 'j1', action: 'edit', content: 'Se revisó el metrado', date: '2026-11-02' });
});

it('muestra el diario con su etiqueta y su fecha', async () => {
  vi.mocked(agentApi.agentMemoryList).mockResolvedValue({ items: [journal] });
  await open();
  expect(screen.getByText('Diario')).toBeInTheDocument();
  expect(screen.getByText('2026-10-30')).toBeInTheDocument();
  expect(screen.getByText('Se revisó el metrado')).toBeInTheDocument();
  expect(screen.getByText('Indicado en una conversación')).toBeInTheDocument();
});
