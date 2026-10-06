import {
  AlertCircle,
  Landmark,
  LoaderCircle,
  Pause,
  Play,
  SkipForward,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import { useValue } from '../radio/core';
import { archiveSource } from './archive';
import type { StreamPlayer } from './player';
import {
  STREAM_STRINGS,
  StreamAction,
  StreamItemList,
  StreamTransport,
  streamPanelStyle,
  useStreamPlayer,
  type StreamRowProps,
} from './StreamWidget';
import './archive.css';

const T = {
  ...STREAM_STRINGS,
  ...archiveSource.strings,
};

function ItemRow({ item, list, index, player, pending, failed, onChoose }: StreamRowProps) {
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
        <StreamAction
          p="antares-archive"
          label={active ? T.pause : T.play}
          icon={active ? Pause : Play}
          busy={status === 'connecting'}
          onClick={player.toggle}
        />
        <StreamAction p="antares-archive" label={T.next} icon={SkipForward} onClick={player.next} />
      </div>
      {popover.isOpen && (
        <div
          ref={popover.popupRef}
          data-archive-status={status}
          className="antares-archive-panel rounded-sm border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl"
          role="dialog"
          aria-label={archiveSource.name}
          style={streamPanelStyle(popover.position, 300)}
        >
          <div className="antares-archive-head">
            <span className="antares-archive-title">Archive</span>
            <span className="antares-archive-sub">Audio libre</span>
          </div>
          <StreamItemList player={player} source={archiveSource} t={T} Row={ItemRow} />
          <StreamTransport player={player} source={archiveSource} t={T} />
        </div>
      )}
    </div>
  );
}

export default function ArchiveWidget() {
  const player = useStreamPlayer(archiveSource);
  if (!player) return null;
  return <ArchiveBar player={player} />;
}
