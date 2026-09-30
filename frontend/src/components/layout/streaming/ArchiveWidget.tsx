import { useEffect, useRef, useState, type CSSProperties, type ComponentType } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Landmark,
  LoaderCircle,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import { openExternal, useValue } from '../radio/core';
import type { StreamItem } from './core';
import { archiveSource } from './archive';
import { createStreamPlayer, type StreamPlayer } from './player';
import './archive.css';

const T = {
  play: 'Reproducir',
  pause: 'Pausar',
  next: 'Siguiente',
  previous: 'Anterior',
  volume: 'Volumen',
  mute: 'Silenciar',
  unmute: 'Quitar silencio',
  searching: 'Buscando',
  results: 'Resultados',
  empty: 'Nada por aquí',
  searchError: 'La búsqueda falló. Reintenta.',
  noResults: 'Sin resultados',
  error: 'No se pudo reproducir esta pista',
  resolveError: 'Este ítem no tiene audio reproducible',
  pauseTrack: 'Pausar',
  playTrack: 'Reproducir',
  ...archiveSource.strings,
} as const;

interface ActionProps {
  label: string;
  icon: ComponentType<{ size?: number; style?: CSSProperties; fill?: string }>;
  onClick: () => void;
  busy?: boolean;
  className?: string;
}

function Action({ label, icon: Icon, onClick, busy = false, className }: ActionProps) {
  return (
    <WithHoverTooltip label={label} placement="bottom">
      <Button
        variant="none"
        size="none"
        className={`antares-archive-action${className ? ` ${className}` : ''}`}
        aria-label={label}
        onClick={onClick}
      >
        <span className="antares-archive-action-icon">
          {busy ? <LoaderCircle size={12} className="animate-spin" aria-label={label} /> : <Icon size={12} />}
        </span>
      </Button>
    </WithHoverTooltip>
  );
}

interface ItemListState {
  data: StreamItem[];
  isFetching: boolean;
  isError: boolean;
}

function useItemSearch(query: string): ItemListState {
  const [state, setState] = useState<ItemListState>({ data: [], isFetching: true, isError: false });
  useEffect(() => {
    const ctrl = new AbortController();
    setState((prev) => ({ ...prev, isFetching: true, isError: false }));
    void (query ? archiveSource.search(query, ctrl.signal) : archiveSource.browse(ctrl.signal))
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ data, isFetching: false, isError: false });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ data: [], isFetching: false, isError: true });
      });
    return () => ctrl.abort();
  }, [query]);
  return state;
}

function ItemRow({
  item,
  list,
  index,
  player,
  pending,
  failed,
  onChoose,
}: {
  item: StreamItem;
  list: StreamItem[];
  index: number;
  player: StreamPlayer;
  pending: boolean;
  failed: boolean;
  onChoose: (item: StreamItem, list: StreamItem[]) => void;
}) {
  const current = useValue(player.track);
  const status = useValue(player.status);
  const isCurrent = current != null && (current.id === item.id || current.itemId === item.id);
  const active = isCurrent && (status === 'live' || status === 'connecting');
  const broken = isCurrent && status === 'error';
  const label = `${active ? T.pauseTrack : T.playTrack}: ${item.title}`;
  const Icon = broken || failed ? AlertCircle : active ? Pause : Play;

  return (
    <div className="antares-archive-row" data-current={isCurrent}>
      <Button
        variant="none"
        size="none"
        className="antares-archive-row-main"
        aria-label={label}
        title={broken || failed ? T.resolveError : undefined}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => onChoose(item, list)}
      >
        <span className="antares-archive-row-mark">
          <span className="antares-archive-row-index" aria-hidden={true}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="antares-archive-row-icon" role={broken || failed ? 'status' : undefined}>
            {pending ? <LoaderCircle size={12} className="animate-spin" /> : <Icon size={12} />}
          </span>
        </span>
        <span className="antares-archive-row-copy">
          <span className="antares-archive-row-name">{item.title}</span>
          <span className="antares-archive-row-artist">{item.artist}</span>
        </span>
      </Button>
    </div>
  );
}

function ItemList({ player }: { player: StreamPlayer }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const text = search.trim();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [text]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text), 350);
    return () => window.clearTimeout(timer);
  }, [text]);

  const result = useItemSearch(query);
  const pending = result.isFetching || text !== query;

  async function choose(item: StreamItem, list: StreamItem[]) {
    const current = player.track.get();
    if (current && (current.id === item.id || current.itemId === item.id)) {
      player.toggle();
      return;
    }
    setPendingId(item.id);
    setFailedId(null);
    try {
      const { tracks, index } = await archiveSource.resolve(item, list);
      const target = tracks[index] ?? tracks[0];
      if (!target) {
        setFailedId(item.id);
        return;
      }
      player.select(target, tracks);
    } catch {
      setFailedId(item.id);
    } finally {
      setPendingId((id) => (id === item.id ? null : id));
    }
  }

  return (
    <div>
      <div className="antares-archive-search">
        <Search size={12} aria-hidden={true} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={T.search}
          aria-label={T.search}
        />
        {pending ? (
          <span className="antares-archive-search-loader">
            <LoaderCircle size={12} className="animate-spin" aria-label={T.searching} />
          </span>
        ) : null}
      </div>
      <div ref={listRef} className="antares-archive-list" aria-label={text ? T.results : T.trending}>
        {result.data.map((item, index) => (
          <ItemRow
            key={item.id}
            item={item}
            list={result.data}
            index={index}
            player={player}
            pending={pendingId === item.id}
            failed={failedId === item.id}
            onChoose={choose}
          />
        ))}
        {result.isError && (
          <div className="antares-archive-error" role="status">
            {T.searchError}
          </div>
        )}
        {!pending && !result.isError && result.data.length === 0 && (
          <div className="antares-archive-error" role="status">
            {text ? T.noResults : T.empty}
          </div>
        )}
      </div>
    </div>
  );
}

function Transport({ player }: { player: StreamPlayer }) {
  const track = useValue(player.track);
  const status = useValue(player.status);
  const volume = useValue(player.volume);
  const active = status === 'live' || status === 'connecting';

  return (
    <div className="antares-archive-foot">
      <div className="antares-archive-now" role="status">
        {track ? (
          <>
            <span className="antares-archive-live" aria-hidden={true} />
            <span className="antares-archive-now-text">
              {track.artist ? `${track.artist} — ` : ''}
              {track.title}
            </span>
            <WithHoverTooltip label={T.open} placement="top">
              <a
                href={track.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={T.open}
                className="antares-archive-open"
                onClick={(event) => {
                  event.preventDefault();
                  openExternal(track.url);
                }}
              >
                <ExternalLink style={{ width: 10, height: 10 }} aria-hidden={true} />
              </a>
            </WithHoverTooltip>
          </>
        ) : (
          <span className="antares-archive-now-text">{T.empty}</span>
        )}
        {status === 'error' && (
          <span className="antares-archive-error" role="status">
            {T.error}
          </span>
        )}
      </div>
      <div className="antares-archive-transport">
        <Action label={T.previous} icon={SkipBack} onClick={player.previous} />
        <Action
          label={active ? T.pause : T.play}
          icon={active ? Pause : Play}
          busy={status === 'connecting'}
          className="antares-archive-play"
          onClick={player.toggle}
        />
        <Action label={T.next} icon={SkipForward} onClick={player.next} />
        <span className="antares-archive-transport-space" />
        <Action
          label={volume ? T.mute : T.unmute}
          icon={volume ? Volume2 : VolumeX}
          onClick={player.mute}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          aria-label={T.volume}
          onChange={(event) => player.setVolume(Number(event.target.value))}
        />
      </div>
    </div>
  );
}

function ArchiveBar({ player }: { player: StreamPlayer }) {
  const track = useValue(player.track);
  const status = useValue(player.status);
  const popover = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    direction: 'down',
    align: 'end',
    estimatedWidth: 300,
    estimatedHeight: 300,
    gap: 6,
  });
  const active = status === 'live' || status === 'connecting';

  return (
    <div className="antares-archive-bar" data-archive-status={status}>
      <div className="antares-archive-group">
        <Button
          ref={popover.triggerRef}
          variant="none"
          size="none"
          className="antares-archive-browse"
          aria-label={`${T.browse}${track ? `: ${track.title}` : ''}`}
          onClick={popover.toggle}
        >
          <span className="antares-archive-mark" aria-hidden={true}>
            <Landmark size={11} />
          </span>
          <span className="antares-archive-cell-name">
            <span className="archive-name">{track ? track.title : archiveSource.name}</span>
            <span className="antares-archive-live" aria-hidden={true} />
          </span>
        </Button>
        <Action
          label={active ? T.pause : T.play}
          icon={active ? Pause : Play}
          busy={status === 'connecting'}
          onClick={player.toggle}
        />
        <Action label={T.next} icon={SkipForward} onClick={player.next} />
      </div>
      {popover.isOpen && (
        <div
          ref={popover.popupRef}
          data-archive-status={status}
          className="antares-archive-panel rounded-sm border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl"
          role="dialog"
          aria-label={archiveSource.name}
          style={
            popover.position
              ? {
                  position: 'fixed',
                  top: popover.position.top,
                  left: popover.position.left,
                  width: popover.position.width,
                  ...(popover.position.maxHeight !== undefined
                    ? { maxHeight: popover.position.maxHeight }
                    : {}),
                  zIndex: 10000,
                }
              : { position: 'fixed', top: -10000, left: -10000, width: 300, zIndex: 10000 }
          }
        >
          <div className="antares-archive-head">
            <span className="antares-archive-title">Archive</span>
            <span className="antares-archive-sub">Audio libre</span>
          </div>
          <ItemList player={player} />
          <Transport player={player} />
        </div>
      )}
    </div>
  );
}

export default function ArchiveWidget() {
  const [player, setPlayer] = useState<StreamPlayer | null>(null);

  useEffect(() => {
    const created = createStreamPlayer(archiveSource.id);
    setPlayer(created);
    return () => created.dispose();
  }, []);

  if (!player) return null;
  return <ArchiveBar player={player} />;
}
