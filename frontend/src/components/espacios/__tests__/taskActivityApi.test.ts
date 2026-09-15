import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTaskComment,
  deleteTaskComment,
  fetchTaskActivity,
  fetchTaskComments,
  updateTaskComment,
} from '../api/espaciosApi';

const { from, query } = vi.hoisted(() => {
  const query = {
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    eq: vi.fn(), order: vi.fn(), single: vi.fn(),
  };
  return { from: vi.fn(), query };
});

vi.mock('../../../lib/supabase', () => ({ supabase: { from } }));

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue(query);
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'order'] as const) {
    query[method].mockReturnValue(query);
  }
  query.single.mockResolvedValue({ data: { id: 'comment-1', body: 'Texto' }, error: null });
  query.order.mockResolvedValue({ data: [], error: null });
});

describe('task comments API', () => {
  it('fetches comments in chronological order', async () => {
    await fetchTaskComments('task-1');
    expect(from).toHaveBeenCalledWith('tarea_comments');
    expect(query.eq).toHaveBeenCalledWith('tarea_id', 'task-1');
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('creates a trimmed comment for the current user', async () => {
    await createTaskComment('task-1', '  Falta revisar.  ', 'user-1');
    expect(query.insert).toHaveBeenCalledWith({ tarea_id: 'task-1', body: 'Falta revisar.', author_id: 'user-1' });
  });

  it('rejects an empty comment before calling Supabase', async () => {
    await expect(createTaskComment('task-1', '   ', 'user-1')).rejects.toThrow('comentario vacío');
    expect(from).not.toHaveBeenCalled();
  });

  it('updates and deletes comments through the API layer', async () => {
    await updateTaskComment('comment-1', '  Corregido  ');
    expect(query.update).toHaveBeenCalledWith({ body: 'Corregido' });
    await deleteTaskComment('comment-1');
    expect(query.delete).toHaveBeenCalled();
  });
});

describe('task activity API', () => {
  it('fetches immutable activity in chronological order', async () => {
    await fetchTaskActivity('task-1');
    expect(from).toHaveBeenCalledWith('tarea_activity');
    expect(query.eq).toHaveBeenCalledWith('tarea_id', 'task-1');
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });
});
