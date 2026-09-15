import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMyTaskOrigins, fetchMyTasks, MY_TASKS_PAGE_SIZE } from '../api/espaciosApi';

const { from, query } = vi.hoisted(() => {
  const query = {
    select: vi.fn(), eq: vi.fn(), or: vi.fn(), order: vi.fn(), range: vi.fn(),
  };
  return { from: vi.fn(), query };
});

vi.mock('../../../lib/supabase', () => ({ supabase: { from } }));

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue({ data: [], error: null });
});

describe('fetchMyTasks', () => {
  it('uses one direct view query and excludes completed tasks by default', async () => {
    await fetchMyTasks();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('mis_tareas');
    expect(query.eq).toHaveBeenCalledWith('status_is_done', false);
    expect(query.range).toHaveBeenCalledWith(0, MY_TASKS_PAGE_SIZE - 1);
  });

  it('combines search, priority, completion, space and project on the server', async () => {
    await fetchMyTasks({
      search: 'informe', priority: 'high', completion: 'completed',
      espacioId: 'space-1', proyectoId: 'project-1',
    });
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining('title.ilike.%informe%'));
    expect(query.eq).toHaveBeenCalledWith('priority', 'high');
    expect(query.eq).toHaveBeenCalledWith('status_is_done', true);
    expect(query.eq).toHaveBeenCalledWith('espacio_id', 'space-1');
    expect(query.eq).toHaveBeenCalledWith('proyecto_id', 'project-1');
  });

  it('does not add a completion predicate for the explicit all filter', async () => {
    await fetchMyTasks({ completion: 'all' });
    expect(query.eq).not.toHaveBeenCalledWith('status_is_done', expect.anything());
  });

  it('paginates without silently truncating later assignments', async () => {
    await fetchMyTasks({}, MY_TASKS_PAGE_SIZE);
    expect(query.range).toHaveBeenCalledWith(MY_TASKS_PAGE_SIZE, (MY_TASKS_PAGE_SIZE * 2) - 1);
  });

  it('can refresh every page already visible after an invalidation', async () => {
    await fetchMyTasks({}, 0, MY_TASKS_PAGE_SIZE * 3);
    expect(query.range).toHaveBeenCalledWith(0, (MY_TASKS_PAGE_SIZE * 3) - 1);
  });

  it('loads compact project and space origins independently of task pages', async () => {
    await expect(fetchMyTaskOrigins()).resolves.toEqual([]);
    expect(from).toHaveBeenCalledWith('mis_tareas_origenes');
    expect(query.select).toHaveBeenCalledWith('proyecto_id, proyecto_name, espacio_id, espacio_name');
  });
});
