import { AlertCircle, Pause, Play } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import {
  T,
  fetchTrending,
  searchTracks,
  useValue,
  type AudiusTrack,
} from './core';
import { createAudiusPlayer, type AudiusPlayer } from './player';
import {
  formatTrackDuration,
  NowPlayingRow,
  StreamBarActions,
  StreamControlsRow,
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
              <span className="antares-audius-row-duration">{formatTrackDuration(track.duration)}</span>
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

  return (
    <div>
      <NowPlayingRow
        p="antares-audius"
        track={track}
        status={status}
        t={T}
        liveMarker={
          <span className="antares-audius-eq" aria-hidden={true}>
            <i />
            <i />
            <i />
          </span>
        }
      />
      <StreamControlsRow
        p="antares-audius"
        player={player}
        t={T}
        volume={volume}
        active={status === 'live' || status === 'connecting'}
        connecting={status === 'connecting'}
      />
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
      <StreamBarActions p="antares-audius" status={status} player={player} t={T} playClassName="antares-audius-play" />
    </div>
  );
}

export default function AudiusWidget() {
  const player = useDisposablePlayer(createAudiusPlayer);
  if (!player) return null;
  return <AudiusBar player={player} />;
}
