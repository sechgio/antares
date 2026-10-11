import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api';

const mockInvoke = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.electronAPI = {
    invoke: mockInvoke,
    onNotify: vi.fn(),
    reportRendererError: vi.fn(),
  } as any;
});

describe('editorApi facade', () => {
  it('expone los métodos del editor en la fachada api', () => {
    expect(typeof api.editorBootstrap).toBe('function');
    expect(typeof api.editorProjectCreate).toBe('function');
    expect(typeof api.editorProjectSave).toBe('function');
    expect(typeof api.editorAssetsImportStart).toBe('function');
    expect(typeof api.editorJobStatus).toBe('function');
    expect(typeof api.editorJobCancel).toBe('function');
  });

  it('editor_bootstrap no envía parámetros', async () => {
    mockInvoke.mockResolvedValue({ schemaVersion: 1, projects: [], toolchain: { available: true } });
    await api.editorBootstrap();
    expect(mockInvoke.mock.calls[0][0]).toBe('editor_bootstrap');
    expect(mockInvoke.mock.calls[0][1]).toBeFalsy();
  });

  it('crea un proyecto con nombre y requestId', async () => {
    mockInvoke.mockResolvedValue({ project: { id: 'p1' } });
    await api.editorProjectCreate('Mi video', 'req-1');
    expect(mockInvoke).toHaveBeenCalledWith('editor_project_create', {
      name: 'Mi video',
      requestId: 'req-1',
    });
  });

  it('crea un proyecto sin nombre ni requestId cuando no se pasan', async () => {
    mockInvoke.mockResolvedValue({ project: { id: 'p1' } });
    await api.editorProjectCreate();
    expect(mockInvoke).toHaveBeenCalledWith('editor_project_create', {});
  });

  it('guarda con CAS de revisión', async () => {
    mockInvoke.mockResolvedValue({ project: { id: 'p1', revision: 2 } });
    const doc = { id: 'p1', revision: 1 } as any;
    await api.editorProjectSave(doc, 1);
    expect(mockInvoke).toHaveBeenCalledWith('editor_project_save', {
      document: doc,
      expectedRevision: 1,
    });
  });

  it('reintenta el guardado con el mismo requestId', async () => {
    mockInvoke.mockResolvedValue({ project: { id: 'p1', revision: 2 } });
    const doc = { id: 'p1', revision: 1 } as any;
    await api.editorProjectSave(doc, 1, 'req-save-1');
    expect(mockInvoke).toHaveBeenCalledWith('editor_project_save', {
      document: doc,
      expectedRevision: 1,
      requestId: 'req-save-1',
    });
  });

  it('arranca la importación con la lista de tokens', async () => {
    mockInvoke.mockResolvedValue({ started: true, jobId: 'editor_import_x' });
    await api.editorAssetsImportStart(['/a/clip.mp4', '/b/otro.mkv']);
    expect(mockInvoke).toHaveBeenCalledWith('editor_assets_import_start', {
      files: ['/a/clip.mp4', '/b/otro.mkv'],
    });
  });

  it('consulta el estado del job', async () => {
    mockInvoke.mockResolvedValue({ jobId: 'editor_import_x', state: 'completed', progress: 100 });
    await api.editorJobStatus('editor_import_x');
    expect(mockInvoke).toHaveBeenCalledWith('editor_job_status', { jobId: 'editor_import_x' });
  });

  it('cancela el job', async () => {
    mockInvoke.mockResolvedValue({ cancelled: true });
    await api.editorJobCancel('editor_import_x');
    expect(mockInvoke).toHaveBeenCalledWith('editor_job_cancel', { jobId: 'editor_import_x' });
  });

  it('elimina un proyecto', async () => {
    mockInvoke.mockResolvedValue({ deleted_id: 'p1', trash: true });
    await api.editorProjectDelete('p1');
    expect(mockInvoke).toHaveBeenCalledWith('editor_project_delete', { projectId: 'p1' });
  });
});
