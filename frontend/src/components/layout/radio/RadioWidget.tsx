import { useEffect, useRef, useState, type CSSProperties, type ComponentType } from 'react';
import {
  AlertCircle,
  ExternalLink,
  LoaderCircle,
  Pause,
  Pin,
  Play,
  Search,
  Volume2,
  VolumeX,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import {
  NIGHTRIDE,
  PRESETS,
  T,
  httpsUrl,
  openExternal,
  sameStation,
  uniqueStations,
  useValue,
  type Station,
} from './core';
import { createPlayer, type RadioPlayer } from './player';
import { trackCredit } from './artist';
import { useArtistUrl, useIcecastMetadata, useStationSearch } from './queries';
import { Waveform } from './Waveform';
import './radio.css';

function NextArrow() {
  return (
    <span className="antares-radio-next" aria-hidden={true}>
      <Play style={{ width: 7, height: 12, flexShrink: 0 }} fill="currentColor" />
      <Play style={{ width: 7, height: 12, flexShrink: 0, marginLeft: -2 }} fill="currentColor" />
    </span>
  );
}

interface SmallActionProps {
  label: string;
  icon: ComponentType<{ size?: number; style?: CSSProperties; fill?: string }>;
  onClick: () => void;
  pressed?: boolean;
  className?: string;
  wrapClassName?: string;
  busy?: boolean;
}

function SmallAction({
  label,
  icon: Icon,
  onClick,
  pressed,
  className,
  wrapClassName,
  busy = false,
}: SmallActionProps) {
  return (
    <WithHoverTooltip label={label} placement="bottom" className={wrapClassName}>
      <Button
        variant="none"
        size="none"
        className={`antares-radio-action ${className ?? ''}`}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        <span className="antares-radio-action-icon">
          {busy ? <LoaderCircle size={12} className="animate-spin" aria-label={label} /> : <Icon size={12} />}
        </span>
      </Button>
    </WithHoverTooltip>
  );
}

function Signal({ player }: { player: RadioPlayer }) {
  const station = useValue(player.station);
  const status = useValue(player.status);
  const mode = useValue(player.meterMode);
  const stream = new URL(station.url);
  const endpoints: Record<string, string> = {
    'stream.nightride.fm': `${NIGHTRIDE}status-json.xsl`,
    'media01.gamingnow.net': 'https://media01.gamingnow.net:8010/status-json.xsl',
  };
  const endpoint = endpoints[stream.hostname];
  const metadata = useIcecastMetadata(endpoint, status === 'live');
  const sources = metadata?.icestats?.source;
  const sourceList = Array.isArray(sources) ? sources : sources ? [sources] : [];
  const source = sourceList.find((item) => item.listenurl?.endsWith(stream.pathname));
  const track = status === 'live' && typeof source?.title === 'string' ? source.title : '';
  const credit = trackCredit(track ? (source ?? null) : null);
  const artistUrl = useArtistUrl(credit.artist, Boolean(credit.artist));
  const text =
    status === 'live' ? track || (mode === 'activity' ? T.audioOnly : '') : T[status];

  return (
    <div className="antares-radio-signal">
      <Waveform player={player} />
      <div className="antares-radio-track" data-track={Boolean(track)} role="status">
        {status === 'connecting' && (
          <LoaderCircle size={12} className="animate-spin" aria-label={T.connecting} />
        )}
        {credit.artist ? (
          artistUrl ? (
            <WithHoverTooltip label={`${T.artistProfile}: ${credit.artist}`} placement="top">
              <a
                href={artistUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${T.artistProfile}: ${credit.artist}`}
                className="antares-radio-artist"
                onClick={(event) => {
                  event.preventDefault();
                  openExternal(artistUrl);
                }}
              >
                <span>{credit.artist}</span>
                <ExternalLink style={{ width: 10, height: 10 }} aria-hidden={true} />
              </a>
            </WithHoverTooltip>
          ) : (
            <span className="antares-radio-track-text">{credit.artist}</span>
          )
        ) : null}
        {credit.artist && (
          <span className="antares-radio-track-separator" aria-hidden={true}>
            —
          </span>
        )}
        <WithHoverTooltip label={text || undefined} placement="top">
          <span className="antares-radio-track-text">{credit.artist ? credit.title : text}</span>
        </WithHoverTooltip>
      </div>
    </div>
  );
}

function StationRow({ station, player }: { station: Station; player: RadioPlayer }) {
  const current = sameStation(useValue(player.station), station);
  const status = useValue(player.status);
  const active = status === 'live' || status === 'connecting';
  const failed = current && status === 'error';
  const saved = useValue(player.favorites).some((item) => sameStation(item, station));
  const label = `${failed ? T.retry : current && active ? T.pause : T.play}: ${station.name}`;
  const Icon = failed ? AlertCircle : current && active ? Pause : Play;

  return (
    <div className="antares-radio-row" data-current={current} data-pinned={saved}>
      <Button
        variant="none"
        size="none"
        className="antares-radio-row-main"
        aria-label={label}
        title={failed ? T.streamError : undefined}
        aria-current={current ? 'true' : undefined}
        onClick={() => (current ? player.toggle() : void player.play(station))}
      >
        <span
          className="antares-radio-row-icon"
          role={failed ? 'status' : undefined}
          aria-label={failed ? T.error : undefined}
        >
          <Icon size={12} />
        </span>
        <span className="antares-radio-row-copy">
          <span className="antares-radio-row-name">{station.name}</span>
        </span>
      </Button>
      <SmallAction
        label={`${saved ? T.unsave : T.save}: ${station.name}`}
        icon={Pin}
        onClick={() => player.favorite(station)}
        pressed={saved}
        wrapClassName="antares-radio-pin"
      />
    </div>
  );
}

function Stations({ player }: { player: RadioPlayer }) {
  const favorites = useValue(player.favorites);
  const current = useValue(player.station);
  const [browseStation, setBrowseStation] = useState<Station>(() => player.station.get());
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const text = search.trim();

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [text]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text), 350);
    return () => window.clearTimeout(timer);
  }, [text]);

  const result = useStationSearch(query, query.length >= 2 && text === query);
  const matches = (item: Station) =>
    [item.name, item.description, item.provider].some((value) =>
      value?.toLowerCase().includes(text.toLowerCase()),
    );
  const local = uniqueStations([...favorites, ...PRESETS]).filter(matches);
  const remote = text.length >= 2 && query === text ? result.data : [];
  const results = uniqueStations([...local, ...remote]);
  const anchored = results.some((item) => sameStation(item, browseStation))
    ? results
    : [browseStation, ...results];
  const items = anchored.some((item) => sameStation(item, current))
    ? anchored
    : [current, ...anchored];
  const pending = text.length >= 2 && (text !== query || result.isFetching);
  const searchFailed = text.length >= 2 && query === text && result.isError;

  return (
    <div>
      <div className="antares-radio-search" data-filled={Boolean(search)}>
        <div className="antares-radio-search-field">
          <Search size={12} aria-hidden={true} />
          <input
            value={search}
            onChange={(event) => {
              setBrowseStation(player.station.get());
              setSearch(event.target.value);
            }}
            placeholder={T.search}
            aria-label={T.search}
          />
          {pending ? (
            <span className="antares-radio-search-loader">
              <LoaderCircle size={12} className="animate-spin" aria-label={T.searching} />
            </span>
          ) : null}
        </div>
      </div>
      <div ref={listRef} className="antares-radio-list" data-radio-pending={pending}>
        {items.map((item) => (
          <StationRow key={item.id} station={item} player={player} />
        ))}
        {searchFailed && (
          <div className="antares-radio-error" role="status">
            {T.searchError}
          </div>
        )}
        {!pending && !searchFailed && text && results.length === 0 && (
          <div className="antares-radio-error" role="status">
            {T.noResults}
          </div>
        )}
      </div>
    </div>
  );
}

function Transport({ player }: { player: RadioPlayer }) {
  const volume = useValue(player.volume);
  const station = useValue(player.station);
  const status = useValue(player.status);
  const active = status === 'live' || status === 'connecting';
  const homepage = httpsUrl(station.homepage);

  return (
    <div className="antares-radio-volume">
      <SmallAction
        label={active ? T.pause : T.play}
        icon={active ? Pause : Play}
        busy={status === 'connecting'}
        onClick={player.toggle}
      />
      <SmallAction label={T.next} icon={NextArrow} onClick={player.next} />
      <span className="antares-radio-volume-space" />
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
      <span className="antares-radio-website">
        {homepage && (
          <SmallAction label={T.visit} icon={ExternalLink} onClick={() => openExternal(homepage)} />
        )}
      </span>
    </div>
  );
}

function RadioBar({ player }: { player: RadioPlayer }) {
  const station = useValue(player.station);
  const status = useValue(player.status);
  const popover = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    direction: 'down',
    align: 'end',
    estimatedWidth: 292,
    estimatedHeight: 300,
    gap: 6,
  });
  const [browseWidth, setBrowseWidth] = useState<number | null>(null);
  const active = status === 'live' || status === 'connecting';

  const onTriggerClick = () => {
    if (!popover.isOpen && popover.triggerRef.current) {
      setBrowseWidth(popover.triggerRef.current.getBoundingClientRect().width);
    }
    popover.toggle();
  };

  return (
    <div className="antares-radio-bar" data-radio-status={status}>
      <Waveform player={player} compact />
      <Button
        ref={popover.triggerRef}
        variant="none"
        size="none"
        className="antares-radio-browse"
        style={{ width: popover.isOpen && browseWidth ? browseWidth : undefined }}
        aria-label={`${T.browse}: ${station.name}`}
        onClick={onTriggerClick}
      >
        <span className="radio-name">{station.name}</span>
      </Button>
      {popover.isOpen && (
        <div
          ref={popover.popupRef}
          className="antares-radio-panel rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 shadow-xl"
          role="dialog"
          aria-label={T.radio}
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
          <Stations player={player} />
          <Signal player={player} />
          <Transport player={player} />
        </div>
      )}
      <SmallAction
        label={active ? T.pause : T.play}
        icon={active ? Pause : Play}
        busy={status === 'connecting'}
        onClick={player.toggle}
      />
      <SmallAction label={T.next} icon={NextArrow} onClick={player.next} />
    </div>
  );
}

export default function RadioWidget() {
  const [player, setPlayer] = useState<RadioPlayer | null>(null);

  useEffect(() => {
    const created = createPlayer();
    setPlayer(created);
    return () => created.dispose();
  }, []);

  if (!player) return null;
  return <RadioBar player={player} />;
}
