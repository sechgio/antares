import { useCallback, useState } from 'react';
import { api } from '../../api';
import Button from '../ui/Button';
import type { Clip, EditorProject, MediaAsset } from './types';
import { useEditorProject, type SaveState } from './hooks/useEditorProject';
import { TextPanel } from './panels/TextPanel';
import { AudioPanel } from './panels/AudioPanel';
import { RemoveLogoPanel } from './panels/RemoveLogoPanel';
import { RecordPanel } from './panels/RecordPanel';
import { TimelinePanel, ASSET_DRAG_TYPE } from './timeline/TimelinePanel';
import { applyOperation, clipFromAsset, type TimelineOperation } from './timeline/operations';

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

function EditorProperties({
  clip,
  onChange,
}: {
  clip: Clip | null;
  onChange: (mutate: (draft: EditorProject) => void) => void;
}) {
  const update = useCallback(
    (mutate: (draft: Clip) => void) => {
      onChange((draft) => {
        const index = draft.clips.findIndex((c) => c.id === clip?.id);
        if (index >= 0) mutate(draft.clips[index]);
      });
    },
    [clip, onChange],
  );

  return (
    <aside
      className="w-64 shrink-0 overflow-y-auto border-l border-[var(--border-medium)] bg-[var(--bg-surface)]"
      aria-label="Propiedades"
    >
      <div className="border-b border-[var(--border-medium)] p-3 text-xs font-medium text-[var(--text-primary)]">
        Propiedades
      </div>
      {clip?.kind === 'text' ? (
        <TextPanel clip={clip} onChange={update} />
      ) : clip?.kind === 'video' ? (
        <RemoveLogoPanel
          clipId={clip.id}
          rects={clip.delogo.rects}
          onApply={(next) =>
            onChange((draft) => {
              const target = draft.clips.find((c) => c.id === clip.id);
              if (target) target.delogo = { rects: next };
            })
          }
        />
      ) : (
        <AudioPanel clip={clip} onChange={update} />
      )}
    </aside>
  );
}

function EditorMediaLibrary({
  assets,
  onRecorded,
  onAdd,
}: {
  assets: MediaAsset[];
  onRecorded: (fileToken: string) => void;
  onAdd: (assetId: string) => void;
}) {
  const [tab, setTab] = useState<'media' | 'grabar'>('media');

  return (
    <section className="w-56 shrink-0 border-r border-[var(--border-medium)] bg-[var(--bg-surface)]" aria-label="Biblioteca de medios">
      <div className="flex border-b border-[var(--border-medium)]">
        <button
          type="button"
          className={`flex-1 px-3 py-2 text-xs ${
            tab === 'media' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
          }`}
          aria-pressed={tab === 'media'}
          onClick={() => setTab('media')}
        >
          Medios
        </button>
        <button
          type="button"
          className={`flex-1 px-3 py-2 text-xs ${
            tab === 'grabar' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
          }`}
          aria-pressed={tab === 'grabar'}
          data-testid="record-tab"
          onClick={() => setTab('grabar')}
        >
          Grabar
        </button>
      </div>
      {tab === 'grabar' ? (
        <RecordPanel onImported={onRecorded} />
      ) : (
        <div className="p-3">
          {assets.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Importa archivos para verlos aquí.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {assets.map((asset) => (
                <li
                  key={asset.id}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)}
                  onDoubleClick={() => onAdd(asset.id)}
                  className="group flex cursor-grab items-center gap-2 rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{asset.displayName}</span>
                    <span className="text-[var(--text-muted)]">
                      {asset.type} · {formatDuration(asset.durationUs)}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Añadir ${asset.displayName} a la línea de tiempo`}
                    title="Añadir a la línea de tiempo"
                    className="h-5 w-5 shrink-0 rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => onAdd(asset.id)}
                  >
                    +
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadUs, setPlayheadUs] = useState(0);

  const runImport = useCallback(
    async (fileTokens: string[]) => {
      if (!fileTokens.length) return;
      setImporting(true);
      setImportError(null);
      try {
        const job = await api.editorAssetsImportStart(fileTokens);
        if (!job.started || !job.jobId) throw new Error('No se pudo iniciar la importación');
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const status = await api.editorJobStatus(job.jobId);
          if (status.running) continue;
          const assets = status.imported as MediaAsset[];
          if (assets.length > 0) {
            updateProject((draft) => {
              draft.assets = [...draft.assets, ...assets];
            });
          }
          if (status.failed.length > 0) {
            setImportError(`No se pudieron importar ${status.failed.length} archivo(s): ${status.failed[0].reason}`);
          }
          return;
        }
        setImportError('La importación tardó demasiado');
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
      } finally {
        setImporting(false);
      }
    },
    [updateProject],
  );

  const handleImport = useCallback(async () => {
    try {
      const dialog = await api.editorImportFiles();
      await runImport(dialog.file_tokens);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }, [runImport]);

  const handleCreate = useCallback(async () => {
    await createProject(`Proyecto ${projects.length + 1}`);
  }, [createProject, projects.length]);

  const handleCreateAndImport = useCallback(async () => {
    try {
      const dialog = await api.editorImportFiles();
      if (!dialog.file_tokens.length) return;
      await createProject(`Proyecto ${projects.length + 1}`);
      await runImport(dialog.file_tokens);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }, [createProject, projects.length, runImport]);

  const handleRecorded = useCallback((fileToken: string) => runImport([fileToken]), [runImport]);

  const handleOperation = useCallback(
    (op: TimelineOperation) => {
      if (!project) return;
      const result = applyOperation(project, op);
      if (!result.changed) return;
      updateProject((draft) => {
        draft.clips = result.clips;
      });
    },
    [project, updateProject],
  );

  const handleAddAsset = useCallback(
    (assetId: string) => {
      const clipId = crypto.randomUUID().replace(/-/g, '');
      updateProject((draft) => {
        const asset = draft.assets.find((a) => a.id === assetId);
        const clip = asset ? clipFromAsset(draft, asset, clipId) : null;
        if (clip) draft.clips.push(clip);
      });
      setSelectedClipId(clipId);
    },
    [updateProject],
  );

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
        <EditorEmptyState onCreate={() => void handleCreate()} onImport={() => void handleCreateAndImport()} />
      </main>
    );
  }

  return (
    <main className="flex h-full w-full flex-col bg-[var(--bg-base)]" data-testid="editor-view">
      <EditorToolbar saveState={saveState} error={importError ?? error} onImport={() => void handleImport()} />
      <div className="flex min-h-0 flex-1">
        <EditorMediaLibrary
          assets={project.assets}
          onRecorded={(token) => void handleRecorded(token)}
          onAdd={handleAddAsset}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <EditorPreview projectName={project.name} />
          <TimelinePanel
            project={project}
            selectedClipId={selectedClipId}
            playheadUs={playheadUs}
            onSelectClip={setSelectedClipId}
            onSeek={setPlayheadUs}
            onOperation={handleOperation}
            onImport={() => void handleImport()}
            onAddAsset={handleAddAsset}
          />
        </div>
        <EditorProperties
          clip={project.clips.find((c) => c.id === selectedClipId) ?? null}
          onChange={updateProject}
        />
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
