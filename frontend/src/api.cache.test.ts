import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, invalidateApiCache } from './api';

const mockInvoke = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  invalidateApiCache();
  window.electronAPI = {
    invoke: mockInvoke,
    onNotify: vi.fn(() => () => {}),
  } as any;
});

describe('api cache dedupe', () => {
  it('dedupes concurrent templatesList calls', async () => {
    mockInvoke.mockImplementation(async () => ({ templates: [] }));
    const [a, b] = await Promise.all([api.templatesList(), api.templatesList()]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('templates_list', undefined);
    expect(a).toEqual({ templates: [] });
    expect(b).toEqual({ templates: [] });
  });

  it('caches sequential calls within TTL', async () => {
    mockInvoke.mockResolvedValue({ formats: ['JPEG'] });
    const first = await api.formats();
    const second = await api.formats();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('invalidates cache on demand', async () => {
    mockInvoke.mockResolvedValue({ fields: [] });
    await api.getFields();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    invalidateApiCache('db_fields');
    await api.getFields();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent getFields calls', async () => {
    mockInvoke.mockImplementation(async () => ({ fields: [] }));
    const [a, b, c] = await Promise.all([api.getFields(), api.getFields(), api.getFields()]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ fields: [] });
    expect(b).toEqual({ fields: [] });
    expect(c).toEqual({ fields: [] });
  });

  it('dedupes concurrent getRenamePatterns calls', async () => {
    mockInvoke.mockResolvedValue({ patterns: [] });
    const [a, b] = await Promise.all([api.getRenamePatterns(), api.getRenamePatterns()]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ patterns: [] });
    expect(b).toEqual({ patterns: [] });
  });

  it('dedupes concurrent getDbColumns calls', async () => {
    mockInvoke.mockResolvedValue({ columns: [], records: [], total: 0 });
    const [a, b] = await Promise.all([api.getDbColumns(), api.getDbColumns()]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent getTheme calls', async () => {
    mockInvoke.mockResolvedValue({ name: 'test' });
    const [a, b] = await Promise.all([api.getTheme(), api.getTheme()]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('mutating call invalidates theme_get', async () => {
    mockInvoke.mockResolvedValueOnce({ name: 'a' });
    await api.getTheme();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // next getTheme should be cached
    await api.getTheme();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // mutating saveTheme should invalidate
    mockInvoke.mockResolvedValueOnce({ name: 'b' });
    await api.saveTheme({ name: 'b' } as any);
    // after invalidation, next getTheme should invoke again
    mockInvoke.mockResolvedValueOnce({ name: 'b' });
    await api.getTheme();
    expect(mockInvoke).toHaveBeenCalledTimes(3); // getTheme, saveTheme, getTheme
  });

  it('does not cache failed invokes', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('fail'));
    await expect(api.formats()).rejects.toThrow('fail');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    mockInvoke.mockResolvedValueOnce({ formats: ['PNG'] });
    const res = await api.formats();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ formats: ['PNG'] });
  });

  it('invalidateApiCache without key clears all', async () => {
    mockInvoke.mockResolvedValue({ formats: ['JPEG'] });
    await api.formats();
    mockInvoke.mockResolvedValue({ fields: [] });
    await api.getFields();
    // both cached now
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    invalidateApiCache();
    mockInvoke.mockResolvedValue({ formats: ['JPEG'] });
    await api.formats();
    mockInvoke.mockResolvedValue({ fields: [] });
    await api.getFields();
    expect(mockInvoke).toHaveBeenCalledTimes(4);
  });
});
