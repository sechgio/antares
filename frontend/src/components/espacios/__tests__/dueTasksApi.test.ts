import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDueSoonTareas } from '../api/espaciosApi';

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(), eq: vi.fn(), lte: vi.fn(), order: vi.fn(), range: vi.fn(),
  };
  return { query, from: vi.fn() };
});
vi.mock('../../../lib/supabase', () => ({ supabase: { from: mocks.from } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue(mocks.query);
  for (const fn of [mocks.query.select, mocks.query.eq, mocks.query.lte, mocks.query.order]) fn.mockReturnValue(mocks.query);
  mocks.query.range.mockResolvedValue({ data: [], error: null });
});

describe('due tasks query', () => {
  it('filters completed tasks before paginating and fetches every page', async () => {
    const page = Array.from({ length: 200 }, (_, i) => ({ id: `task-${i}`, status_is_done: false }));
    const last = { id: 'last-open-task', status_is_done: false };
    mocks.query.range.mockResolvedValueOnce({ data: page, error: null }).mockResolvedValueOnce({ data: [last], error: null });
    const rows = await fetchDueSoonTareas('2026-10-04');
    expect(mocks.from).toHaveBeenCalledWith('tareas_vencimientos');
    expect(mocks.query.eq).toHaveBeenCalledWith('status_is_done', false);
    expect(mocks.query.lte).toHaveBeenCalledWith('due_date', '2026-10-04');
    expect(mocks.query.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(mocks.query.range.mock.calls).toEqual([[0, 199], [200, 399]]);
    expect(rows).toEqual([...page, last]);
  });

  it('applies the personal scope in the server query', async () => {
    await fetchDueSoonTareas('2026-10-04', 'user-1');
    expect(mocks.query.eq).toHaveBeenCalledWith('assignee_id', 'user-1');
  });

  it('does not constrain team notifications to an assignee', async () => {
    await fetchDueSoonTareas('2026-10-04');
    expect(mocks.query.eq).not.toHaveBeenCalledWith('assignee_id', expect.anything());
  });

  it('rejects a failed later page instead of presenting a partial count', async () => {
    mocks.query.range.mockResolvedValueOnce({ data: Array(200).fill({ id: 'task' }), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Sin conexión' } });
    await expect(fetchDueSoonTareas('2026-10-04')).rejects.toThrow('Sin conexión');
  });
});
