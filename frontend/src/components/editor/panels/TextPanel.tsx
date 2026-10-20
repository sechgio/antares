import { useCallback } from 'react';
import type { Clip } from '../types';

const FONT_SIZES = [24, 32, 48, 64, 96];
const ALIGNMENTS: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];

export function TextPanel({
  clip,
  onChange,
}: {
  clip: Clip | null;
  onChange: (mutate: (draft: Clip) => void) => void;
}) {
  const text = clip?.text;
  const disabled = !clip || !text;

  const update = useCallback(
    (patch: Partial<NonNullable<Clip['text']>>) => {
      if (!clip) return;
      onChange((draft) => {
        if (!draft.text) return;
        draft.text = { ...draft.text, ...patch };
      });
    },
    [clip, onChange],
  );

  if (disabled) {
    return (
      <div className="p-3 text-xs text-[var(--text-muted)]">
        Selecciona un clip de texto para editar sus propiedades.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3" data-testid="text-panel">
      <label className="block text-xs text-[var(--text-secondary)]">
        Contenido
        <textarea
          className="mt-1 w-full rounded border border-[var(--border-medium)] bg-[var(--bg-base)] p-2 text-xs text-[var(--text-primary)]"
          rows={3}
          value={text.content}
          onChange={(event) => update({ content: event.target.value })}
        />
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        Tamaño
        <select
          className="mt-1 w-full rounded border border-[var(--border-medium)] bg-[var(--bg-base)] p-1 text-xs text-[var(--text-primary)]"
          value={text.fontSizePx}
          onChange={(event) => update({ fontSizePx: Number(event.target.value) })}
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} px
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        Color
        <input
          type="color"
          className="mt-1 h-8 w-full rounded border border-[var(--border-medium)]"
          value={text.color}
          onChange={(event) => update({ color: event.target.value })}
        />
      </label>

      <div className="text-xs text-[var(--text-secondary)]">Alineación</div>
      <div className="flex gap-1">
        {ALIGNMENTS.map((align) => (
          <button
            key={align}
            type="button"
            aria-pressed={text.align === align}
            className={`flex-1 rounded border px-2 py-1 text-xs ${
              text.align === align
                ? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
                : 'border-[var(--border-medium)] text-[var(--text-muted)]'
            }`}
            onClick={() => update({ align })}
          >
            {align}
          </button>
        ))}
      </div>

      <div className="flex gap-3 text-xs text-[var(--text-secondary)]">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={text.style.bold}
            onChange={(event) => update({ style: { ...text.style, bold: event.target.checked } })}
          />
          Negrita
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={text.style.italic}
            onChange={(event) => update({ style: { ...text.style, italic: event.target.checked } })}
          />
          Cursiva
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={text.style.underline}
            onChange={(event) => update({ style: { ...text.style, underline: event.target.checked } })}
          />
          Subrayado
        </label>
      </div>
    </div>
  );
}

export default TextPanel;
