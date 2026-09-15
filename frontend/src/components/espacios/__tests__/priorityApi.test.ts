import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTarea, fetchTareas, updateTarea } from '../api/espaciosApi';
import type { TareaPriority } from '../types';

const { query, from } = vi.hoisted(() => {
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), insert: vi.fn(),
    update: vi.fn(), single: vi.fn(),
  };
  return { query, from: vi.fn() };
});

vi.mock('../../../lib/supabase', () => ({ supabase: { from } }));

beforeEach(() => {
  vi.resetAllMocks();
  from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.insert.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.single.mockResolvedValue({
    data: { id: 'task-1', status: 'in_progress', priority: 'urgent' }, error: null,
  });
});

describe('priority persistence', () => {
  it('creates an urgent task without moving it out of its custom status', async () => {
    await createTarea('project-1', {
      title: 'Informe', status: 'review', priority: 'urgent',
    }, 'user-1');
    expect(from).toHaveBeenCalledWith('tareas');
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      proyecto_id: 'project-1', status: 'review', priority: 'urgent', created_by: 'user-1',
    }));
  });

  it('gives regular creation a normal priority when omitted', async () => {
    await createTarea('project-1', { title: 'Informe' }, 'user-1');
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'todo', priority: 'normal' }));
  });

  it('preserves explicit low priority in the legacy urgent column', async () => {
    await createTarea('project-1', { title: 'Informe', status: 'urgent', priority: 'low' }, 'user-1');
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'urgent', priority: 'low' }));
  });

  it('supports legacy creation inputs without priority', async () => {
    await createTarea('project-1', { title: 'Informe', status: 'urgent' }, 'user-1');
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'urgent', priority: 'urgent' }));
  });

  it('changes priority without submitting a replacement status', async () => {
    await updateTarea('task-1', { priority: 'high' });
    expect(query.update).toHaveBeenCalledWith({ priority: 'high' });
    expect(query.eq).toHaveBeenCalledWith('id', 'task-1');
  });

  it('does not reset priority when only status changes', async () => {
    await updateTarea('task-1', { status: 'done' });
    expect(query.update).toHaveBeenCalledWith({ status: 'done' });
  });

  it('selects persisted priority within the requested project', async () => {
    const rows = [{ id: 'task-1', priority: 'low' }];
    query.order.mockReturnValueOnce(query).mockResolvedValueOnce({ data: rows, error: null });
    await expect(fetchTareas('project-1')).resolves.toEqual(rows);
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('status, priority, assignee_id'));
    expect(query.eq).toHaveBeenCalledWith('proyecto_id', 'project-1');
  });

  it('rejects invalid runtime priorities before issuing a write', async () => {
    const invalid = 'invalid' as TareaPriority;
    await expect(createTarea('project-1', { title: 'Informe', priority: invalid }, 'user-1')).rejects.toThrow('Prioridad de tarea no válida');
    await expect(updateTarea('task-1', { priority: invalid })).rejects.toThrow('Prioridad de tarea no válida');
    expect(from).not.toHaveBeenCalled();
  });

  it.each(['42703', 'PGRST204'])('reports missing schema without silently dropping priority (%s)', async (code) => {
    query.single.mockResolvedValue({ data: null, error: { code, message: 'Missing priority column' } });
    await expect(updateTarea('task-1', { priority: 'urgent' })).rejects.toThrow('Falta aplicar la migración de prioridad');
    expect(query.update).toHaveBeenCalledTimes(1);
  });

  it('propagates permission errors instead of treating them as schema errors', async () => {
    query.single.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(updateTarea('task-1', { priority: 'urgent' })).rejects.toThrow('permission denied [42501]');
  });
});
