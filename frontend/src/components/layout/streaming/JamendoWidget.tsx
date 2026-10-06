import {
  AlertCircle,
  LoaderCircle,
  Pause,
  Play,
  SkipForward,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import { useValue } from '../radio/core';
import { jamendoSource } from './jamendo';
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
import './jamendo.css';

const T = {
  ...STREAM_STRINGS,
  ...jamendoSource.strings,
};

function fmtDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function ItemRow({ item, list, player, pending, failed, onChoose }: StreamRowProps) {
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
          style={streamPanelStyle(popover.position, 292)}
        >
          <StreamItemList player={player} source={jamendoSource} t={T} Row={ItemRow} listLabel fieldWrap />
          <StreamTransport player={player} source={jamendoSource} t={T} />
        </div>
      )}
      <StreamAction
        p="antares-jamendo"
        label={active ? T.pause : T.play}
        icon={active ? Pause : Play}
        busy={status === 'connecting'}
        onClick={player.toggle}
      />
      <StreamAction p="antares-jamendo" label={T.next} icon={SkipForward} onClick={player.next} />
    </div>
  );
}

export default function JamendoWidget() {
  const player = useStreamPlayer(jamendoSource);
  if (!player) return null;
  return <JamendoBar player={player} />;
}
