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
import {
  T,
  fetchTrending,
  openExternal,
  searchTracks,
  useValue,
  type AudiusTrack,
} from './core';
import { createAudiusPlayer, type AudiusPlayer } from './player';
import './audius.css';

function _fmtDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface SmallActionProps {
  label: string;
  icon: ComponentType<{ size?: number; style?: CSSProperties; fill?: string }>;
  onClick: () => void;
  pressed?: boolean;
  busy?: boolean;
  className?: string;
}

function SmallAction({ label, icon: Icon, onClick, pressed, busy = false, className }: SmallActionProps) {
  return (
    <WithHoverTooltip label={label} placement="bottom">
      <Button
        variant="none"
        size="none"
        className={`antares-audius-action${className ? ` ${className}` : ''}`}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        <span className="antares-audius-action-icon">
          {busy ? <LoaderCircle size={12} className="animate-spin" aria-label={label} /> : <Icon size={12} />}
        </span>
      </Button>
    </WithHoverTooltip>
  );
}

interface TrackListState {
  data: AudiusTrack[];
  isFetching: boolean;
  isError: boolean;
}

function useTrackSearch(query: string): TrackListState {
  const [state, setState] = useState<TrackListState>({ data: [], isFetching: true, isError: false });
  useEffect(() => {
    const ctrl = new AbortController();
    setState((prev) => ({ ...prev, isFetching: true, isError: false }));
    void (query ? searchTracks(query, ctrl.signal) : fetchTrending(ctrl.signal))
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

function TrackRow({
  track,
  list,
  index,
  player,
}: {
  track: AudiusTrack;
  list: AudiusTrack[];
  index: number;
  player: AudiusPlayer;
}) {
  const current = useValue(player.track);
  const status = useValue(player.status);
  const isCurrent = current?.id === track.id;
  const active = isCurrent && (status === 'live' || status === 'connecting');
  const failed = isCurrent && status === 'error';
  const label = `${active ? T.pauseTrack : T.playTrack}: ${track.title}`;
  const Icon = failed ? AlertCircle : active ? Pause : Play;

  return (
    <div className="antares-audius-row" data-current={isCurrent}>
      <Button
        variant="none"
        size="none"
        className="antares-audius-row-main"
        aria-label={label}
        title={failed ? T.error : undefined}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => (isCurrent ? player.toggle() : player.select(track, list))}
      >
        <span className="antares-audius-row-mark">
          <span className="antares-audius-row-rank" aria-hidden={true}>
            {index + 1}
          </span>
          <span className="antares-audius-row-icon" role={failed ? 'status' : undefined}>
            <Icon size={12} />
          </span>
        </span>
        <span className="antares-audius-row-copy">
          <span className="antares-audius-row-name">{track.title}</span>
          <span className="antares-audius-row-artist">
            {track.artist}
            {track.duration > 0 && (
              <span className="antares-audius-row-duration">{_fmtDuration(track.duration)}</span>
            )}
          </span>
        </span>
      </Button>
    </div>
  );
}

function TrackList({ player }: { player: AudiusPlayer }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const text = search.trim();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [text]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text), 350);
    return () => window.clearTimeout(timer);
  }, [text]);

  const result = useTrackSearch(query);
  const pending = result.isFetching || text !== query;

  useEffect(() => {
    player.queue.set(result.data);
  }, [player, result.data]);

  return (
    <div>
      <div className="antares-audius-search" data-filled={Boolean(search)}>
        <div className="antares-audius-search-field">
          <Search size={12} aria-hidden={true} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={T.search}
            aria-label={T.search}
          />
          {pending ? (
            <span className="antares-audius-search-loader">
              <LoaderCircle size={12} className="animate-spin" aria-label={T.searching} />
            </span>
          ) : null}
        </div>
      </div>
      <div className="antares-audius-list-label">{text ? T.results : T.trending}</div>
      <div ref={listRef} className="antares-audius-list" aria-label={text ? T.searching : T.trending}>
        {result.data.map((item, index) => (
          <TrackRow key={item.id} track={item} list={result.data} index={index} player={player} />
        ))}
        {result.isError && (
          <div className="antares-audius-error" role="status">
            {T.searchError}
          </div>
        )}
        {!pending && !result.isError && result.data.length === 0 && (
          <div className="antares-audius-error" role="status">
            {text ? T.noResults : T.empty}
          </div>
        )}
      </div>
    </div>
  );
}

function Transport({ player }: { player: AudiusPlayer }) {
  const track = useValue(player.track);
  const status = useValue(player.status);
  const volume = useValue(player.volume);
  const active = status === 'live' || status === 'connecting';

  return (
    <div>
      <div className="antares-audius-now" role="status">
        {track ? (
          <>
            <span className="antares-audius-eq" aria-hidden={true}>
              <i />
              <i />
              <i />
            </span>
            <span className="antares-audius-now-text">
              {track.artist ? `${track.artist} — ` : ''}
              {track.title}
            </span>
            <WithHoverTooltip label={T.open} placement="top">
              <a
                href={track.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={T.open}
                className="antares-audius-open"
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
          <span className="antares-audius-now-text">{T.empty}</span>
        )}
        {status === 'error' && (
          <span className="antares-audius-error" role="status">
            {T.error}
          </span>
        )}
      </div>
      <div className="antares-audius-transport">
        <SmallAction label={T.previous} icon={SkipBack} onClick={player.previous} />
        <SmallAction
          label={active ? T.pause : T.play}
          icon={active ? Pause : Play}
          busy={status === 'connecting'}
          className="antares-audius-play"
          onClick={player.toggle}
        />
        <SmallAction label={T.next} icon={SkipForward} onClick={player.next} />
        <span className="antares-audius-transport-space" />
        <SmallAction
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

function AudiusBar({ player }: { player: AudiusPlayer }) {
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
    <div className="antares-audius-bar" data-audius-status={status}>
      <Button
        ref={popover.triggerRef}
        variant="none"
        size="none"
        className="antares-audius-browse"
        aria-label={`${T.browse}${track ? `: ${track.title}` : ''}`}
        onClick={popover.toggle}
      >
        <span className="antares-audius-eq" aria-hidden={true}>
          <i />
          <i />
          <i />
        </span>
        <span className="audius-name">{track ? track.title : T.audius}</span>
      </Button>
      {popover.isOpen && (
        <div
          ref={popover.popupRef}
          data-audius-status={status}
          className="antares-audius-panel rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 shadow-xl"
          role="dialog"
          aria-label={T.audius}
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
          <TrackList player={player} />
          <Transport player={player} />
        </div>
      )}
      <SmallAction
        label={active ? T.pause : T.play}
        icon={active ? Pause : Play}
        busy={status === 'connecting'}
        className="antares-audius-play"
        onClick={player.toggle}
      />
      <SmallAction label={T.next} icon={SkipForward} onClick={player.next} />
    </div>
  );
}

export default function AudiusWidget() {
  const [player, setPlayer] = useState<AudiusPlayer | null>(null);

  useEffect(() => {
    const created = createAudiusPlayer();
    setPlayer(created);
    return () => created.dispose();
  }, []);

  if (!player) return null;
  return <AudiusBar player={player} />;
}
