import { useEffect, useId, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Hand, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AgentApprovalRules, AgentPermissionMode } from '../../api/agentApi';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';

const MODES = [
  { value: 'ask', label: 'Solicitar aprobación', description: 'Pregunta antes de acciones sensibles y webs', Icon: Hand },
  { value: 'auto', label: 'Aprobar por mí', description: 'Pregunta lo sensible; la web va sola', Icon: ShieldCheck },
  { value: 'full', label: 'Acceso completo', description: 'Sin preguntar, salvo el terminal', Icon: ShieldAlert },
] satisfies { value: AgentPermissionMode; label: string; description: string; Icon: typeof Hand }[];

export default function PermissionPicker({ value, onChange, disabled, pending, rules, globalRules }: {
  value: AgentPermissionMode;
  onChange: (mode: AgentPermissionMode) => void;
  disabled: boolean;
  pending: number;
  rules: AgentApprovalRules;
  globalRules: AgentApprovalRules;
}) {
  const id = useId();
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    estimatedWidth: 280,
    estimatedHeight: 260,
    direction: 'up',
    maxHeightCap: 560,
  });
  const selected = MODES.find((mode) => mode.value === value) ?? MODES[1];
  const { Icon } = selected;
  const { isOpen, close, popupRef } = menu;
  const ruleCount = Object.keys(rules).length;
  const ruleSummary = ruleCount ? `${ruleCount} regla${ruleCount === 1 ? '' : 's'} por canal` : '';
  const globalRuleCount = Object.keys(globalRules).length;
  const globalRuleSummary = globalRuleCount ? `${globalRuleCount} regla${globalRuleCount === 1 ? '' : 's'} global${globalRuleCount === 1 ? '' : 'es'}` : '';

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  useEffect(() => {
    if (!isOpen) return;
    popupRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [isOpen, popupRef]);

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      menu.triggerRef.current?.focus();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(popupRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
      const current = items.findIndex((item) => item === document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    }
  };

  return <>
    <Button
      ref={menu.triggerRef}
      variant="none"
      size="none"
      className={`flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors hover:bg-[var(--bg-input)] disabled:opacity-50 ${value === 'full' ? 'bg-[var(--bg-input)] text-orange-500' : 'text-[var(--text-muted)]'}`}
      aria-label={`Permisos: ${selected.label}${ruleSummary ? `, ${ruleSummary}` : ''}`}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-controls={isOpen ? id : undefined}
      disabled={disabled}
      title={disabled ? 'Espera a que termine el turno para cambiar los permisos' : `${selected.description}${ruleSummary ? ` · ${ruleSummary}` : ''}${globalRuleSummary ? ` · ${globalRuleSummary}` : ''}`}
      onClick={menu.toggle}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          menu.open();
        }
      }}
    >
      <Icon size={12} className="shrink-0" aria-hidden="true" />
      <span className="agent-permission-label truncate">{selected.label}</span>
      {pending > 0 && <span className="shrink-0 text-[var(--accent-yellow)]" aria-label={`${pending} por aprobar`}>· {pending}</span>}
    </Button>
    {isOpen && createPortal(
      <div
        ref={popupRef}
        id={id}
        role="menu"
        aria-label="Permisos del agente"
        className="custom-scrollbar fixed z-[300] overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
        style={{ top: menu.position?.top ?? -9999, left: menu.position?.left ?? -9999, width: menu.position?.width ?? 280, maxHeight: menu.position?.maxHeight, visibility: menu.position ? 'visible' : 'hidden' }}
        onKeyDown={handleKey}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && !event.currentTarget.contains(next) && next !== menu.triggerRef.current) close();
        }}
      >
        <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-[var(--text-muted)]">Permisos · esta conversación</p>
        {MODES.map(({ value: mode, label, description }) => (
          <Button
            key={mode}
            variant="none"
            size="none"
            role="menuitemradio"
            aria-checked={value === mode}
            tabIndex={value === mode ? 0 : -1}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left font-normal transition-colors hover:bg-[var(--bg-input)] focus-visible:bg-[var(--bg-input)] focus-visible:outline-none disabled:opacity-50"
            onClick={() => {
              close();
              menu.triggerRef.current?.focus();
              if (mode !== value) onChange(mode);
            }}
          >
            <span className="min-w-0 flex-1">
              <span className={`block text-[13px] font-medium leading-5 ${mode === 'full' ? 'text-orange-500' : 'text-[var(--text-primary)]'}`}>{label}</span>
              <span className="block text-[12px] leading-4 text-[var(--text-muted)]">{description}</span>
            </span>
            <Check size={16} className={`shrink-0 text-[var(--accent-blue)] ${value === mode ? '' : 'invisible'}`} aria-hidden="true" />
          </Button>
        ))}
      </div>, document.body,
    )}
  </>;
}
