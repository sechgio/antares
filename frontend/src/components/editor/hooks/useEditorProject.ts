import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api';
import type { EditorProject } from '../types';
import { registerEditorFlushHandler } from '../runtime/editorLifecycle';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DEBOUNCE_MS = 750;

interface UseEditorProjectResult {
  project: EditorProject | null;
  projects: Array<{ id: string; name: string; updatedAt?: string; revision?: number }>;
  saveState: SaveState;
  error: string | null;
  createProject: (name?: string) => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  updateProject: (mutate: (draft: EditorProject) => void) => void;
  saveNow: () => Promise<void>;
}

export function useEditorProject(): UseEditorProjectResult {
  const [project, setProject] = useState<EditorProject | null>(null);
  const [projects, setProjects] = useState<UseEditorProjectResult['projects']>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const projectRef = useRef<EditorProject | null>(null);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const persist = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    if (!dirtyRef.current || !projectRef.current) return Promise.resolve();
    setSaveState('saving');
    const save = async () => {
      try {
        while (dirtyRef.current && projectRef.current) {
          const draft = projectRef.current;
          const requestId = `editor-save-${Date.now()}-${requestSeq.current++}`;
          const { project: saved } = await api.editorProjectSave(draft, draft.revision, requestId);
          const current = projectRef.current;
          if (current.id !== draft.id) return;
          dirtyRef.current = current !== draft;
          const next = current === draft ? saved : { ...current, revision: saved.revision, updatedAt: saved.updatedAt };
          projectRef.current = next;
          setProject(next);
        }
        setSaveState('saved');
        setError(null);
      } catch (err) {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        setSaveState('error');
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    };
    const pending = save().finally(() => { inFlightRef.current = null; });
    inFlightRef.current = pending;
    return pending;
  }, []);

  const saveNow = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    await persist();
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
        void persist().catch(() => {});
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
    await saveNow();
    const requestId = `editor-create-${Date.now()}`;
    const response = await api.editorProjectCreate(name, requestId);
    const created = response.project as EditorProject;
    projectRef.current = created;
    dirtyRef.current = false;
    setProject(created);
    setSaveState('saved');
    setProjects((prev) => [{ id: created.id, name: created.name, updatedAt: created.updatedAt, revision: created.revision }, ...prev]);
  }, [saveNow]);

  const openProject = useCallback(async (projectId: string) => {
    await saveNow();
    const response = await api.editorProjectGet(projectId);
    const opened = response.project as EditorProject;
    projectRef.current = opened;
    dirtyRef.current = false;
    setProject(opened);
    setSaveState('saved');
    setError(null);
  }, [saveNow]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    let unmounted = false;
    const flush = async () => {
      await saveNow();
      if (unmounted) unregister();
    };
    const unregister = registerEditorFlushHandler(flush);
    return () => {
      unmounted = true;
      void flush().catch(() => {});
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
