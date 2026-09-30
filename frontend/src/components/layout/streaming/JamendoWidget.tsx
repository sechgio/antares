import { useEffect, useRef, useState, type CSSProperties, type ComponentType } from 'react';
import {
  AlertCircle,
  ExternalLink,
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
import type { StreamItem, StreamTrack } from './core';
import { jamendoSource } from './jamendo';
import { createStreamPlayer, type StreamPlayer } from './player';
import './jamendo.css';

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
  ...jamendoSource.strings,
} as const;

function fmtDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

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
        className={`antares-jamendo-action${className ? ` ${className}` : ''}`}
        aria-label={label}
        onClick={onClick}
      >
        <span className="antares-jamendo-action-icon">
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

function useItemSearch(query: string, blocked: boolean): ItemListState {
  const [state, setState] = useState<ItemListState>({ data: [], isFetching: !blocked, isError: false });
  useEffect(() => {
    if (blocked) {
      setState({ data: [], isFetching: false, isError: false });
      return;
    }
    const ctrl = new AbortController();
    setState((prev) => ({ ...prev, isFetching: true, isError: false }));
    void (query ? jamendoSource.search(query, ctrl.signal) : jamendoSource.browse(ctrl.signal))
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ data, isFetching: false, isError: false });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ data: [], isFetching: false, isError: true });
      });
    return () => ctrl.abort();
  }, [query, blocked]);
  return state;
}

function ItemRow({
  item,
  list,
  player,
  pending,
  failed,
  onChoose,
}: {
  item: StreamItem;
  list: StreamItem[];
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
    <div className="antares-jamendo-row" data-current={isCurrent} data-pending={pending || undefined}>
      <Button
        variant="none"
        size="none"
        className="antares-jamendo-row-main"
        aria-label={label}
        title={broken || failed ? T.resolveError : undefined}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => onChoose(item, list)}
      >
        <span className="antares-jamendo-row-mark" role={broken || failed ? 'status' : undefined}>
          {pending ? <LoaderCircle size={12} className="animate-spin" /> : <Icon size={12} />}
        </span>
        <span className="antares-jamendo-row-copy">
          <span className="antares-jamendo-row-name">{item.title}</span>
          <span className="antares-jamendo-row-artist">{item.artist}</span>
        </span>
        {item.duration > 0 && (
          <span className="antares-jamendo-row-duration">{fmtDuration(item.duration)}</span>
        )}
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
  const blocked = jamendoSource.keyMissing?.() === true;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [text]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text), 350);
    return () => window.clearTimeout(timer);
  }, [text]);

  const result = useItemSearch(query, blocked);
  const pending = result.isFetching || text !== query;

  useEffect(() => {
    if (jamendoSource.listIsQueue) player.queue.set(result.data as StreamTrack[]);
  }, [player, result.data]);

  async function choose(item: StreamItem, list: StreamItem[]) {
    const current = player.track.get();
    if (current && (current.id === item.id || current.itemId === item.id)) {
      player.toggle();
      return;
    }
    setPendingId(item.id);
    setFailedId(null);
    try {
      const { tracks, index } = await jamendoSource.resolve(item, list);
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

  if (blocked) {
    return (
      <div className="antares-jamendo-error" role="status">
        {T.keyHint ?? T.searchError}
      </div>
    );
  }

  return (
    <div>
      <div className="antares-jamendo-search">
        <div className="antares-jamendo-search-field">
          <Search size={12} aria-hidden={true} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={T.search}
            aria-label={T.search}
          />
          {pending ? (
            <span className="antares-jamendo-search-loader">
              <LoaderCircle size={12} className="animate-spin" aria-label={T.searching} />
            </span>
          ) : null}
        </div>
      </div>
      <div className="antares-jamendo-list-label">{text ? T.results : T.trending}</div>
      <div ref={listRef} className="antares-jamendo-list" aria-label={text ? T.results : T.trending}>
        {result.data.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            list={result.data}
            player={player}
            pending={pendingId === item.id}
            failed={failedId === item.id}
            onChoose={choose}
          />
        ))}
        {result.isError && (
          <div className="antares-jamendo-error" role="status">
            {T.searchError}
          </div>
        )}
        {!pending && !result.isError && result.data.length === 0 && (
          <div className="antares-jamendo-error" role="status">
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
    <div className="antares-jamendo-foot">
      <div className="antares-jamendo-now" role="status">
        {track ? (
          <>
            <span className="antares-jamendo-live" aria-hidden={true} />
            <span className="antares-jamendo-now-text">
              {track.artist ? `${track.artist} — ` : ''}
              {track.title}
            </span>
            <WithHoverTooltip label={T.open} placement="top">
              <a
                href={track.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={T.open}
                className="antares-jamendo-open"
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
          <span className="antares-jamendo-now-text">{T.empty}</span>
        )}
        {status === 'error' && (
          <span className="antares-jamendo-error" role="status">
            {T.error}
          </span>
        )}
      </div>
      <div className="antares-jamendo-transport">
        <Action label={T.previous} icon={SkipBack} onClick={player.previous} />
        <Action
          label={active ? T.pause : T.play}
          icon={active ? Pause : Play}
          busy={status === 'connecting'}
          className="antares-jamendo-play"
          onClick={player.toggle}
        />
        <Action label={T.next} icon={SkipForward} onClick={player.next} />
        <span className="antares-jamendo-transport-space" />
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

function JamendoBar({ player }: { player: StreamPlayer }) {
  const track = useValue(player.track);
  const status = useValue(player.status);
  const popover = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    direction: 'down',
    align: 'end',
    estimatedWidth: 292,
    estimatedHeight: 300,
    gap: 6,
  });
  const active = status === 'live' || status === 'connecting';

  return (
    <div className="antares-jamendo-bar" data-jamendo-status={status}>
      <Button
        ref={popover.triggerRef}
        variant="none"
        size="none"
        className="antares-jamendo-browse"
        aria-label={`${T.browse}${track ? `: ${track.title}` : ''}`}
        onClick={popover.toggle}
      >
        <span className="jamendo-name">{track ? track.title : jamendoSource.name}</span>
      </Button>
      {popover.isOpen && (
        <div
          ref={popover.popupRef}
          data-jamendo-status={status}
          className="antares-jamendo-panel rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl"
          role="dialog"
          aria-label={jamendoSource.name}
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
              : { position: 'fixed', top: -10000, left: -10000, width: 292, zIndex: 10000 }
          }
        >
          <ItemList player={player} />
          <Transport player={player} />
        </div>
      )}
      <Action
        label={active ? T.pause : T.play}
        icon={active ? Pause : Play}
        busy={status === 'connecting'}
        onClick={player.toggle}
      />
      <Action label={T.next} icon={SkipForward} onClick={player.next} />
    </div>
  );
}

export default function JamendoWidget() {
  const [player, setPlayer] = useState<StreamPlayer | null>(null);

  useEffect(() => {
    const created = createStreamPlayer(jamendoSource.id);
    setPlayer(created);
    return () => created.dispose();
  }, []);

  if (!player) return null;
  return <JamendoBar player={player} />;
}
