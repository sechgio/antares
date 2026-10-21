import { useEffect, useId, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Hand, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AgentPermissionMode } from '../../api/agentApi';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';

const MODES = [
  { value: 'ask', label: 'Solicitar aprobación', description: 'Confirmar cambios y acceso a internet', Icon: Hand },
  { value: 'auto', label: 'Aprobar por mí', description: 'Confirmar solo acciones que modifican datos', Icon: ShieldCheck },
  { value: 'full', label: 'Acceso completo', description: 'Sin confirmar; conserva los accesos habilitados', Icon: ShieldAlert },
] satisfies { value: AgentPermissionMode; label: string; description: string; Icon: typeof Hand }[];

export default function PermissionPicker({ value, onChange, disabled, pending }: {
  value: AgentPermissionMode;
  onChange: (mode: AgentPermissionMode) => void;
  disabled: boolean;
  pending: number;
}) {
  const id = useId();
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    estimatedWidth: 340,
    estimatedHeight: 132,
    direction: 'up',
    maxHeightCap: 260,
  });
  const selected = MODES.find((mode) => mode.value === value) ?? MODES[1];
  const { Icon } = selected;
  const { isOpen, close, popupRef } = menu;

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
    } else if (event.key === 'Tab') {
      close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
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
      className={`flex h-6 min-w-0 items-center gap-1 rounded-full px-1.5 text-[11px] transition-colors hover:bg-[var(--bg-input)] disabled:opacity-50 ${value === 'full' ? 'bg-[var(--bg-input)] text-orange-500' : 'text-[var(--text-muted)]'}`}
      aria-label={`Permisos: ${selected.label}`}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-controls={isOpen ? id : undefined}
      disabled={disabled}
      title={disabled ? 'Espera a que termine el turno para cambiar los permisos' : selected.description}
      onClick={menu.toggle}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          menu.open();
        }
      }}
    >
      <Icon size={12} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{selected.label}</span>
      {pending > 0 && <span className="shrink-0 text-[var(--accent-yellow)]" aria-label={`${pending} por aprobar`}>· {pending}</span>}
    </Button>
    {isOpen && createPortal(
      <div
        ref={popupRef}
        id={id}
        role="menu"
        aria-label="Permisos del agente"
        className="custom-scrollbar fixed z-[300] overflow-y-auto rounded-xl border border-[var(--border-medium)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_92%,var(--text-primary))] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
        style={{ top: menu.position?.top ?? -9999, left: menu.position?.left ?? -9999, width: menu.position?.width ?? 340, maxHeight: menu.position?.maxHeight, visibility: menu.position ? 'visible' : 'hidden' }}
        onKeyDown={handleKey}
      >
        <p className="px-2 pb-1 pt-0.5 text-[11px] leading-4 text-[var(--text-secondary)]">Permisos del agente</p>
        {MODES.map(({ value: mode, label, description, Icon: ModeIcon }) => (
          <Button
            key={mode}
            variant="none"
            size="none"
            role="menuitemradio"
            aria-checked={value === mode}
            tabIndex={value === mode ? 0 : -1}
            className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left font-normal transition-colors hover:bg-[color:color-mix(in_srgb,var(--bg-input)_85%,var(--text-primary))] focus-visible:bg-[color:color-mix(in_srgb,var(--bg-input)_85%,var(--text-primary))] focus-visible:outline-none ${value === mode ? 'bg-[color:color-mix(in_srgb,var(--bg-input)_85%,var(--text-primary))]' : ''} ${mode === 'full' ? 'text-orange-500' : 'text-[var(--text-primary)]'}`}
            onClick={() => {
              close();
              menu.triggerRef.current?.focus();
              if (mode !== value) onChange(mode);
            }}
          >
            <ModeIcon size={14} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] leading-4">{label}</span>
              <span className={`block text-[10px] leading-[13px] ${mode === 'full' ? '' : 'text-[var(--text-secondary)]'}`}>{description}</span>
            </span>
            <Check size={14} className={`shrink-0 ${value === mode ? '' : 'invisible'}`} aria-hidden="true" />
          </Button>
        ))}
      </div>, document.body,
    )}
  </>;
}
