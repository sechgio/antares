import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ThemedSelect from '../ui/ThemedSelect';
import type { PositionAssignmentMode, StampPosition, StampRect } from './utils';
import { MAX_STAMP_POSITIONS_LIMIT } from './utils';
import Button from '@/components/ui/Button';

interface PositionPanelProps {
  positions: StampPosition[];
  activeIndex: number;
  stampCount: number;
  slotIndices: number[];
  assignmentMode: PositionAssignmentMode;
  onSelectPosition: (index: number) => void;
  onAddPosition: () => void;
  onRemovePosition: (index: number) => void;
  onAssignmentModeChange: (mode: PositionAssignmentMode) => void;
  onSlotChange: (stampIndex: number, positionIndex: number) => void;
  onRectChange: (index: number, rect: StampRect) => void;
}

const RECT_FIELDS = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'Ancho' },
  { key: 'height', label: 'Alto' },
] as const;

// El rect llega limitado y redondeado desde el padre: mientras se teclea se
// muestra el borrador, o cada pulsación intermedia (p. ej. "5" camino a "50")
// se reescribiría con el valor limitado.
function RectField({
  label,
  ariaLabel,
  value,
  onCommit,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
      <span className="w-10 shrink-0 text-[var(--text-muted)]">{label}</span>
      <input
        type="number"
        value={draft ?? Math.round(value)}
        min={0}
        step={1}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(next)) onCommit(next);
        }}
        onBlur={() => setDraft(null)}
        aria-label={ariaLabel}
        className="w-full min-w-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
      />
    </label>
  );
}

export default function PositionPanel({
  positions,
  activeIndex,
  stampCount,
  slotIndices,
  assignmentMode,
  onSelectPosition,
  onAddPosition,
  onRemovePosition,
  onAssignmentModeChange,
  onSlotChange,
  onRectChange,
}: PositionPanelProps) {
  const canAdd = positions.length < MAX_STAMP_POSITIONS_LIMIT;
  const active = positions[activeIndex] ?? positions[0] ?? null;

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
          Posiciones del sello
        </span>
        <Button variant="none" size="none"
          disabled={!canAdd}
          onClick={onAddPosition}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-medium)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30"
        >
          <Plus size={11} />
          Añadir
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {positions.map((pos, index) => (
          <Button variant="none" size="none"
            key={pos.id}
            onClick={() => onSelectPosition(index)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-mono transition-colors ${
              index === activeIndex
                ? 'border-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)]'
                : 'border-[var(--border-medium)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {pos.name}
            {positions.length > 1 ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemovePosition(index);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemovePosition(index);
                  }
                }}
                className="rounded-full p-0.5 hover:bg-[color:color-mix(in_srgb,var(--accent-red)_20%,transparent)] hover:text-[var(--accent-red)]"
                aria-label={`Eliminar ${pos.name}`}
              >
                <Trash2 size={10} />
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      {active ? (
        <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
            {active.name} (pt)
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {RECT_FIELDS.map((field) => (
              <RectField
                key={field.key}
                label={field.label}
                ariaLabel={`${active.name}: ${field.label} en puntos`}
                value={active.rect[field.key]}
                onCommit={(value) => onRectChange(activeIndex, { ...active.rect, [field.key]: value })}
              />
            ))}
          </div>
        </div>
      ) : null}

      {positions.length > 1 ? (
        <div className="space-y-2 border-t border-[var(--border-subtle)] pt-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Asignación
          </span>
          <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <input
              type="radio"
              name="assignment-mode"
              checked={assignmentMode === 'cycle'}
              onChange={() => onAssignmentModeChange('cycle')}
            />
            Rotar posiciones (1→2→3…)
          </label>
          <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <input
              type="radio"
              name="assignment-mode"
              checked={assignmentMode === 'manual'}
              onChange={() => onAssignmentModeChange('manual')}
            />
            Elegir por cada sello
          </label>
          {assignmentMode === 'manual' ? (
            <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
              {Array.from({ length: stampCount }, (_, stampIndex) => (
                <label key={stampIndex} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-[var(--text-muted)]">Sello {stampIndex + 1}</span>
                  <ThemedSelect
                    value={String(slotIndices[stampIndex] ?? 0)}
                    onChange={(value) => onSlotChange(stampIndex, Number(value))}
                    options={positions.map((pos, posIndex) => ({ value: String(posIndex), label: pos.name }))}
                    aria-label={`Posición del sello ${stampIndex + 1}`}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
