import {
  AlertCircle,
  ExternalLink,
  Pause,
  Play,
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
import {
  StreamAction,
  StreamItemList,
  streamPanelStyle,
  useDisposablePlayer,
  type StreamListSource,
  type StreamRowProps,
} from '../streaming/StreamWidget';
import './audius.css';

const audiusList: StreamListSource<AudiusTrack, AudiusTrack> = {
  id: 'audius',
  listIsQueue: true,
  browse: fetchTrending,
  search: searchTracks,
  resolve: (item, list) =>
    Promise.resolve({ tracks: [...list], index: Math.max(0, list.indexOf(item)) }),
};

function _fmtDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function TrackRow({ item: track, list, player, index, onChoose }: StreamRowProps<AudiusTrack, AudiusTrack>) {
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
        onClick={() => onChoose(track, list)}
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
        <StreamAction p="antares-audius" label={T.previous} icon={SkipBack} onClick={player.previous} />
        <StreamAction
          p="antares-audius"
          label={active ? T.pause : T.play}
          icon={active ? Pause : Play}
          busy={status === 'connecting'}
          className="antares-audius-play"
          onClick={player.toggle}
        />
        <StreamAction p="antares-audius" label={T.next} icon={SkipForward} onClick={player.next} />
        <span className="antares-audius-transport-space" />
        <StreamAction
          p="antares-audius"
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
          style={streamPanelStyle(popover.position, 292)}
        >
          <StreamItemList
            player={player}
            source={audiusList}
            t={T}
            Row={TrackRow}
            listLabel
            fieldWrap
            dataFilled
            listSearchLabel={T.searching}
          />
          <Transport player={player} />
        </div>
      )}
      <StreamAction
        p="antares-audius"
        label={active ? T.pause : T.play}
        icon={active ? Pause : Play}
        busy={status === 'connecting'}
        className="antares-audius-play"
        onClick={player.toggle}
      />
      <StreamAction p="antares-audius" label={T.next} icon={SkipForward} onClick={player.next} />
    </div>
  );
}

export default function AudiusWidget() {
  const player = useDisposablePlayer(createAudiusPlayer);
  if (!player) return null;
  return <AudiusBar player={player} />;
}
