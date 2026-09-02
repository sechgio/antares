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

  it('dedupes concurrent formatosList calls', async () => {
    mockInvoke.mockImplementation(async () => ({ formats: [] }));
    const [a, b] = await Promise.all([api.formatosList(), api.formatosList()]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('formatos_list', undefined);
    expect(a).toEqual({ formats: [] });
    expect(b).toEqual({ formats: [] });
  });

  it('formatos mutations invalidate formatos_list cache', async () => {
    mockInvoke.mockResolvedValueOnce({ formats: [{ id: 'f1' }] });
    await api.formatosList();
    mockInvoke.mockResolvedValueOnce({ formats: [{ id: 'f1' }] });
    await api.formatosList();
    expect(mockInvoke).toHaveBeenCalledTimes(1); // served from cache
    mockInvoke.mockResolvedValueOnce({ format: { id: 'f2' } });
    await api.formatosUpload({ nombre: 'n', filename: 'f.pdf', content_b64: 'x' });
    expect(mockInvoke).toHaveBeenCalledTimes(2); // upload invalidates
    mockInvoke.mockResolvedValueOnce({ formats: [{ id: 'f1' }, { id: 'f2' }] });
    await api.formatosList();
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    mockInvoke.mockResolvedValueOnce({ deleted: true });
    await api.formatosDelete('f2');
    expect(mockInvoke).toHaveBeenCalledTimes(4); // delete invalidates
    mockInvoke.mockResolvedValueOnce({ formats: [{ id: 'f1' }] });
    await api.formatosList();
    expect(mockInvoke).toHaveBeenCalledTimes(5);
    mockInvoke.mockResolvedValueOnce({ format: { id: 'f1' } });
    await api.formatosUpdateMapping('f1', {} as never);
    expect(mockInvoke).toHaveBeenCalledTimes(6); // updateMapping invalidates
    mockInvoke.mockResolvedValueOnce({ formats: [{ id: 'f1' }] });
    await api.formatosList();
    expect(mockInvoke).toHaveBeenCalledTimes(7);
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

  it('does not repopulate an invalidated cache with an in-flight result', async () => {
    let resolveColumns: (value: { columns: string[]; records: any[]; total: number }) => void = () => {};
    const pendingColumns = new Promise<{ columns: string[]; records: any[]; total: number }>((resolve) => {
      resolveColumns = resolve;
    });
    mockInvoke.mockImplementation((method: string) => {
      if (method === 'db_columns') return pendingColumns;
      if (method === 'db_clear') return Promise.resolve({ cleared: 1 });
      throw new Error(`Unexpected method: ${method}`);
    });

    const staleRead = api.getDbColumns();
    await Promise.resolve();
    await api.clearDatabase();
    resolveColumns({ columns: ['old'], records: [], total: 0 });
    await staleRead;

    mockInvoke.mockResolvedValueOnce({ columns: ['new'], records: [], total: 0 });
    await expect(api.getDbColumns()).resolves.toEqual({ columns: ['new'], records: [], total: 0 });
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it('invalidates fields and columns together after catalog mutations', async () => {
    mockInvoke
      .mockResolvedValueOnce({ fields: [{ name: 'codigo', type: 'TEXT' }] })
      .mockResolvedValueOnce({ columns: ['codigo'], records: [], total: 0 });
    await api.getFields();
    await api.getDbColumns();

    mockInvoke.mockResolvedValueOnce({ imported: 1 });
    await api.importExcel('catalogo.xlsx');

    mockInvoke
      .mockResolvedValueOnce({ fields: [{ name: 'codigo', type: 'TEXT' }, { name: 'marca', type: 'TEXT' }] })
      .mockResolvedValueOnce({ columns: ['codigo', 'marca'], records: [], total: 0 });
    await api.getFields();
    await api.getDbColumns();

    expect(mockInvoke).toHaveBeenCalledTimes(5);
  });

  it('clearing records invalidates columns without refetching fields', async () => {
    mockInvoke
      .mockResolvedValueOnce({ fields: [{ name: 'codigo', type: 'TEXT' }] })
      .mockResolvedValueOnce({ columns: ['codigo'], records: [], total: 1 });
    await api.getFields();
    await api.getDbColumns();

    mockInvoke.mockResolvedValueOnce({ cleared: 1 });
    await api.clearDatabase();

    mockInvoke.mockResolvedValueOnce({ columns: ['codigo'], records: [], total: 0 });
    await api.getFields();
    await api.getDbColumns();

    expect(mockInvoke).toHaveBeenCalledTimes(4);
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
