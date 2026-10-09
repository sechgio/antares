import { useCallback, useEffect, useRef, useState, type CSSProperties, type ComponentType } from 'react';
import {
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
import type { PopoverPosition } from '@/hooks/useAnchoredPopover';
import { openExternal, useValue } from '../radio/core';
import type { StreamItem, StreamResolve, StreamSource, StreamTrack } from './core';
import { createStreamPlayer, type StreamPlayer } from './player';

export const STREAM_STRINGS = {
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
} as const;

export interface StreamListStrings {
  search: string;
  searching: string;
  results: string;
  trending: string;
  empty: string;
  noResults: string;
  searchError: string;
  keyHint?: string;
}

export interface StreamTransportStrings {
  previous: string;
  pause: string;
  play: string;
  next: string;
  mute: string;
  unmute: string;
  volume: string;
  empty: string;
  error: string;
  open: string;
}

export function streamPanelStyle(position: PopoverPosition | null, width: number): CSSProperties {
  return position
    ? {
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: position.width,
        ...(position.maxHeight !== undefined ? { maxHeight: position.maxHeight } : {}),
        zIndex: 10000,
      }
    : { position: 'fixed', top: -10000, left: -10000, width, zIndex: 10000 };
}

interface StreamActionProps {
  label: string;
  icon: ComponentType<{ size?: number; style?: CSSProperties; fill?: string }>;
  onClick: () => void;
  busy?: boolean;
  className?: string;
  wrapClassName?: string;
  pressed?: boolean;
  p: string;
}

export function StreamAction({ label, icon: Icon, onClick, busy = false, className, wrapClassName, pressed, p }: StreamActionProps) {
  return (
    <WithHoverTooltip label={label} placement="bottom" className={wrapClassName}>
      <Button
        variant="none"
        size="none"
        className={`${p}-action${className ? ` ${className}` : ''}`}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        <span className={`${p}-action-icon`}>
          {busy ? <LoaderCircle size={12} className="animate-spin" aria-label={label} /> : <Icon size={12} />}
        </span>
      </Button>
    </WithHoverTooltip>
  );
}

export interface StreamRowProps<I extends StreamItem = StreamItem, T extends StreamItem = StreamTrack> {
  item: I;
  list: I[];
  index: number;
  player: StreamPlayer<T>;
  pending: boolean;
  failed: boolean;
  onChoose: (item: I, list: I[]) => void;
}

/* Lo mínimo que la lista necesita de una fuente: StreamSource lo satisface
   estructuralmente; Audius aporta uno propio sin strings/branding. */
export interface StreamListSource<I extends StreamItem, T extends StreamItem = StreamTrack> {
  id: string;
  keyMissing?: () => boolean;
  listIsQueue?: boolean;
  browse: (signal?: AbortSignal) => Promise<I[]>;
  search: (query: string, signal?: AbortSignal) => Promise<I[]>;
  resolve: (item: I, list: readonly I[], signal?: AbortSignal) => Promise<StreamResolve<T>>;
}

interface ItemListState<I extends StreamItem> {
  data: I[];
  isFetching: boolean;
  isError: boolean;
}

export function useStreamItemSearch<I extends StreamItem>(
  query: string,
  blocked: boolean,
  source: Pick<StreamListSource<I>, 'browse' | 'search'>,
): ItemListState<I> {
  const [state, setState] = useState<ItemListState<I>>({ data: [], isFetching: !blocked, isError: false });
  useEffect(() => {
    if (blocked) {
      setState({ data: [], isFetching: false, isError: false });
      return;
    }
    const ctrl = new AbortController();
    setState((prev) => ({ ...prev, isFetching: true, isError: false }));
    void (query ? source.search(query, ctrl.signal) : source.browse(ctrl.signal))
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ data, isFetching: false, isError: false });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ data: [], isFetching: false, isError: true });
      });
    return () => ctrl.abort();
  }, [query, blocked, source]);
  return state;
}

interface StreamSearchBoxProps {
  p: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  pending?: boolean;
  pendingLabel?: string;
  /** Radio/Audius/Spotify exponen data-filled en la caja de búsqueda. */
  dataFilled?: boolean;
  /** Jamendo envuelve el input en una caja -search-field; Archive no. */
  fieldWrap?: boolean;
}

export function StreamSearchBox({
  p,
  value,
  onChange,
  label,
  pending = false,
  pendingLabel,
  dataFilled = false,
  fieldWrap = false,
}: StreamSearchBoxProps) {
  const controls = (
    <>
      <Search size={12} aria-hidden={true} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
      />
      {pending ? (
        <span className={`${p}-search-loader`}>
          <LoaderCircle size={12} className="animate-spin" aria-label={pendingLabel} />
        </span>
      ) : null}
    </>
  );
  return (
    <div
      className={`${p}-search`}
      {...(dataFilled ? { 'data-filled': Boolean(value) } : {})}
    >
      {fieldWrap ? <div className={`${p}-search-field`}>{controls}</div> : controls}
    </div>
  );
}

interface StreamItemListProps<I extends StreamItem, T extends StreamItem = StreamTrack> {
  player: StreamPlayer<T>;
  source: StreamListSource<I, T>;
  t: StreamListStrings;
  Row: ComponentType<StreamRowProps<I, T>>;
  /** Jamendo/Audius muestran el título de la sección sobre la lista. */
  listLabel?: boolean;
  /** Jamendo envuelve el input en una caja -search-field; Archive no. */
  fieldWrap?: boolean;
  /** Audius expone data-filled en la caja de búsqueda. */
  dataFilled?: boolean;
  /** Audius usa "Buscando" como aria-label de la lista con texto. */
  listSearchLabel?: string;
}

export function StreamItemList<I extends StreamItem, T extends StreamItem = StreamTrack>({
  player,
  source,
  t,
  Row,
  listLabel,
  fieldWrap,
  dataFilled,
  listSearchLabel,
}: StreamItemListProps<I, T>) {
  const p = `antares-${source.id}`;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const text = search.trim();
  const listRef = useRef<HTMLDivElement>(null);
  const blocked = source.keyMissing?.() === true;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [text]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text), 350);
    return () => window.clearTimeout(timer);
  }, [text]);

  const result = useStreamItemSearch<I>(query, blocked, source);
  const pending = result.isFetching || text !== query;

  useEffect(() => {
    if (source.listIsQueue) player.queue.set(result.data as unknown as T[]);
  }, [player, source, result.data]);

  async function choose(item: I, list: I[]) {
    const current = player.track.get();
    if (current && (current.id === item.id || (current as StreamItem & { itemId?: string }).itemId === item.id)) {
      player.toggle();
      return;
    }
    setPendingId(item.id);
    setFailedId(null);
    try {
      const { tracks, index } = await source.resolve(item, list);
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
      <div className={`${p}-error`} role="status">
        {t.keyHint ?? t.searchError}
      </div>
    );
  }

  return (
    <div>
      <StreamSearchBox
        p={p}
        value={search}
        onChange={setSearch}
        label={t.search}
        pending={pending}
        pendingLabel={t.searching}
        dataFilled={dataFilled}
        fieldWrap={fieldWrap}
      />
      {listLabel && <div className={`${p}-list-label`}>{text ? t.results : t.trending}</div>}
      <div
        ref={listRef}
        className={`${p}-list`}
        aria-label={text ? (listSearchLabel ?? t.results) : t.trending}
      >
        {result.data.map((item, index) => (
          <Row
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
          <div className={`${p}-error`} role="status">
            {t.searchError}
          </div>
        )}
        {!pending && !result.isError && result.data.length === 0 && (
          <div className={`${p}-error`} role="status">
            {text ? t.noResults : t.empty}
          </div>
        )}
      </div>
    </div>
  );
}

export function StreamTransport({ player, source, t }: { player: StreamPlayer; source: StreamSource; t: StreamTransportStrings }) {
  const p = `antares-${source.id}`;
  const track = useValue(player.track);
  const status = useValue(player.status);
  const volume = useValue(player.volume);
  const active = status === 'live' || status === 'connecting';

  return (
    <div className={`${p}-foot`}>
      <div className={`${p}-now`} role="status">
        {track ? (
          <>
            <span className={`${p}-live`} aria-hidden={true} />
            <span className={`${p}-now-text`}>
              {track.artist ? `${track.artist} — ` : ''}
              {track.title}
            </span>
            <WithHoverTooltip label={t.open} placement="top">
              <a
                href={track.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t.open}
                className={`${p}-open`}
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
          <span className={`${p}-now-text`}>{t.empty}</span>
        )}
        {status === 'error' && (
          <span className={`${p}-error`} role="status">
            {t.error}
          </span>
        )}
      </div>
      <div className={`${p}-transport`}>
        <StreamAction p={p} label={t.previous} icon={SkipBack} onClick={player.previous} />
        <StreamAction
          p={p}
          label={active ? t.pause : t.play}
          icon={active ? Pause : Play}
          busy={status === 'connecting'}
          className={`${p}-play`}
          onClick={player.toggle}
        />
        <StreamAction p={p} label={t.next} icon={SkipForward} onClick={player.next} />
        <span className={`${p}-transport-space`} />
        <StreamAction
          p={p}
          label={volume ? t.mute : t.unmute}
          icon={volume ? Volume2 : VolumeX}
          onClick={player.mute}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          aria-label={t.volume}
          onChange={(event) => player.setVolume(Number(event.target.value))}
        />
      </div>
    </div>
  );
}

export function useDisposablePlayer<T extends { dispose(): void }>(create: () => T): T | null {
  const [player, setPlayer] = useState<T | null>(null);

  useEffect(() => {
    const created = create();
    setPlayer(created);
    return () => created.dispose();
  }, [create]);

  return player;
}

export function useStreamPlayer(source: StreamSource): StreamPlayer | null {
  return useDisposablePlayer(useCallback(() => createStreamPlayer(source.id), [source]));
}
