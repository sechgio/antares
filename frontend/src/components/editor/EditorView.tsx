import { useCallback, useState } from 'react';
import { api } from '../../api';
import { Film, Image as ImageIcon, Loader2, Music, Plus, SlidersHorizontal, Upload, type LucideIcon } from 'lucide-react';
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

const SAVE_DOT: Record<SaveState, string> = {
  idle: 'bg-[var(--text-muted)]',
  saving: 'bg-[var(--accent-yellow)] animate-pulse',
  saved: 'bg-[var(--accent-green)]',
  error: 'bg-[var(--accent-red)]',
};

const ASSET_ICON: Record<MediaAsset['type'], LucideIcon> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  animation: Film,
};

const ASSET_TINT: Record<MediaAsset['type'], string> = {
  video: 'text-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_14%,transparent)]',
  audio: 'text-[var(--accent-green)] bg-[color-mix(in_srgb,var(--accent-green)_14%,transparent)]',
  image: 'text-[var(--accent-secondary)] bg-[color-mix(in_srgb,var(--accent-secondary)_14%,transparent)]',
  animation: 'text-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_14%,transparent)]',
};

const CLIP_KIND_LABEL: Record<Clip['kind'], string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Imagen',
  text: 'Texto',
};

function PanelHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3">
      <span className="truncate text-xs font-medium text-[var(--text-primary)]">{title}</span>
      {detail && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{detail}</span>
      )}
    </div>
  );
}

function EditorToolbar({
  projectName,
  saveState,
  error,
  importing,
  onImport,
}: {
  projectName: string;
  importing: boolean;
  saveState: SaveState;
  error: string | null;
  onImport: () => void;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="text-xs text-[var(--text-muted)]">Editor</span>
        <span className="text-xs text-[var(--text-muted)]">/</span>
        <span className="truncate text-sm font-medium text-[var(--text-primary)]">{projectName}</span>
        <span
          className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"
          data-testid="editor-save-state"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${SAVE_DOT[saveState]}`} aria-hidden />
          {SAVE_LABEL[saveState]}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {error && (
          <span className="truncate text-xs text-[var(--accent-red)]" role="alert" title={error}>
            {error}
          </span>
        )}
        <Button variant="secondary" size="sm" disabled={importing} onClick={onImport}>
          {importing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-3.5 w-3.5" aria-hidden />
          )}
          {importing ? 'Importando archivos…' : 'Importar archivos'}
        </Button>
      </div>
    </header>
  );
}

function EditorPreview({ project }: { project: EditorProject }) {
  const { width, height, fps } = project.canvas;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-[var(--bg-base)] p-6"
      aria-label="Vista previa"
    >
      <div className="flex min-h-0 w-full flex-1 items-center justify-center" style={{ containerType: 'size' }}>
        <div
          className="flex items-center justify-center rounded-md bg-black shadow-[0_0_0_1px_var(--border-subtle)]"
          style={{ aspectRatio: `${width} / ${height}`, width: `min(100cqw, ${(100 * width) / height}cqh)` }}
          data-testid="editor-preview"
        >
          <span className="px-4 text-center text-xs text-white/40">Vista previa de «{project.name}»</span>
        </div>
      </div>
      <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
        {width}×{height} · {Math.round(fps.num / fps.den)} fps
      </span>
    </section>
  );
}

function EditorProperties({
  clip,
  project,
  onChange,
}: {
  clip: Clip | null;
  project: EditorProject;
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
  const asset = project.assets.find((a) => a.id === clip?.assetId);
  const title = !clip
    ? 'Propiedades'
    : clip.kind === 'text'
      ? clip.text?.content || 'Texto'
      : asset?.displayName ?? 'Clip';

  return (
    <aside
      className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      aria-label="Propiedades"
    >
      <PanelHeader title={title} detail={clip ? CLIP_KIND_LABEL[clip.kind] : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!clip ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <SlidersHorizontal className="h-5 w-5 text-[var(--text-muted)]" aria-hidden />
            <p className="text-xs text-[var(--text-muted)]">
              Selecciona un clip de la línea de tiempo para editarlo.
            </p>
          </div>
        ) : clip.kind === 'text' ? (
          <TextPanel clip={clip} onChange={update} />
        ) : clip.kind === 'video' ? (
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
        ) : clip.kind === 'audio' ? (
          <AudioPanel clip={clip} onChange={update} />
        ) : (
          <p className="p-4 text-xs text-[var(--text-muted)]">Las imágenes aún no tienen ajustes editables.</p>
        )}
      </div>
    </aside>
  );
}

function EditorMediaLibrary({
  assets,
  onRecorded,
  onAdd,
  onImport,
}: {
  assets: MediaAsset[];
  onRecorded: (fileToken: string) => void;
  onAdd: (assetId: string) => void;
  onImport: () => void;
}) {
  const [tab, setTab] = useState<'media' | 'grabar'>('media');
  const tabClass = (active: boolean) =>
    `flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
      active
        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--border-subtle)]'
        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
    }`;

  return (
    <section
      className="flex w-64 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      aria-label="Biblioteca de medios"
    >
      <div className="flex h-10 shrink-0 items-center border-b border-[var(--border-subtle)] px-2">
        <div className="flex flex-1 gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5">
          <button
            type="button"
            className={tabClass(tab === 'media')}
            aria-pressed={tab === 'media'}
            onClick={() => setTab('media')}
          >
            Medios
          </button>
          <button
            type="button"
            className={tabClass(tab === 'grabar')}
            aria-pressed={tab === 'grabar'}
            data-testid="record-tab"
            onClick={() => setTab('grabar')}
          >
            Grabar
          </button>
        </div>
      </div>
      {tab === 'grabar' ? (
        <RecordPanel onImported={onRecorded} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {assets.length === 0 ? (
            <button
              type="button"
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border-medium)] px-4 py-8 text-center text-xs text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--text-secondary)]"
              onClick={onImport}
            >
              <Upload className="h-4 w-4" aria-hidden />
              Importa video, audio o imágenes
            </button>
          ) : (
            <ul className="space-y-0.5">
              {assets.map((asset) => {
                const Icon = ASSET_ICON[asset.type];
                return (
                  <li
                    key={asset.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)}
                    onDoubleClick={() => onAdd(asset.id)}
                    title="Arrastra a la línea de tiempo o haz doble clic para añadir"
                    className="group flex cursor-grab items-center gap-2.5 rounded-md p-1.5 hover:bg-[var(--bg-elevated)] active:cursor-grabbing"
                  >
                    <span
                      className={`flex h-9 w-12 shrink-0 items-center justify-center rounded ${ASSET_TINT[asset.type]}`}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-[var(--text-primary)]">{asset.displayName}</span>
                      <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
                        {asset.type === 'image' ? 'Imagen' : formatDuration(asset.durationUs)}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Añadir ${asset.displayName} a la línea de tiempo`}
                      title="Añadir a la línea de tiempo"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      onClick={() => onAdd(asset.id)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                );
              })}
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
      <EditorToolbar
        projectName={project.name}
        saveState={saveState}
        error={importError ?? error}
        importing={importing}
        onImport={() => void handleImport()}
      />
      <div className="flex min-h-0 flex-1">
        <EditorMediaLibrary
          assets={project.assets}
          onRecorded={(token) => void handleRecorded(token)}
          onAdd={handleAddAsset}
          onImport={() => void handleImport()}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EditorPreview project={project} />
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
          project={project}
          onChange={updateProject}
        />
      </div>
    </main>
  );
}

export default EditorView;
