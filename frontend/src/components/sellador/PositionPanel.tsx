import { Plus, Trash2 } from 'lucide-react';
import type { PositionAssignmentMode, StampPosition } from './utils';
import { MAX_STAMP_POSITIONS_LIMIT } from './utils';

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
}: PositionPanelProps) {
  const canAdd = positions.length < MAX_STAMP_POSITIONS_LIMIT;

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
          Posiciones del sello
        </span>
        <button
          type="button"
          disabled={!canAdd}
          onClick={onAddPosition}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-medium)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30"
        >
          <Plus size={11} />
          Añadir
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {positions.map((pos, index) => (
          <button
            key={pos.id}
            type="button"
            onClick={() => onSelectPosition(index)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-mono transition-colors ${
              index === activeIndex
                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
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
                className="rounded-full p-0.5 hover:bg-red-500/20 hover:text-red-400"
                aria-label={`Eliminar ${pos.name}`}
              >
                <Trash2 size={10} />
              </span>
            ) : null}
          </button>
        ))}
      </div>

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
                  <select
                    value={slotIndices[stampIndex] ?? 0}
                    onChange={(e) => onSlotChange(stampIndex, Number(e.target.value))}
                    className="rounded border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 py-0.5 text-[11px]"
                  >
                    {positions.map((pos, posIndex) => (
                      <option key={pos.id} value={posIndex}>{pos.name}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
