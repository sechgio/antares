import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import type { EditorProject } from '../types';
import { flushEditorSessions } from '../runtime/editorLifecycle';
import { useEditorProject } from './useEditorProject';

vi.mock('../../../api', () => ({
  api: { editorBootstrap: vi.fn(), editorProjectGet: vi.fn(), editorProjectSave: vi.fn() },
}));

function project(): EditorProject {
  return {
    id: 'p1', schemaVersion: 1, name: 'Inicial', revision: 1, createdAt: '', updatedAt: '',
    canvas: { width: 1280, height: 720, fps: { num: 25, den: 1 }, background: { type: 'solid' }, workingColorSpace: 'bt709-sdr' },
    assets: [], tracks: [], clips: [],
    exportSettings: {
      container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 1280, height: 720,
      fps: { num: 25, den: 1 }, qualityPreset: 'balanced', audioSampleRate: 48000, audioChannels: 2,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function openEditor() {
  const hook = renderHook(useEditorProject);
  await act(async () => { await hook.result.current.openProject('p1'); });
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.editorBootstrap).mockResolvedValue({ schemaVersion: 1, projects: [], toolchain: { available: false } });
  vi.mocked(api.editorProjectGet).mockResolvedValue({ project: project() });
  vi.mocked(api.editorProjectSave).mockImplementation(async (draft) => ({ project: { ...draft, revision: draft.revision + 1 } }));
});

afterEach(async () => {
  await act(async () => { cleanup(); await flushEditorSessions(); });
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('persistencia del editor', () => {
  it('conserva las ediciones durante un guardado y persiste la revisión más reciente en orden', async () => {
    const first = deferred<{ project: EditorProject }>();
    vi.mocked(api.editorProjectSave).mockImplementationOnce(() => first.promise);
    const { result } = await openEditor();
    act(() => result.current.updateProject((draft) => { draft.name = 'A'; }));
    let saving: Promise<void> | undefined;
    act(() => { saving = result.current.saveNow(); });
    act(() => result.current.updateProject((draft) => { draft.name = 'B'; }));
    expect(api.editorProjectSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ project: { ...project(), name: 'A', revision: 2 } });
      await saving;
    });
    expect(result.current.project?.name).toBe('B');
    expect(api.editorProjectSave).toHaveBeenCalledTimes(2);
    expect(api.editorProjectSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'B', revision: 2 }), 2, expect.any(String));
    expect(result.current.saveState).toBe('saved');
  });

  it('espera la escritura en curso cuando se pide guardar otra vez', async () => {
    const pending = deferred<{ project: EditorProject }>();
    vi.mocked(api.editorProjectSave).mockImplementationOnce(() => pending.promise);
    const { result } = await openEditor();
    act(() => result.current.updateProject((draft) => { draft.name = 'Pendiente'; }));
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => { first = result.current.saveNow(); second = result.current.saveNow(); });
    expect(api.editorProjectSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ project: { ...project(), name: 'Pendiente', revision: 2 } });
      await Promise.all([first, second]);
    });
  });

  it('no reintenta automáticamente un error y permite guardar después', async () => {
    vi.mocked(api.editorProjectSave).mockRejectedValueOnce(new Error('Sin espacio'));
    const { result } = await openEditor();
    act(() => result.current.updateProject((draft) => { draft.name = 'Sin guardar'; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(api.editorProjectSave).toHaveBeenCalledTimes(1);
    expect(result.current.saveState).toBe('error');
    expect(result.current.project?.name).toBe('Sin guardar');
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.editorProjectSave).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.saveNow(); });
    expect(result.current.saveState).toBe('saved');
  });

  it('el flush espera las escrituras pendientes', async () => {
    const pending = deferred<{ project: EditorProject }>();
    vi.mocked(api.editorProjectSave).mockImplementationOnce(() => pending.promise);
    const { result } = await openEditor();
    act(() => result.current.updateProject((draft) => { draft.name = 'Al cerrar'; }));
    let finished = false;
    let flushing: ReturnType<typeof flushEditorSessions> = Promise.resolve({ flushed: 0, errors: [] });
    act(() => { flushing = flushEditorSessions().then((value) => { finished = true; return value; }); });
    try {
      await act(async () => { await Promise.resolve(); });
      expect(finished).toBe(false);
    } finally {
      await act(async () => {
        pending.resolve({ project: { ...project(), name: 'Al cerrar', revision: 2 } });
        await flushing;
      });
    }
    expect(await flushing).toEqual({ flushed: 1, errors: [] });
  });

  it('guarda el proyecto anterior antes de abrir otro', async () => {
    const pending = deferred<{ project: EditorProject }>();
    vi.mocked(api.editorProjectSave).mockImplementationOnce(() => pending.promise);
    const { result } = await openEditor();
    vi.mocked(api.editorProjectGet).mockClear();
    vi.mocked(api.editorProjectGet).mockResolvedValueOnce({ project: { ...project(), id: 'p2', name: 'Otro' } });
    act(() => result.current.updateProject((draft) => { draft.name = 'Anterior editado'; }));
    let opening: Promise<void> | undefined;
    act(() => { opening = result.current.openProject('p2'); });
    expect(api.editorProjectGet).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ project: { ...project(), name: 'Anterior editado', revision: 2 } });
      await opening;
    });
    expect(api.editorProjectGet).toHaveBeenCalledExactlyOnceWith('p2');
    expect(result.current.project?.id).toBe('p2');
    expect(result.current.project?.name).toBe('Otro');
  });

  it('mantiene el guardado pendiente en el flush después de desmontar el editor', async () => {
    const pending = deferred<{ project: EditorProject }>();
    vi.mocked(api.editorProjectSave).mockImplementationOnce(() => pending.promise);
    const { result, unmount } = await openEditor();
    act(() => result.current.updateProject((draft) => { draft.name = 'Al salir de la pestaña'; }));
    act(unmount);
    let finished = false;
    const flushing = flushEditorSessions().then((value) => { finished = true; return value; });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(api.editorProjectSave).toHaveBeenCalledTimes(1);
    pending.resolve({ project: { ...project(), name: 'Al salir de la pestaña', revision: 2 } });
    expect(await flushing).toEqual({ flushed: 1, errors: [] });
    expect(await flushEditorSessions()).toEqual({ flushed: 0, errors: [] });
  });

  it('conserva una sesión desmontada que no pudo guardarse para el siguiente flush', async () => {
    vi.mocked(api.editorProjectSave).mockRejectedValueOnce(new Error('Sin espacio'));
    const { result, unmount } = await openEditor();
    act(() => result.current.updateProject((draft) => { draft.name = 'Pendiente al desmontar'; }));
    await act(async () => { unmount(); await Promise.resolve(); });
    expect(api.editorProjectSave).toHaveBeenCalledTimes(1);
    expect(await flushEditorSessions()).toEqual({ flushed: 1, errors: [] });
    expect(api.editorProjectSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Pendiente al desmontar' }), 1, expect.any(String));
    expect(await flushEditorSessions()).toEqual({ flushed: 0, errors: [] });
  });
});
