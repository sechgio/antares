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

  it('applies a seed to the created report and keeps it pending until saved', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());

    await act(async () => {
      await result.current.createReport({ title: 'sembrado' });
    });

    expect(result.current.formData).toEqual({ id: 'TR-0002', title: 'sembrado' });
    expect(result.current.hasChanges).toBe(true);
    expect(api.update).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.saveReport();
    });

    expect(api.update).toHaveBeenCalledWith('TR-0002', { id: 'TR-0002', title: 'sembrado' });
    expect(result.current.hasChanges).toBe(false);
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

  it('does not clobber edits made while a save is in flight', async () => {
    let resolveUpdate!: (report: TestReport) => void;
    const api = makeApi({
      update: vi.fn(() => new Promise<TestReport>((resolve) => { resolveUpdate = resolve; })),
    });
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });
    act(() => {
      result.current.patchForm({ id: 'TR-0001', title: 'sent' });
    });

    let saveDone: Promise<void> | undefined;
    act(() => {
      saveDone = result.current.saveReport();
    });
    act(() => {
      result.current.patchForm({ id: 'TR-0001', title: 'typed-after-save' });
    });
    await act(async () => {
      resolveUpdate({ id: 'TR-0001', title: 'sent' });
      await saveDone;
    });

    expect(result.current.formData).toEqual({ id: 'TR-0001', title: 'typed-after-save' });
    expect(result.current.hasChanges).toBe(true);
  });

  it('does not apply a stale save after selecting another report', async () => {
    let resolveUpdate!: (report: TestReport) => void;
    const api = makeApi({
      update: vi.fn(() => new Promise<TestReport>((resolve) => { resolveUpdate = resolve; })),
    });
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });

    let saveDone: Promise<void> | undefined;
    act(() => {
      saveDone = result.current.saveReport();
    });
    await act(async () => {
      await result.current.selectReport('TR-0002');
    });
    await act(async () => {
      resolveUpdate(makeReport('TR-0001'));
      await saveDone;
    });

    expect(result.current.selectedId).toBe('TR-0002');
    expect(result.current.formData).toEqual(makeReport('TR-0002'));
  });

  it('saveCurrent returns the persisted doc without clobbering newer edits', async () => {
    let resolveUpdate!: (report: TestReport) => void;
    const api = makeApi({
      update: vi.fn(() => new Promise<TestReport>((resolve) => { resolveUpdate = resolve; })),
    });
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });
    act(() => {
      result.current.patchForm({ id: 'TR-0001', title: 'sent' });
    });

    let saveDone: Promise<TestReport | null> | undefined;
    act(() => {
      saveDone = result.current.saveCurrent();
    });
    act(() => {
      result.current.patchForm({ id: 'TR-0001', title: 'typed-after-save' });
    });
    let savedDoc: TestReport | null = null;
    await act(async () => {
      resolveUpdate({ id: 'TR-0001', title: 'sent' });
      savedDoc = await saveDone;
    });

    expect(savedDoc).toEqual({ id: 'TR-0001', title: 'sent' });
    expect(result.current.formData).toEqual({ id: 'TR-0001', title: 'typed-after-save' });
    expect(result.current.hasChanges).toBe(true);
  });

  it('keeps busy while an outer operation continues after saveCurrent', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });
    act(() => {
      result.current.patchForm({ id: 'TR-0001', title: 'editado' });
    });

    const { runOperation } = result.current;

    let releaseOuter!: () => void;
    let signalSaveFinished!: () => void;
    const outerGate = new Promise<void>((resolve) => { releaseOuter = resolve; });
    const saveFinished = new Promise<void>((resolve) => { signalSaveFinished = resolve; });
    let operationDone: Promise<void> | undefined;
    act(() => {
      operationDone = runOperation(async () => {
        await result.current.saveCurrent();
        signalSaveFinished();
        await outerGate;
      });
    });

    await act(async () => {
      await saveFinished;
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      releaseOuter();
      await operationDone;
    });
    expect(result.current.busy).toBe(false);
  });

  it('resolves the persisted report even when the list refresh fails', async () => {
    const api = makeApi({
      list: vi.fn()
        .mockResolvedValueOnce({ reports: [{ id: 'TR-0001' }] })
        .mockRejectedValueOnce(new Error('refresh falló')),
    });
    const { result } = renderHook(() => useReportWorkspace(api));
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.selectReport('TR-0001');
    });
    act(() => {
      result.current.patchForm({ id: 'TR-0001', title: 'editado' });
    });

    await act(async () => {
      // El refresh de la lista no es parte de la operación de guardado: su
      // fallo no debe convertir un guardado exitoso en error.
      await expect(result.current.saveCurrent()).resolves.toBeTruthy();
    });
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
