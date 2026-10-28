import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, RotateCcw, Zap } from 'lucide-react';
import type { AgentReasoningEffort } from '../../api/agentApi';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';

const ORDER: AgentReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const LABELS: Record<AgentReasoningEffort, string> = {
  minimal: 'Mínimo',
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'Extra alto',
  max: 'Máximo',
};

function effective(levels: AgentReasoningEffort[], value: AgentReasoningEffort) {
  const below = levels.filter((level) => ORDER.indexOf(level) <= ORDER.indexOf(value));
  return below[below.length - 1] ?? levels[0];
}

export default function ReasoningPicker({ levels, value, model, onChange, disabled }: {
  levels: AgentReasoningEffort[];
  value: AgentReasoningEffort;
  model: string;
  onChange: (effort: AgentReasoningEffort) => void;
  disabled: boolean;
}) {
  const id = useId();
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    estimatedWidth: 260,
    estimatedHeight: 100,
    direction: 'up',
    align: 'end',
  });
  const { isOpen, close, popupRef } = menu;
  const current = levels.indexOf(effective(levels, value));
  const [index, setIndex] = useState(current);
  const defaultLevel = effective(levels, 'low');
  const progress = levels.length > 1 ? index / (levels.length - 1) * 100 : 0;

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
      className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50 ${isOpen ? 'bg-[var(--bg-input)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
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
        className="agent-popover-in agent-effort-menu fixed z-[300] rounded-[20px] border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 shadow-md"
        style={{ top: menu.position?.top ?? -9999, left: menu.position?.left ?? -9999, width: menu.position?.width ?? 260, visibility: menu.position ? 'visible' : 'hidden', transformOrigin: 'bottom right' }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          close();
          menu.triggerRef.current?.focus();
        }}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
            && !menu.triggerRef.current?.contains(event.relatedTarget)) close();
        }}
      >
        <div className="mb-2 flex items-start gap-2">
          <Zap size={14} className="mt-1 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[13px] font-medium text-[var(--accent-blue)]" aria-hidden="true">{LABELS[levels[index]]}</p>
            <p className="truncate text-[12px] text-[var(--text-secondary)]" title={model}>{model}</p>
          </div>
          <Button
            variant="none"
            size="none"
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
            aria-label={`Restablecer razonamiento a ${LABELS[defaultLevel]}`}
            title={`Restablecer a ${LABELS[defaultLevel]}`}
            disabled={levels[current] === defaultLevel && levels[index] === defaultLevel}
            onClick={() => {
              setIndex(levels.indexOf(defaultLevel));
              if (levels[current] !== defaultLevel) onChange(defaultLevel);
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </Button>
        </div>
        <div className="agent-effort-track" style={{ background: `linear-gradient(to right, var(--accent-blue) ${progress}%, var(--bg-input) ${progress}%)` }}>
          <div className="agent-effort-steps" aria-hidden="true">
            {levels.map((level) => <span key={level} />)}
          </div>
          <input
            type="range"
            min={0}
            max={levels.length - 1}
            step={1}
            value={index}
            disabled={levels.length < 2}
            aria-label="Nivel de razonamiento"
            aria-valuetext={LABELS[levels[index]]}
            aria-describedby={`${id}-hint`}
            className="agent-effort-slider"
            onChange={(event) => setIndex(Number(event.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
          />
        </div>
        <p id={`${id}-hint`} className="sr-only">Más razonamiento puede tardar y consumir más.</p>
      </div>, document.body,
    )}
  </>;
}
