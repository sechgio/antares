import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('./useToast', () => ({
  useToast: () => ({ addToast: mocks.addToast }),
}));

vi.mock('./useDialog', () => ({
  useDialog: () => ({ confirm: mocks.confirm }),
}));

import { useReportWorkspace, type ReportWorkspaceApi } from './useReportWorkspace';

interface TestReport {
  id: string;
  title: string;
}

interface TestListItem {
  id: string;
}

function makeReport(id: string): TestReport {
  return { id, title: `report-${id}` };
}

function makeApi(overrides: Partial<ReportWorkspaceApi<TestReport, TestListItem>> = {}) {
  return {
    list: vi.fn(async () => ({ reports: [{ id: 'TR-0001' }] })),
    get: vi.fn(async (id: string) => makeReport(id)),
    create: vi.fn(async () => makeReport('TR-0002')),
    update: vi.fn(async (_id: string, report: TestReport) => report),
    delete: vi.fn(async () => ({})),
    clear: vi.fn(async () => ({})),
    importFile: vi.fn(async () => ({ imported_count: 3 })),
    ...overrides,
  };
}

describe('useReportWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(true);
  });

  it('loads reports on mount and clears busy', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));

    await act(async () => Promise.resolve());

    expect(api.list).toHaveBeenCalledWith(true);
    expect(result.current.reports).toEqual([{ id: 'TR-0001' }]);
    expect(result.current.busy).toBe(false);
  });

  it('surfaces load failure as an error toast', async () => {
    const api = makeApi({ list: vi.fn(async () => { throw new Error('backend caído'); }) });
    const { result } = renderHook(() => useReportWorkspace(api));

    await act(async () => Promise.resolve());

    expect(result.current.reports).toEqual([]);
    expect(result.current.busy).toBe(false);
    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'backend caído', type: 'error' });
  });

  it('selects a report and marks the form clean', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());

    await act(async () => {
      await result.current.selectReport('TR-0001');
    });

    expect(api.get).toHaveBeenCalledWith('TR-0001');
    expect(result.current.selectedId).toBe('TR-0001');
    expect(result.current.formData).toEqual(makeReport('TR-0001'));
    expect(result.current.hasChanges).toBe(false);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('tracks dirty state via patchForm and resets on select', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());

    await act(async () => {
      await result.current.selectReport('TR-0001');
    });
    act(() => {
      result.current.patchForm({ id: 'TR-0001', title: 'editado' });
    });
    expect(result.current.hasChanges).toBe(true);

    await act(async () => {
      await result.current.selectReport('TR-0003');
    });
    expect(mocks.confirm).toHaveBeenCalled();
    expect(result.current.selectedId).toBe('TR-0003');
    expect(result.current.hasChanges).toBe(false);
  });

  it('aborts reselect when the dirty confirm is declined', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });
    act(() => {
      result.current.patchForm(makeReport('TR-0001'));
    });

    mocks.confirm.mockResolvedValue(false);
    await act(async () => {
      await result.current.selectReport('TR-0003');
    });

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(result.current.selectedId).toBe('TR-0001');
    expect(result.current.hasChanges).toBe(true);
  });

  it('ignores stale select responses when a newer selection is in flight', async () => {
    let resolveFirst!: (report: TestReport) => void;
    let resolveSecond!: (report: TestReport) => void;
    const api = makeApi({
      get: vi.fn()
        .mockImplementationOnce(() => new Promise<TestReport>((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(() => new Promise<TestReport>((resolve) => { resolveSecond = resolve; })),
    });
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());

    let firstDone: Promise<void> | undefined;
    let secondDone: Promise<void> | undefined;
    act(() => {
      firstDone = result.current.selectReport('TR-OLD');
      secondDone = result.current.selectReport('TR-NEW');
    });

    await act(async () => {
      resolveFirst(makeReport('TR-OLD'));
      resolveSecond(makeReport('TR-NEW'));
      await firstDone;
      await secondDone;
    });

    expect(result.current.selectedId).toBe('TR-NEW');
    expect(result.current.formData).toEqual(makeReport('TR-NEW'));
    expect(result.current.busy).toBe(false);
  });

  it('creates a report, refreshes the list and selects it', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());

    await act(async () => {
      await result.current.createReport();
    });

    expect(api.create).toHaveBeenCalled();
    expect(result.current.selectedId).toBe('TR-0002');
    expect(result.current.formData).toEqual(makeReport('TR-0002'));
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'Informe creado', type: 'success' });
  });

  it('saves the current form and clears dirty state', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });
    act(() => {
      result.current.patchForm({ id: 'TR-0001', title: 'editado' });
    });
    expect(result.current.hasChanges).toBe(true);

    await act(async () => {
      await result.current.saveReport();
    });

    expect(api.update).toHaveBeenCalledWith('TR-0001', { id: 'TR-0001', title: 'editado' });
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.formData).toEqual({ id: 'TR-0001', title: 'editado' });
    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'Informe guardado', type: 'success' });
  });

  it('does not save when there is no form data', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());

    await act(async () => {
      await result.current.saveReport();
    });

    expect(api.update).not.toHaveBeenCalled();
  });

  it('deletes the selected report after confirm and refreshes', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });

    await act(async () => {
      await result.current.deleteReport();
    });

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'destructive' }));
    expect(api.delete).toHaveBeenCalledWith('TR-0001');
    expect(result.current.selectedId).toBeNull();
    expect(result.current.formData).toBeNull();
    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'Informe eliminado', type: 'success' });
  });

  it('skips delete when confirm is declined', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });

    mocks.confirm.mockResolvedValue(false);
    await act(async () => {
      await result.current.deleteReport();
    });

    expect(api.delete).not.toHaveBeenCalled();
    expect(result.current.selectedId).toBe('TR-0001');
  });

  it('clears the whole base after confirm', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());

    await act(async () => {
      await result.current.clearReports();
    });

    expect(api.clear).toHaveBeenCalled();
    expect(result.current.reports).toEqual([]);
    expect(result.current.selectedId).toBeNull();
    expect(result.current.formData).toBeNull();
    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'Base de informes limpiada', type: 'success' });
  });

  it('imports a file, clears selection and refreshes', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });

    const file = new File(['id,title'], 'informes.csv', { type: 'text/csv' });
    await act(async () => {
      await result.current.importFile(file);
    });

    expect(api.importFile).toHaveBeenCalledWith('informes.csv', expect.any(String));
    expect(result.current.selectedId).toBeNull();
    expect(result.current.formData).toBeNull();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(mocks.addToast).toHaveBeenCalledWith({ message: '3 informes importados', type: 'success' });
  });

  it('surfaces import failure as an error toast', async () => {
    const api = makeApi({ importFile: vi.fn(async () => { throw new Error('CSV inválido'); }) });
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());

    await act(async () => {
      await result.current.importFile(new File(['x'], 'informes.csv'));
    });

    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'CSV inválido', type: 'error' });
    expect(result.current.busy).toBe(false);
  });
});
