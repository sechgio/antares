import { useCallback, useState } from 'react';
import { api } from '../../api';
import Button from '../ui/Button';
import type { EditorProject } from './types';
import { useEditorProject, type SaveState } from './hooks/useEditorProject';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: 'Sin cambios',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'Error al guardar',
};

function formatDuration(us: number | undefined): string {
  if (!us) return '—';
  const totalSeconds = us / 1_000_000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function EditorEmptyState({
  onCreate,
  onImport,
}: {
  onCreate: () => void;
  onImport: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold text-[var(--text-primary)]">Editor de video</h2>
      <p className="max-w-md text-sm text-[var(--text-secondary)]">
        Crea un proyecto para empezar a montar video, audio, imágenes y texto.
        Todo se procesa en tu equipo, sin subir archivos.
      </p>
      <div className="flex gap-3">
        <Button variant="primary" onClick={onCreate}>
          Crear proyecto
        </Button>
        <Button variant="secondary" onClick={onImport}>
          Abrir archivos
        </Button>
      </div>
    </div>
  );
}

function EditorToolbar({
  saveState,
  error,
  onImport,
}: {
  saveState: SaveState;
  error: string | null;
  onImport: () => void;
}) {
  return (
    <header className="flex items-center justify-between border-b border-[var(--border-medium)] px-4 py-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-[var(--text-primary)]">Editor</span>
        <span
          className="text-xs text-[var(--text-muted)]"
          data-testid="editor-save-state"
        >
          {SAVE_LABEL[saveState]}
        </span>
        {error && (
          <span className="text-xs text-[var(--accent-red)]" role="alert">
            {error}
          </span>
        )}
      </div>
      <Button variant="secondary" onClick={onImport}>
        Importar archivos
      </Button>
    </header>
  );
}

function EditorPreview({ projectName }: { projectName: string }) {
  return (
    <section
      className="flex min-h-0 flex-1 items-center justify-center bg-black/80 p-4"
      aria-label="Vista previa"
    >
      <div className="text-sm text-white/60" data-testid="editor-preview">
        Vista previa de «{projectName}»
      </div>
    </section>
  );
}

function EditorTimeline({ clipCount }: { clipCount: number }) {
  return (
    <section
      className="h-48 border-t border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3"
      aria-label="Línea de tiempo"
    >
      <div className="text-xs text-[var(--text-muted)]">
        Línea de tiempo · {clipCount} {clipCount === 1 ? 'clip' : 'clips'}
      </div>
      <div
        className="mt-2 h-28 rounded border border-dashed border-[var(--border-medium)]"
        data-testid="editor-timeline"
      />
    </section>
  );
}

function EditorProperties() {
  return (
    <aside
      className="w-64 shrink-0 border-l border-[var(--border-medium)] bg-[var(--bg-surface)] p-3"
      aria-label="Propiedades"
    >
      <div className="text-xs font-medium text-[var(--text-primary)]">Propiedades</div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Selecciona un clip para editar sus propiedades.
      </p>
    </aside>
  );
}

function EditorMediaLibrary({
  assets,
}: {
  assets: Array<{ id: string; displayName: string; type: string; durationUs?: number }>;
}) {
  return (
    <section className="w-56 shrink-0 border-r border-[var(--border-medium)] bg-[var(--bg-surface)] p-3" aria-label="Biblioteca de medios">
      <div className="text-xs font-medium text-[var(--text-primary)]">Medios</div>
      {assets.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Importa archivos para verlos aquí.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {assets.map((asset) => (
            <li
              key={asset.id}
              className="rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            >
              <span className="block truncate">{asset.displayName}</span>
              <span className="text-[var(--text-muted)]">
                {asset.type} · {formatDuration(asset.durationUs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EditorView() {
  const {
    project,
    projects,
    saveState,
    error,
    createProject,
    openProject,
    updateProject,
  } = useEditorProject();
  const [imported, setImported] = useState<EditorProject['assets']>([]);
  const [importing, setImporting] = useState(false);

  const handleImport = useCallback(async () => {
    if (!project) return;
    setImporting(true);
    try {
      const dialog = await api.editorImportFiles();
      if (!dialog.file_tokens.length) return;
      const job = await api.editorAssetsImportStart(dialog.file_tokens);
      if (!job.started || !job.jobId) return;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await api.editorJobStatus(job.jobId);
        if (!status.running) {
          if (status.imported.length > 0) {
            const assets = status.imported as typeof imported;
            setImported((prev) => [...prev, ...assets]);
            updateProject((draft) => {
              draft.assets = [...draft.assets, ...assets];
            });
          }
          break;
        }
      }
    } catch {
      // El error de importación se refleja en el estado del proyecto.
    } finally {
      setImporting(false);
    }
  }, [project, updateProject]);

  const handleCreate = useCallback(async () => {
    await createProject(`Proyecto ${projects.length + 1}`);
  }, [createProject, projects.length]);

  if (!project) {
    return (
      <main className="flex h-full w-full flex-col bg-[var(--bg-base)]" data-testid="editor-view">
        {projects.length > 0 && (
          <div className="border-b border-[var(--border-medium)] p-3">
            <div className="text-xs font-medium text-[var(--text-primary)]">Proyectos recientes</div>
            <ul className="mt-2 space-y-1">
              {projects.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                    onClick={() => void openProject(item.id)}
                  >
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <EditorEmptyState onCreate={() => void handleCreate()} onImport={() => void handleCreate()} />
      </main>
    );
  }

  return (
    <main className="flex h-full w-full flex-col bg-[var(--bg-base)]" data-testid="editor-view">
      <EditorToolbar saveState={saveState} error={error} onImport={() => void handleImport()} />
      <div className="flex min-h-0 flex-1">
        <EditorMediaLibrary assets={imported} />
        <div className="flex min-h-0 flex-1 flex-col">
          <EditorPreview projectName={project.name} />
          <EditorTimeline clipCount={project.clips.length} />
        </div>
        <EditorProperties />
      </div>
      {importing && (
        <div className="border-t border-[var(--border-medium)] px-4 py-1 text-xs text-[var(--text-muted)]">
          Importando archivos…
        </div>
      )}
    </main>
  );
}

export default EditorView;
