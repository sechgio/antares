import { useCallback } from 'react';
import type { Clip } from '../types';

export function AudioPanel({
  clip,
  onChange,
}: {
  clip: Clip | null;
  onChange: (mutate: (draft: Clip) => void) => void;
}) {
  const audio = clip?.audio;
  const disabled = !clip || !audio;

  const update = useCallback(
    (patch: Partial<NonNullable<Clip['audio']>>) => {
      if (!clip) return;
      onChange((draft) => {
        draft.audio = { ...draft.audio, ...patch };
      });
    },
    [clip, onChange],
  );

  if (disabled) {
    return (
      <div className="p-3 text-xs text-[var(--text-muted)]">
        Selecciona un clip con audio para editar su mezcla.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3" data-testid="audio-panel">
      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={audio.embeddedEnabled}
          onChange={(event) => update({ embeddedEnabled: event.target.checked })}
        />
        Audio embebido
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        Ganancia: {audio.gainDb > 0 ? `+${audio.gainDb}` : audio.gainDb} dB
        <input
          type="range"
          min={-60}
          max={24}
          step={1}
          className="mt-1 w-full"
          value={audio.gainDb}
          onChange={(event) => update({ gainDb: Number(event.target.value) })}
        />
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        Fundido de entrada: {(audio.fadeInUs / 1_000_000).toFixed(1)} s
        <input
          type="range"
          min={0}
          max={3_000_000}
          step={100_000}
          className="mt-1 w-full"
          value={audio.fadeInUs}
          onChange={(event) => update({ fadeInUs: Number(event.target.value) })}
        />
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        Fundido de salida: {(audio.fadeOutUs / 1_000_000).toFixed(1)} s
        <input
          type="range"
          min={0}
          max={3_000_000}
          step={100_000}
          className="mt-1 w-full"
          value={audio.fadeOutUs}
          onChange={(event) => update({ fadeOutUs: Number(event.target.value) })}
        />
      </label>

      {audio.gainDb >= 12 && (
        <p className="text-xs text-[var(--accent-red)]" role="alert">
          Ganancia alta: la mezcla puede saturar. Revisa el medidor.
        </p>
      )}
    </div>
  );
}

export default AudioPanel;
