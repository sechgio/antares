import { useCallback, useEffect, useState, type CSSProperties, type ComponentType } from 'react';
import {
  Check,
  ExternalLink,
  Heart,
  ListMusic,
  LoaderCircle,
  MonitorSpeaker,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import { api } from '../../../api';
import { errorMessage } from '@/utils/errors';
import {
  T,
  createSpotifyController,
  useValue,
  openExternal,
  type DeviceLite,
  type PlaybackSnapshot,
  type SpotifyController,
  type TrackLite,
} from './core';
import './spotify.css';

interface SmallActionProps {
  label: string;
  icon: ComponentType<{ size?: number; style?: CSSProperties }>;
  onClick: () => void;
  pressed?: boolean;
  className?: string;
  wrapClassName?: string;
  busy?: boolean;
}

function SmallAction({ label, icon: Icon, onClick, pressed, className, wrapClassName, busy = false }: SmallActionProps) {
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

function _fmtMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function NowPlaying({ playback }: { playback: PlaybackSnapshot }) {
  const [, setTick] = useState(0);
  const playing = playback.is_playing && !playback.empty;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [playing]);

  if (playback.empty || !playback.track) {
    return (
      <div className="antares-spotify-now" role="status">
        <Music size={12} aria-hidden={true} />
        <span className="antares-spotify-now-text">{T.noActive}</span>
        <span className="antares-spotify-now-hint">{T.openSpotifyHint}</span>
      </div>
    );
  }

  const elapsed = playing ? Date.now() - playback.fetched_at : 0;
  const progress = Math.min(
    playback.duration_ms || 1,
    (playback.progress_ms ?? 0) + (playing ? Math.max(0, elapsed) : 0),
  );
  const duration = playback.duration_ms || playback.track.duration_ms || 0;
  const fraction = duration > 0 ? Math.min(1, progress / duration) : 0;

  return (
    <div className="antares-spotify-now" data-live={playing} role="status">
      <div className="antares-spotify-track">
        <span className="antares-spotify-track-name" title={playback.track.name}>
          {playback.track.name}
        </span>
        <span className="antares-spotify-track-meta" title={playback.track.artists}>
          {playback.track.artists}
          {playback.track.album ? ` · ${playback.track.album}` : ''}
        </span>
      </div>
      <div className="antares-spotify-progress">
        <span className="antares-spotify-time">{_fmtMs(progress)}</span>
        <div className="antares-spotify-progress-bar">
          <div style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
        </div>
        <span className="antares-spotify-time">{_fmtMs(duration)}</span>
      </div>
      {playback.device && (
        <div className="antares-spotify-device" title={playback.device.type || ''}>
          <MonitorSpeaker size={10} aria-hidden={true} />
          <span>{playback.device.name}</span>
        </div>
      )}
    </div>
  );
}

function Transport({ controller }: { controller: SpotifyController }) {
  const playback = useValue(controller.playback);
  const busy = useValue(controller.busy);
  const playing = playback.is_playing && !playback.empty;
  const repeatState = playback.repeat_state || 'off';
  const RepeatIcon = repeatState === 'track' ? Repeat1 : Repeat;
  const repeatLabel =
    repeatState === 'track' ? T.repeatTrack : repeatState === 'context' ? T.repeatContext : T.repeatOff;
  const volume = playback.device?.volume_percent ?? 50;

  return (
    <div className="antares-radio-volume">
      <SmallAction
        label={playback.shuffle_state === true ? T.shuffleOn : T.shuffleOff}
        icon={Shuffle}
        pressed={playback.shuffle_state === true}
        onClick={() => void controller.setShuffle(!(playback.shuffle_state === true))}
      />
      <SmallAction label={T.previous} icon={SkipBack} onClick={() => void controller.previous()} />
      <SmallAction
        label={playing ? T.pause : T.play}
        icon={playing ? Pause : Play}
        busy={busy}
        onClick={() => void controller.toggle()}
      />
      <SmallAction label={T.next} icon={SkipForward} onClick={() => void controller.next()} />
      <SmallAction
        label={repeatLabel}
        icon={RepeatIcon}
        pressed={repeatState !== 'off'}
        onClick={() => void controller.cycleRepeat()}
      />
      <span className="antares-radio-volume-space" />
      <Volume2 size={12} aria-hidden={true} />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={volume}
        aria-label={T.volume}
        onChange={(event) => void controller.setVolume(Number(event.target.value))}
      />
    </div>
  );
}

function SearchResults({ controller, query }: { controller: SpotifyController; query: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setData(null);
      setPending(false);
      return;
    }
    let cancelled = false;
    setPending(true);
    const id = window.setTimeout(async () => {
      try {
        const result = await api.spotifySearch({ query: text, types: ['track', 'album', 'playlist'], limit: 10 });
        if (!cancelled) {
          setData(result);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setPending(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query]);

  const tracks = ((data?.tracks as { items?: unknown[] } | undefined)?.items || []) as Array<{
    id?: string; uri?: string; name?: string; artists?: Array<{ name?: string }>; album?: { name?: string };
  }>;
  const albums = ((data?.albums as { items?: unknown[] } | undefined)?.items || []) as Array<{
    uri?: string; name?: string; artists?: Array<{ name?: string }>;
  }>;
  const playlists = ((data?.playlists as { items?: unknown[] } | undefined)?.items || []) as Array<{
    uri?: string; name?: string; owner?: { display_name?: string };
  }>;

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(''), 1600);
  };

  const addToQueue = async (uri: string) => {
    try {
      await api.spotifyQueue({ action: 'add', uri });
      flash(T.queueAdded);
    } catch (err) {
      flash(errorMessage(err, T.searchError));
    }
  };

  const saveTrack = async (uri: string) => {
    try {
      await api.spotifyLibrary({ kind: 'tracks', action: 'save', uris: [uri] });
      flash(T.savedToLibrary);
    } catch (err) {
      flash(errorMessage(err, T.searchError));
    }
  };

  if (query.trim().length < 2) return null;
  if (failed) return <div className="antares-radio-error" role="status">{T.searchError}</div>;
  if (pending && !data) {
    return (
      <div className="antares-radio-error" role="status">
        <LoaderCircle size={12} className="animate-spin" aria-label={T.searching} />
      </div>
    );
  }
  if (!tracks.length && !albums.length && !playlists.length) {
    return <div className="antares-radio-error" role="status">{T.noResults}</div>;
  }

  return (
    <div className="antares-spotify-results">
      {tracks.slice(0, 8).map((track, i) => (
        <div key={track.uri || `t${i}`} className="antares-radio-row">
          <Button
            variant="none"
            size="none"
            className="antares-radio-row-main"
            aria-label={`${T.play}: ${track.name}`}
            onClick={() => track.uri && void controller.playUris([track.uri])}
          >
            <span className="antares-radio-row-icon"><Play size={12} /></span>
            <span className="antares-radio-row-copy">
              <span className="antares-radio-row-name">{track.name}</span>
              <span className="antares-spotify-row-meta">
                {(track.artists || []).map((a) => a?.name).filter(Boolean).join(', ')}
                {track.album?.name ? ` · ${track.album.name}` : ''}
              </span>
            </span>
          </Button>
          <SmallAction label={T.queueAdd} icon={Plus} wrapClassName="antares-radio-pin" onClick={() => track.uri && void addToQueue(track.uri)} />
          <SmallAction label={T.saveToLibrary} icon={Heart} wrapClassName="antares-radio-pin" onClick={() => track.uri && void saveTrack(track.uri)} />
        </div>
      ))}
      {([
        ...albums.map((a) => ({ uri: a.uri, name: a.name, kind: 'álbum', sub: (a.artists || []).map((x) => x?.name).filter(Boolean).join(', ') })),
        ...playlists.map((p) => ({ uri: p.uri, name: p.name, kind: 'playlist', sub: p.owner?.display_name || '' })),
      ]).map((item, i) => (
        <div key={item.uri || `c${i}`} className="antares-radio-row">
          <Button
            variant="none"
            size="none"
            className="antares-radio-row-main"
            aria-label={`${T.playContext}: ${item.name}`}
            onClick={() => item.uri && void controller.playContext(item.uri)}
          >
            <span className="antares-radio-row-icon"><Play size={12} /></span>
            <span className="antares-radio-row-copy">
              <span className="antares-radio-row-name">{item.name}</span>
              <span className="antares-spotify-row-meta">
                {item.kind}{item.sub ? ` · ${item.sub}` : ''}
              </span>
            </span>
          </Button>
        </div>
      ))}
      {notice && <div className="antares-spotify-notice" role="status">{notice}</div>}
    </div>
  );
}

function PlaylistsTab({ controller }: { controller: SpotifyController }) {
  const [items, setItems] = useState<Array<{ id?: string; uri?: string; name?: string; tracks?: { total?: number }; owner?: { display_name?: string } }>>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.spotifyPlaylists({ action: 'list', limit: 50 });
      setItems((((data as { items?: unknown[] }).items) || []) as typeof items);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <div className="antares-radio-error" role="status">{T.searchError}</div>;
  if (!items.length) return <div className="antares-radio-error" role="status">{T.emptyList}</div>;

  return (
    <div className="antares-radio-list antares-spotify-list">
      {items.map((pl, i) => (
        <div key={pl.id || pl.uri || `pl${i}`} className="antares-radio-row">
          <Button
            variant="none"
            size="none"
            className="antares-radio-row-main"
            aria-label={`${T.playContext}: ${pl.name}`}
            onClick={() => pl.uri && void controller.playContext(pl.uri)}
          >
            <span className="antares-radio-row-icon"><ListMusic size={12} /></span>
            <span className="antares-radio-row-copy">
              <span className="antares-radio-row-name">{pl.name}</span>
              <span className="antares-spotify-row-meta">
                {pl.tracks?.total ?? 0} {pl.owner?.display_name ? `· ${pl.owner.display_name}` : ''}
              </span>
            </span>
          </Button>
        </div>
      ))}
    </div>
  );
}

function QueueTab() {
  const [current, setCurrent] = useState<TrackLite | null>(null);
  const [items, setItems] = useState<TrackLite[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = (await api.spotifyQueue({ action: 'get' })) as {
          currently_playing?: { name?: string; artists?: Array<{ name?: string }>; uri?: string; album?: { name?: string } };
          queue?: Array<{ name?: string; artists?: Array<{ name?: string }>; uri?: string; album?: { name?: string } }>;
        };
        if (cancelled) return;
        const lite = (t?: { name?: string; artists?: Array<{ name?: string }>; uri?: string; album?: { name?: string } }): TrackLite | null =>
          t?.name
            ? { name: t.name, uri: t.uri, artists: (t.artists || []).map((a) => a?.name).filter(Boolean).join(', '), album: t.album?.name || '' }
            : null;
        setCurrent(lite(data.currently_playing));
        setItems((data.queue || []).map(lite).filter((t): t is TrackLite => t !== null).slice(0, 20));
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <div className="antares-radio-error" role="status">{T.searchError}</div>;
  if (!current && !items.length) return <div className="antares-radio-error" role="status">{T.emptyQueue}</div>;

  return (
    <div className="antares-radio-list antares-spotify-list">
      {current && (
        <div className="antares-radio-row" data-current={true}>
          <div className="antares-radio-row-main" aria-current="true">
            <span className="antares-radio-row-icon"><Music size={12} /></span>
            <span className="antares-radio-row-copy">
              <span className="antares-radio-row-name">{current.name}</span>
              <span className="antares-spotify-row-meta">{current.artists}</span>
            </span>
          </div>
        </div>
      )}
      {items.map((t, i) => (
        <div key={`${t.uri || 'q'}${i}`} className="antares-radio-row">
          <div className="antares-radio-row-main">
            <span className="antares-radio-row-icon"><Play size={12} /></span>
            <span className="antares-radio-row-copy">
              <span className="antares-radio-row-name">{t.name}</span>
              <span className="antares-spotify-row-meta">{t.artists}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SavedTab({ controller }: { controller: SpotifyController }) {
  const [items, setItems] = useState<Array<{ added_at?: string; track?: { id?: string; uri?: string; name?: string; artists?: Array<{ name?: string }>; album?: { name?: string } } }>>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = (await api.spotifyLibrary({ kind: 'tracks', action: 'list', limit: 50 })) as { items?: typeof items };
        if (!cancelled) {
          setItems(data.items || []);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const remove = async (id?: string) => {
    if (!id) return;
    try {
      await api.spotifyLibrary({ kind: 'tracks', action: 'remove', ids: [id] });
      setReloadKey((k) => k + 1);
    } catch {
    }
  };

  if (failed) return <div className="antares-radio-error" role="status">{T.searchError}</div>;
  if (!items.length) return <div className="antares-radio-error" role="status">{T.emptyList}</div>;

  return (
    <div className="antares-radio-list antares-spotify-list">
      {items.map((entry, i) => {
        const track = entry.track;
        if (!track?.name) return null;
        return (
          <div key={track.id || track.uri || `s${i}`} className="antares-radio-row">
            <Button
              variant="none"
              size="none"
              className="antares-radio-row-main"
              aria-label={`${T.play}: ${track.name}`}
              onClick={() => track.uri && void controller.playUris([track.uri])}
            >
              <span className="antares-radio-row-icon"><Play size={12} /></span>
              <span className="antares-radio-row-copy">
                <span className="antares-radio-row-name">{track.name}</span>
                <span className="antares-spotify-row-meta">
                  {(track.artists || []).map((a) => a?.name).filter(Boolean).join(', ')}
                </span>
              </span>
            </Button>
            <SmallAction label={T.removeFromLibrary} icon={Heart} wrapClassName="antares-radio-pin" className="antares-spotify-liked" onClick={() => void remove(track.id)} />
          </div>
        );
      })}
    </div>
  );
}

function DevicesTab({ controller }: { controller: SpotifyController }) {
  const [items, setItems] = useState<DeviceLite[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = (await api.spotifyDevices({ action: 'list' })) as { devices?: DeviceLite[] };
      setItems(data.devices || []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <div className="antares-radio-error" role="status">{T.searchError}</div>;
  if (!items.length) return <div className="antares-radio-error" role="status">{T.emptyList}</div>;

  return (
    <div className="antares-radio-list antares-spotify-list">
      {items.map((device, i) => (
        <div key={device.id || `d${i}`} className="antares-radio-row" data-current={device.is_active === true}>
          <Button
            variant="none"
            size="none"
            className="antares-radio-row-main"
            aria-label={`${T.transferTo}: ${device.name}`}
            onClick={() => device.id && void controller.transfer(device.id)}
          >
            <span className="antares-radio-row-icon"><MonitorSpeaker size={12} /></span>
            <span className="antares-radio-row-copy">
              <span className="antares-radio-row-name">{device.name}</span>
              <span className="antares-spotify-row-meta">
                {device.type || ''}{device.is_active ? ` · ${T.configured}` : ''}
              </span>
            </span>
          </Button>
          {device.is_active === true && (
            <span className="antares-spotify-active" aria-label={T.configured}><Check size={12} /></span>
          )}
        </div>
      ))}
      <div className="antares-spotify-refresh">
        <Button variant="none" size="none" className="antares-spotify-link" onClick={() => void load()}>
          {T.refresh}
        </Button>
      </div>
    </div>
  );
}

const _TABS = ['search', 'playlists', 'queue', 'saved', 'devices'] as const;
type TabId = (typeof _TABS)[number];
const TAB_LABELS: Record<TabId, string> = {
  search: T.searchTab,
  playlists: T.playlists,
  queue: T.queue,
  saved: T.saved,
  devices: T.devices,
};

function ReadyPanel({ controller }: { controller: SpotifyController }) {
  const playback = useValue(controller.playback);
  const account = useValue(controller.account);
  const lastError = useValue(controller.lastError);
  const [tab, setTab] = useState<TabId>('search');
  const [query, setQuery] = useState('');

  return (
    <div>
      <NowPlaying playback={playback} />
      <Transport controller={controller} />
      {account?.product && account.product !== 'premium' && (
        <p className="antares-spotify-hint">{T.premiumHint}</p>
      )}
      <div className="antares-spotify-tabs" role="tablist">
        {_TABS.map((id) => (
          <Button
            key={id}
            variant="none"
            size="none"
            role="tab"
            aria-selected={tab === id}
            className="antares-spotify-tab"
            data-active={tab === id}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </Button>
        ))}
      </div>
      {tab === 'search' && (
        <div>
          <div className="antares-radio-search" data-filled={Boolean(query)}>
            <div className="antares-radio-search-field">
              <Search size={12} aria-hidden={true} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={T.search}
                aria-label={T.search}
              />
            </div>
          </div>
          <SearchResults controller={controller} query={query} />
        </div>
      )}
      {tab === 'playlists' && <PlaylistsTab controller={controller} />}
      {tab === 'queue' && <QueueTab />}
      {tab === 'saved' && <SavedTab controller={controller} />}
      {tab === 'devices' && <DevicesTab controller={controller} />}
      {lastError && (
        <div className="antares-radio-error" role="status">
          {lastError}
        </div>
      )}
      <div className="antares-spotify-footer">
        <span className="antares-spotify-row-meta">
          {account?.display_name || T.account}
        </span>
        <Button variant="none" size="none" className="antares-spotify-link" onClick={() => void controller.disconnect()}>
          {T.disconnect}
        </Button>
      </div>
    </div>
  );
}

function SetupPanel({ controller }: { controller: SpotifyController }) {
  const session = useValue(controller.session);
  const lastError = useValue(controller.lastError);
  const [clientId, setClientId] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [masked, setMasked] = useState('');
  const [editing, setEditing] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [shownRedirect, setShownRedirect] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadedCfg, setLoadedCfg] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await api.spotifyOauthConfigStatus();
        if (!cancelled) setMasked(cfg.client_id_masked || '');
      } catch {
      } finally {
        if (!cancelled) setLoadedCfg(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (session === 'ready') {
      setAwaiting(false);
      setAuthUrl('');
    }
  }, [session]);

  const saveConfig = async () => {
    setBusy(true);
    setError('');
    try {
      await api.spotifyOauthConfigSave(clientId.trim(), redirectUri.trim());
      setClientId('');
      setEditing(false);
      await controller.refreshSession();
      const cfg = await api.spotifyOauthConfigStatus();
      setMasked(cfg.client_id_masked || '');
    } catch (err) {
      setError(errorMessage(err, T.authError));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError('');
    setAuthUrl('');
    try {
      const res = await api.spotifyAuthStart();
      setAuthUrl(res.url);
      setShownRedirect(res.redirect_uri);
      setAwaiting(true);
    } catch (err) {
      setError(errorMessage(err, T.authError));
      setAwaiting(false);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    try {
      await api.spotifyAuthCancel();
    } finally {
      setAwaiting(false);
      setAuthUrl('');
    }
  };

  const configured = session !== 'unconfigured';
  if (!loadedCfg) return null;

  return (
    <div className="antares-spotify-setup">
      <p className="antares-spotify-hint">{T.configHint}</p>
      {configured && !editing ? (
        <div className="antares-spotify-config-row">
          <span className="antares-spotify-config-value" title={masked}>{masked}</span>
          <Button variant="none" size="none" className="antares-spotify-link" onClick={() => setEditing(true)}>
            {T.editConfig}
          </Button>
        </div>
      ) : (
        <div className="antares-spotify-form">
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder={T.configTitle}
            className="antares-spotify-input"
            aria-label={T.configTitle}
          />
          <input
            value={redirectUri}
            onChange={(event) => setRedirectUri(event.target.value)}
            placeholder={`${T.redirectUri}: ${T.redirectUriPlaceholder}`}
            className="antares-spotify-input"
            aria-label={T.redirectUri}
          />
          <Button
            variant="none"
            size="none"
            className="antares-spotify-primary"
            disabled={busy || clientId.trim().length < 10}
            onClick={() => void saveConfig()}
          >
            {busy ? <LoaderCircle size={12} className="animate-spin" /> : T.saveConfig}
          </Button>
        </div>
      )}

      {configured && !editing && !awaiting && (
        <Button
          variant="none"
          size="none"
          className="antares-spotify-primary"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? <LoaderCircle size={12} className="animate-spin" /> : <ExternalLink size={12} />}
          {T.connect}
        </Button>
      )}

      {awaiting && (
        <div className="antares-spotify-awaiting">
          <div className="antares-spotify-awaiting-line">
            <LoaderCircle size={11} className="animate-spin" aria-hidden={true} />
            <span>{T.awaiting}</span>
          </div>
          {shownRedirect && (
            <p className="antares-spotify-hint">
              Redirect URI: <code>{shownRedirect}</code>
            </p>
          )}
          {authUrl && (
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="antares-spotify-link"
              onClick={(event) => {
                event.preventDefault();
                openExternal(authUrl);
              }}
            >
              <ExternalLink size={10} aria-hidden={true} /> {T.connect}
            </a>
          )}
          <Button variant="none" size="none" className="antares-spotify-link" onClick={() => void cancel()}>
            {T.cancelAuth}
          </Button>
        </div>
      )}

      {(error || lastError) && (
        <div className="antares-radio-error" role="status">
          {error || lastError}
        </div>
      )}
    </div>
  );
}

function SpotifyBar({ controller }: { controller: SpotifyController }) {
  const playback = useValue(controller.playback);
  const busy = useValue(controller.busy);
  const session = useValue(controller.session);
  const popover = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    direction: 'down',
    align: 'end',
    estimatedWidth: 300,
    estimatedHeight: 320,
    gap: 6,
  });
  const [browseWidth, setBrowseWidth] = useState<number | null>(null);
  const playing = playback.is_playing && !playback.empty;
  const chipLabel = playback.track ? playback.track.name : T.spotify;

  const onTriggerClick = () => {
    if (!popover.isOpen && popover.triggerRef.current) {
      setBrowseWidth(popover.triggerRef.current.getBoundingClientRect().width);
    }
    popover.toggle();
  };

  const ready = session === 'ready';
  const onAction = (action: () => Promise<void>) => {
    if (ready) void action();
    else popover.open();
  };

  return (
    <div
      className="antares-radio-bar antares-spotify-bar"
      data-spotify-playing={playing}
      data-spotify-ready={ready}
    >
      <Button
        ref={popover.triggerRef}
        variant="none"
        size="none"
        className="antares-radio-browse"
        style={{ width: popover.isOpen && browseWidth ? browseWidth : undefined }}
        aria-label={`${T.browse}: ${chipLabel}`}
        onClick={onTriggerClick}
      >
        <Music size={10} className="antares-spotify-mark" aria-hidden={true} />
        <span className="radio-name">{chipLabel}</span>
      </Button>
      {popover.isOpen && (
        <div
          ref={popover.popupRef}
          className="antares-spotify-panel rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 shadow-xl"
          role="dialog"
          aria-label={T.spotify}
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
          {session === 'ready' ? (
            <ReadyPanel controller={controller} />
          ) : (
            <SetupPanel controller={controller} />
          )}
        </div>
      )}
      <SmallAction
        label={playing ? T.pause : T.play}
        icon={playing ? Pause : Play}
        busy={busy}
        onClick={() => onAction(controller.toggle)}
      />
      <SmallAction label={T.next} icon={SkipForward} onClick={() => onAction(controller.next)} />
    </div>
  );
}

export default function SpotifyWidget() {
  const [controller, setController] = useState<SpotifyController | null>(null);

  useEffect(() => {
    const created = createSpotifyController();
    setController(created);
    return () => created.dispose();
  }, []);

  if (!controller) return null;
  return <SpotifyBar controller={controller} />;
}
