import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api';
import type { EditorProject } from '../types';
import { registerEditorFlushHandler } from '../runtime/editorLifecycle';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DEBOUNCE_MS = 750;

export interface UseEditorProjectResult {
  project: EditorProject | null;
  projects: Array<{ id: string; name: string; updatedAt?: string; revision?: number }>;
  saveState: SaveState;
  error: string | null;
  createProject: (name?: string) => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  updateProject: (mutate: (draft: EditorProject) => void) => void;
  saveNow: () => Promise<void>;
}

/**
 * Sesión de proyecto con autosave serializado (L2, plan §4.3).
 *
 * - debounce de 750 ms tras una edición consolidada;
 * - una escritura en vuelo por proyecto; la última revisión pendiente
 *   se escribe al terminar la anterior;
 * - CAS de revisión: `expectedRevision` evita sobrescribir cambios
 *   ajenos; un requestId reintentado no dobla la revisión;
 * - flush al desmontar para guardar antes de abandonar la sesión.
 */
export function useEditorProject(): UseEditorProjectResult {
  const [project, setProject] = useState<EditorProject | null>(null);
  const [projects, setProjects] = useState<UseEditorProjectResult['projects']>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const projectRef = useRef<EditorProject | null>(null);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const persist = useCallback(async (draft: EditorProject) => {
    inFlightRef.current = true;
    setSaveState('saving');
    const requestId = `editor-save-${Date.now()}-${requestSeq.current++}`;
    try {
      const response = await api.editorProjectSave(draft, draft.revision, requestId);
      const saved = response.project as EditorProject;
      projectRef.current = saved;
      dirtyRef.current = false;
      setProject(saved);
      setSaveState('saved');
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Una revisión obsoleta no debe marcarse como error del usuario:
      // el proyecto se recarga en el siguiente arranque.
      setSaveState('error');
      setError(message);
    } finally {
      inFlightRef.current = false;
      if (dirtyRef.current && projectRef.current) {
        // Había una edición durante el guardado: escribir la última.
        void persist(projectRef.current);
      }
    }
  }, []);

  const saveNow = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const draft = projectRef.current;
    if (!draft || !dirtyRef.current) return;
    await persist(draft);
  }, [persist]);

  const updateProject = useCallback(
    (mutate: (draft: EditorProject) => void) => {
      const current = projectRef.current;
      if (!current) return;
      const draft: EditorProject = JSON.parse(JSON.stringify(current));
      mutate(draft);
      projectRef.current = draft;
      dirtyRef.current = true;
      setProject(draft);
      setSaveState('saving');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void persist(draft);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  const bootstrap = useCallback(async () => {
    try {
      const result = await api.editorBootstrap();
      setProjects(result.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const createProject = useCallback(async (name?: string) => {
    const requestId = `editor-create-${Date.now()}`;
    const response = await api.editorProjectCreate(name, requestId);
    const created = response.project as EditorProject;
    projectRef.current = created;
    dirtyRef.current = false;
    setProject(created);
    setSaveState('saved');
    setProjects((prev) => [{ id: created.id, name: created.name, updatedAt: created.updatedAt, revision: created.revision }, ...prev]);
  }, []);

  const openProject = useCallback(async (projectId: string) => {
    const response = await api.editorProjectGet(projectId);
    const opened = response.project as EditorProject;
    projectRef.current = opened;
    dirtyRef.current = false;
    setProject(opened);
    setSaveState('saved');
    setError(null);
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    // Flush al desmontar: guardar lo pendiente antes de abandonar.
    const unregister = registerEditorFlushHandler(() => {
      void saveNow();
    });
    return () => {
      unregister();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void saveNow();
    };
  }, [saveNow]);

  return {
    project,
    projects,
    saveState,
    error,
    createProject,
    openProject,
    updateProject,
    saveNow,
  };
}
