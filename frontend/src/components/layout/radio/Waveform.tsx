import { useEffect, useRef, type CSSProperties } from 'react';
import { createBudgetedLoop, useValue } from './core';
import type { RadioPlayer } from './player';

function brailleTrace(samples: number[], rows = 2): string[] {
  const width = samples.length / 2;
  const cells = new Array<number>(width * rows).fill(0);
  const dots = [
    [1, 2, 4, 64],
    [8, 16, 32, 128],
  ];
  const center = (rows * 4 - 1) / 2;
  const row = (value: number) =>
    Math.max(0, Math.min(rows * 4 - 1, Math.round(center - value * center)));
  let previous = row(samples[0] ?? 0);
  samples.forEach((value, x) => {
    const y = row(value);
    for (let point = Math.min(previous, y); point <= Math.max(previous, y); point++) {
      cells[Math.floor(point / 4) * width + Math.floor(x / 2)] |= dots[x % 2][point % 4];
    }
    previous = y;
  });
  return cells.map((cell) => String.fromCharCode(0x2800 | cell));
}

export function Waveform({
  player,
  compact = false,
}: {
  player: RadioPlayer;
  compact?: boolean;
}) {
  const width = compact ? 6 : 36;
  const rows = compact ? 1 : 2;
  const ref = useRef<HTMLDivElement>(null);
  const status = useValue(player.status);
  const mode = useValue(player.meterMode);
  const station = useValue(player.station);
  const active = status === 'live';
  const baseline = brailleTrace(new Array<number>(width * 2).fill(0), rows);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const blank = new Array<string>(width * rows).fill('⠀');
    const flat = brailleTrace(new Array<number>(width * 2).fill(0), rows);
    const layers = [...node.children] as HTMLElement[];
    const paint = (layer: number, cells: string[]) =>
      cells.forEach((cell, i) => {
        const target = layers[layer]?.children[i];
        if (target && target.textContent !== cell) target.textContent = cell;
      });
    let history = [blank, blank];
    const reset = () => {
      history = [blank, blank];
      paint(0, blank);
      paint(1, blank);
      paint(2, flat);
    };
    reset();
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let step = 0;
    const loop = createBudgetedLoop(
      () => {
        if (!active || motion.matches) return;
        if (mode === 'activity') {
          const cells = [...blank];
          cells[Math.floor(step++ / 2) % width] = '⠤';
          paint(0, blank);
          paint(1, blank);
          paint(2, cells);
        } else {
          const cells = brailleTrace(player.waveform(width * 2), rows);
          paint(0, history[0]);
          paint(1, history[1]);
          paint(2, cells);
          history = [history[1], cells];
        }
      },
      { fps: 12, idleWhen: () => !active || motion.matches },
    );
    const updateMotion = () => {
      reset();
      loop.wake();
    };
    motion.addEventListener('change', updateMotion);
    return () => {
      loop.dispose();
      motion.removeEventListener('change', updateMotion);
    };
  }, [active, mode, player, rows, width, station.url]);

  return (
    <div
      ref={ref}
      className="antares-radio-waveform"
      style={{ '--radio-columns': width } as CSSProperties}
      data-radio-meter={width}
      data-compact={compact}
      data-meter-mode={mode}
      data-active={active}
      aria-hidden={true}
    >
      {[0, 1, 2].map((layer) => (
        <span key={layer} className="antares-radio-waveform-layer">
          {baseline.map((cell, i) => (
            <span key={i}>{layer === 2 ? cell : '⠀'}</span>
          ))}
        </span>
      ))}
    </div>
  );
}
