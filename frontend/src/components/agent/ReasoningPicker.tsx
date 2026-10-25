import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { AgentReasoningEffort } from '../../api/agentApi';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';

const ORDER: AgentReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const LABELS: Record<AgentReasoningEffort, string> = {
  minimal: 'Mínimo',
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'Extra alto',
};

// Mismo ajuste que el runtime: el nivel elegido o el más cercano por debajo.
function effective(levels: AgentReasoningEffort[], value: AgentReasoningEffort) {
  const below = levels.filter((level) => ORDER.indexOf(level) <= ORDER.indexOf(value));
  return below[below.length - 1] ?? levels[0];
}

export default function ReasoningPicker({ levels, value, onChange, disabled }: {
  levels: AgentReasoningEffort[];
  value: AgentReasoningEffort;
  onChange: (effort: AgentReasoningEffort) => void;
  disabled: boolean;
}) {
  const id = useId();
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    estimatedWidth: 260,
    estimatedHeight: 110,
    direction: 'up',
    align: 'end',
  });
  const { isOpen, close, popupRef } = menu;
  const current = levels.indexOf(effective(levels, value));
  const [index, setIndex] = useState(current);

  useEffect(() => { setIndex(current); }, [current, isOpen]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  useEffect(() => {
    if (isOpen) popupRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [isOpen, popupRef]);

  const commit = () => {
    const next = levels[index];
    if (next && next !== levels[current]) onChange(next);
  };

  return <>
    <Button
      ref={menu.triggerRef}
      variant="none"
      size="none"
      className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
      aria-label={`Razonamiento: ${LABELS[levels[current]]}`}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={isOpen ? id : undefined}
      disabled={disabled}
      title={disabled ? 'Espera a que termine el turno para cambiar el razonamiento' : 'Nivel de razonamiento del modelo'}
      onClick={menu.toggle}
    >
      <span className="truncate">{LABELS[levels[current]]}</span>
      <ChevronDown size={12} className="shrink-0" aria-hidden="true" />
    </Button>
    {isOpen && createPortal(
      <div
        ref={popupRef}
        id={id}
        role="dialog"
        aria-label="Nivel de razonamiento"
        className="fixed z-[300] rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-4 pb-4 pt-3 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
        style={{ top: menu.position?.top ?? -9999, left: menu.position?.left ?? -9999, width: 260, visibility: menu.position ? 'visible' : 'hidden' }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          close();
          menu.triggerRef.current?.focus();
        }}
      >
        <p className="text-center text-[14px] font-medium text-[var(--accent-primary)]" aria-hidden="true">{LABELS[levels[index]]}</p>
        <p className="mb-3 text-center text-[11px] text-[var(--text-muted)]">Más razonamiento responde mejor, pero tarda y consume más.</p>
        <input
          type="range"
          min={0}
          max={levels.length - 1}
          step={1}
          value={index}
          disabled={levels.length < 2}
          aria-label="Nivel de razonamiento"
          aria-valuetext={LABELS[levels[index]]}
          className="w-full accent-[var(--accent-primary)]"
          onChange={(event) => setIndex(Number(event.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
        <div className="mt-1 flex justify-between text-[10px] text-[var(--text-muted)]" aria-hidden="true">
          <span>{LABELS[levels[0]]}</span>
          <span>{LABELS[levels[levels.length - 1]]}</span>
        </div>
      </div>, document.body,
    )}
  </>;
}
