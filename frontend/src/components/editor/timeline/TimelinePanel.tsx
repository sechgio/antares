import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { clipDurationUs, type Clip, type EditorProject } from '../types';
import { clipAt, timelineEndUs, type TimelineOperation } from './operations';
import { fitZoomIndex, formatTimecode, rulerTicks, snapToFrame, zoomLevels } from './scale';

const HEADER_WIDTH = 88;
const RULER_HEIGHT = 24;
const TRACK_HEIGHT = { video: 56, audio: 40 } as const;
const TAIL_PX = 240;
export const ASSET_DRAG_TYPE = 'application/x-antares-asset';

const CLIP_TONE: Record<Clip['kind'], string> = {
  video: 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_25%,transparent)]',
  image: 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_25%,transparent)]',
  audio: 'border-[var(--accent-green)] bg-[color-mix(in_srgb,var(--accent-green)_25%,transparent)]',
  text: 'border-[var(--accent-secondary)] bg-[color-mix(in_srgb,var(--accent-secondary)_25%,transparent)]',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    Boolean(target.closest('[role="dialog"]'))
  );
}

interface TimelinePanelProps {
  project: EditorProject;
  selectedClipId: string | null;
  playheadUs: number;
  onSelectClip: (clipId: string | null) => void;
  onSeek: (us: number) => void;
  onOperation: (op: TimelineOperation) => void;
  onImport: () => void;
  onAddAsset: (assetId: string) => void;
}

export function TimelinePanel({
  project,
  selectedClipId,
  playheadUs,
  onSelectClip,
  onSeek,
  onOperation,
  onImport,
  onAddAsset,
}: TimelinePanelProps) {
  const { fps } = project.canvas;
  const levels = useMemo(() => zoomLevels(fps), [fps]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoomIndex, setZoomIndex] = useState(() => Math.min(7, levels.length - 1));
  const [hoverUs, setHoverUs] = useState<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewWidth, setViewWidth] = useState(800);
  const level = levels[Math.min(zoomIndex, levels.length - 1)];

  const durationUs = timelineEndUs(project.clips);
  const tracks = useMemo(() => [...project.tracks].sort((a, b) => a.order - b.order), [project.tracks]);
  const contentWidth = Math.max(viewWidth, durationUs * level.pxPerUs + TAIL_PX);
  const toX = (us: number) => us * level.pxPerUs;
  const toUs = (x: number) => snapToFrame(x / level.pxPerUs, fps);

  const selectedClip = project.clips.find((c) => c.id === selectedClipId) ?? null;
  const splitTarget =
    selectedClip ?? tracks.map((t) => clipAt(project.clips, t.id, playheadUs)).find(Boolean) ?? null;

  const zoomBy = (delta: number) =>
    setZoomIndex((i) => Math.max(0, Math.min(levels.length - 1, i + delta)));
  const zoomFit = () => setZoomIndex(fitZoomIndex(levels, durationUs, viewWidth - 40));
  const split = () => {
    if (splitTarget) onOperation({ type: 'split', clipId: splitTarget.id, atTimelineUs: playheadUs });
  };
  const remove = () => {
    if (!selectedClip) return;
    onOperation({ type: 'delete', clipId: selectedClip.id });
    onSelectClip(null);
  };

  const actions = useRef({ split, remove, zoomBy, zoomFit, onSeek, playheadUs, durationUs, fps });
  actions.current = { split, remove, zoomBy, zoomFit, onSeek, playheadUs, durationUs, fps };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const resize = new ResizeObserver(() => setViewWidth(el.clientWidth));
    resize.observe(el);
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        actions.current.zoomBy(event.deltaY < 0 ? 1 : -1);
      } else if (event.altKey) {
        event.preventDefault();
        el.scrollLeft += event.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      resize.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const a = actions.current;
      const frame = (1_000_000 * a.fps.den) / a.fps.num;
      const ctrl = event.ctrlKey || event.metaKey;
      let handled = true;
      if (ctrl && event.key.toLowerCase() === 'k') a.split();
      else if (event.key === 'Delete' || event.key === 'Backspace') a.remove();
      else if (event.key === 'ArrowRight') a.onSeek(Math.min(a.durationUs, a.playheadUs + (event.shiftKey ? 1_000_000 : frame)));
      else if (event.key === 'ArrowLeft') a.onSeek(Math.max(0, a.playheadUs - (event.shiftKey ? 1_000_000 : frame)));
      else if (event.key === 'Home') a.onSeek(0);
      else if (event.key === 'End') a.onSeek(a.durationUs);
      else if (!ctrl && (event.key === '+' || event.key === '=')) a.zoomBy(1);
      else if (!ctrl && event.key === '-') a.zoomBy(-1);
      else if (event.shiftKey && event.key.toLowerCase() === 'z' && !ctrl) a.zoomFit();
      else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const xFromEvent = (event: MouseEvent) => {
    const rect = scrollRef.current?.getBoundingClientRect();
    return rect ? event.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0) : 0;
  };
  const visibleStartUs = scrollLeft / level.pxPerUs;
  const ticks = rulerTicks(level, visibleStartUs, visibleStartUs + viewWidth / level.pxPerUs);
  const empty = project.clips.length === 0;

  return (
    <section
      className="flex h-64 shrink-0 flex-col border-t border-[var(--border-medium)] bg-[var(--bg-elevated)]"
      aria-label="Línea de tiempo"
      data-testid="editor-timeline"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) event.preventDefault();
      }}
      onDrop={(event) => {
        const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
        if (assetId) {
          event.preventDefault();
          onAddAsset(assetId);
        }
      }}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 text-xs">
        <ToolButton label="Dividir" shortcut="Ctrl+K" disabled={!splitTarget} onClick={split}>
          Dividir
        </ToolButton>
        <ToolButton label="Eliminar" shortcut="Supr" disabled={!selectedClip} onClick={remove}>
          Eliminar
        </ToolButton>
        <div className="flex-1 text-center font-mono tabular-nums" data-testid="editor-timecode">
          <span className="text-[var(--accent-primary)]">{formatTimecode(playheadUs, fps)}</span>
          <span className="text-[var(--text-muted)]"> / {formatTimecode(durationUs, fps)}</span>
        </div>
        <ToolButton label="Ajustar a la vista" shortcut="Shift+Z" onClick={zoomFit}>
          Ajustar
        </ToolButton>
        <ToolButton label="Alejar" shortcut="-" onClick={() => zoomBy(-1)}>
          −
        </ToolButton>
        <input
          type="range"
          aria-label="Zoom de la línea de tiempo"
          className="w-24 accent-[var(--accent-primary)]"
          min={0}
          max={levels.length - 1}
          value={zoomIndex}
          onChange={(event) => setZoomIndex(Number(event.target.value))}
        />
        <ToolButton label="Acercar" shortcut="+" onClick={() => zoomBy(1)}>
          +
        </ToolButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 border-r border-[var(--border-subtle)]" style={{ width: HEADER_WIDTH }}>
          <div style={{ height: RULER_HEIGHT }} />
          {tracks.map((track) => (
            <div
              key={track.id}
              className="flex items-center px-3 text-[11px] text-[var(--text-muted)]"
              style={{ height: TRACK_HEIGHT[track.kind] }}
            >
              {track.kind === 'video' ? 'Video' : 'Audio'}
              {track.locked && ' · bloqueada'}
            </div>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
          onMouseMove={(event) => setHoverUs(toUs(xFromEvent(event)))}
          onMouseLeave={() => setHoverUs(null)}
        >
          <div className="relative" style={{ width: contentWidth, height: '100%' }}>
            <div
              className="relative cursor-pointer border-b border-[var(--border-subtle)]"
              style={{ height: RULER_HEIGHT }}
              data-testid="editor-ruler"
              onMouseDown={(event) => onSeek(toUs(xFromEvent(event)))}
            >
              {ticks.map((tick) => (
                <div
                  key={tick.us}
                  className="absolute bottom-0 w-px bg-[var(--border-medium)]"
                  style={{ left: toX(tick.us), height: tick.major ? 10 : 5 }}
                >
                  {tick.major && (
                    <span className="absolute bottom-2.5 left-1 whitespace-nowrap text-[10px] text-[var(--text-muted)]">
                      {formatTimecode(tick.us, fps).slice(0, 5)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {empty ? (
              <button
                type="button"
                className="absolute left-4 right-4 top-1/2 flex h-[70px] -translate-y-1/2 items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-medium)] text-xs text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]"
                style={{ marginTop: RULER_HEIGHT / 2 }}
                onClick={onImport}
              >
                Arrastra medios aquí o pulsa para importar
              </button>
            ) : (
              tracks.map((track) => (
                <div
                  key={track.id}
                  className="relative border-b border-[var(--border-subtle)]"
                  style={{ height: TRACK_HEIGHT[track.kind] }}
                  onMouseDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    onSelectClip(null);
                    onSeek(toUs(xFromEvent(event)));
                  }}
                >
                  {project.clips
                    .filter((clip) => clip.trackId === track.id)
                    .map((clip) => {
                      const selected = clip.id === selectedClipId;
                      const asset = project.assets.find((a) => a.id === clip.assetId);
                      const label = clip.kind === 'text' ? clip.text?.content || 'Texto' : asset?.displayName ?? 'Clip';
                      return (
                        <button
                          key={clip.id}
                          type="button"
                          aria-pressed={selected}
                          title={label}
                          className={`absolute top-1 bottom-1 overflow-hidden rounded-md border px-2 text-left text-[11px] text-[var(--text-primary)] ${CLIP_TONE[clip.kind]} ${
                            selected ? 'ring-2 ring-[var(--accent-primary)]' : ''
                          }`}
                          style={{ left: toX(clip.timelineStartUs), width: Math.max(4, toX(clipDurationUs(clip))) }}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => onSelectClip(selected ? null : clip.id)}
                        >
                          <span className="block truncate">{label}</span>
                        </button>
                      );
                    })}
                </div>
              ))
            )}

            {hoverUs !== null && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-[var(--accent-yellow)]"
                style={{ left: toX(hoverUs) }}
              />
            )}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--accent-primary)]"
              style={{ left: toX(playheadUs) }}
              data-testid="editor-playhead"
            >
              <div className="absolute -left-[7px] top-0 h-3.5 w-3.5 rounded-b-sm bg-[var(--accent-primary)]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ToolButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${shortcut})`}
      disabled={disabled}
      className="h-6 min-w-6 rounded px-2 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
