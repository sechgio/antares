import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Hand, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AgentApprovalRules, AgentChannelRule, AgentPermissionMode, AgentRuleAudit } from '../../api/agentApi';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';
import { CHANNELS, CHANNEL_ORDER, channelLabel } from './channels';

const RULE_LABELS: Record<AgentChannelRule, string> = { ask: 'Preguntar', allow: 'Permitir', deny: 'Bloquear' };

function ruleLabel(rule: AgentChannelRule | null): string {
  return rule ? RULE_LABELS[rule] : 'Heredar';
}

const MODES = [
  { value: 'ask', label: 'Solicitar aprobación', description: 'Confirmar acciones sensibles y consultas web', Icon: Hand },
  { value: 'auto', label: 'Aprobar por mí', description: 'Confirmar acciones sensibles; consultar la web sin preguntar', Icon: ShieldCheck },
  { value: 'full', label: 'Acceso completo', description: 'Ejecutar acciones habilitadas sin confirmar salvo terminal', Icon: ShieldAlert },
] satisfies { value: AgentPermissionMode; label: string; description: string; Icon: typeof Hand }[];

export default function PermissionPicker({ value, onChange, disabled, pending, rules, onRulesChange, rulesBusy, globalRules, audit, onGlobalRulesChange, scope, onScopeChange }: {
  value: AgentPermissionMode;
  onChange: (mode: AgentPermissionMode) => void;
  disabled: boolean;
  pending: number;
  rules: AgentApprovalRules;
  onRulesChange: (rules: AgentApprovalRules) => void;
  rulesBusy: boolean;
  globalRules: AgentApprovalRules;
  audit: AgentRuleAudit[];
  onGlobalRulesChange: (rules: AgentApprovalRules) => void;
  scope: 'session' | 'global';
  onScopeChange: (scope: 'session' | 'global') => void;
}) {
  const id = useId();
  const [auditOpen, setAuditOpen] = useState(false);
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    estimatedWidth: 340,
    estimatedHeight: 520,
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
  const scopedRules = scope === 'global' ? globalRules : rules;
  const changeScopedRules = scope === 'global' ? onGlobalRulesChange : onRulesChange;
  const recentAudit = useMemo(() => [...audit].sort((a, b) => b.at - a.at).slice(0, 5), [audit]);

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
    if (event.target instanceof HTMLSelectElement) return;
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
        className="custom-scrollbar fixed z-[300] overflow-y-auto rounded-xl border border-[var(--border-medium)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_92%,var(--text-primary))] p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
        style={{ top: menu.position?.top ?? -9999, left: menu.position?.left ?? -9999, width: menu.position?.width ?? 340, maxHeight: menu.position?.maxHeight, visibility: menu.position ? 'visible' : 'hidden' }}
        onKeyDown={handleKey}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && !event.currentTarget.contains(next) && next !== menu.triggerRef.current) close();
        }}
      >
        {MODES.map(({ value: mode, label, description, Icon: ModeIcon }) => (
          <Button
            key={mode}
            variant="none"
            size="none"
            role="menuitemradio"
            aria-checked={value === mode}
            tabIndex={value === mode ? 0 : -1}
            disabled={rulesBusy}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-normal transition-colors hover:bg-[color:color-mix(in_srgb,var(--bg-input)_85%,var(--text-primary))] focus-visible:bg-[color:color-mix(in_srgb,var(--bg-input)_85%,var(--text-primary))] focus-visible:outline-none disabled:opacity-50 ${value === mode ? 'bg-[color:color-mix(in_srgb,var(--bg-input)_85%,var(--text-primary))]' : ''} ${mode === 'full' ? 'text-orange-500' : 'text-[var(--text-primary)]'}`}
            onClick={() => {
              close();
              menu.triggerRef.current?.focus();
              if (mode !== value) onChange(mode);
            }}
          >
            <ModeIcon size={14} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] leading-4">{label}</span>
              <span className={`block text-[11px] leading-4 ${mode === 'full' ? '' : 'text-[var(--text-secondary)]'}`}>{description}</span>
            </span>
            <Check size={14} className={`shrink-0 ${value === mode ? '' : 'invisible'}`} aria-hidden="true" />
          </Button>
        ))}
        <div role="group" aria-label="Reglas por canal" className="mt-1.5 border-t border-[var(--border-subtle)] px-2.5 pb-1.5 pt-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] leading-4 text-[var(--text-primary)]">Reglas por canal</p>
            <select
              aria-label="Alcance de las reglas"
              className="h-6 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-1.5 text-[11px] text-[var(--text-primary)] outline-none disabled:opacity-50"
              value={scope}
              disabled={rulesBusy}
              onChange={(event) => onScopeChange(event.target.value === 'global' ? 'global' : 'session')}
            >
              <option value="session">Esta conversación</option>
              <option value="global">Todas las conversaciones</option>
            </select>
          </div>
          <p className="mb-1.5 text-[11px] leading-4 text-[var(--text-secondary)]">
            {scope === 'global'
              ? 'Se aplican a todas las conversaciones; las reglas de cada chat tienen prioridad.'
              : '«Heredar» usa el modo de arriba y no cambia nada. Las reglas se guardan con esta conversación.'}
          </p>
          <div className="space-y-1.5">
            {CHANNEL_ORDER.map((channel) => (
              <label key={channel} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]" title={CHANNELS[channel].description}>
                  {CHANNELS[channel].label}
                </span>
                <select
                  aria-label={`Regla para ${CHANNELS[channel].label}`}
                  className="h-7 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-1.5 text-[11px] text-[var(--text-primary)] outline-none disabled:opacity-50"
                  value={scopedRules[channel] ?? ''}
                  disabled={disabled || rulesBusy}
                  onChange={(event) => {
                    const next = { ...scopedRules };
                    const rule = event.target.value as AgentChannelRule | '';
                    if (rule) next[channel] = rule;
                    else delete next[channel];
                    changeScopedRules(next);
                  }}
                >
                  <option value="">Heredar</option>
                  <option value="ask">Preguntar</option>
                  <option value="allow" disabled={channel === 'terminal' || channel === 'other'}>Permitir</option>
                  <option value="deny">Bloquear</option>
                </select>
              </label>
            ))}
          </div>
        </div>
        {recentAudit.length > 0 && (
          <div className="mt-1.5 border-t border-[var(--border-subtle)] px-2.5 pb-1.5 pt-2">
            <button
              type="button"
              aria-expanded={auditOpen}
              className="w-full text-left text-[12px] leading-4 text-[var(--text-primary)]"
              onClick={() => setAuditOpen((open) => !open)}
            >
              Historial de reglas
            </button>
            {auditOpen && (
              <ul className="mt-1 space-y-1">
                {recentAudit.map((entry) => (
                  <li key={entry.id} className="text-[11px] leading-4 text-[var(--text-secondary)]">
                    {`${channelLabel(entry.channel) ?? entry.channel} · ${entry.scope === 'global' ? 'Todas las conversaciones' : 'Esta conversación'} · de «${ruleLabel(entry.from)}» a «${ruleLabel(entry.to)}»`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="mt-1.5 border-t border-[var(--border-subtle)] px-2.5 pb-1.5 pt-2 text-[11px] leading-4 text-[var(--text-secondary)]">
          {scope === 'global' ? 'Para todas las conversaciones.' : 'Solo para este chat.'} Conserva las herramientas y accesos habilitados.
          {' '}Acciones sensibles: comandos, escritorio y cambios en archivos o servicios.
        </p>
      </div>, document.body,
    )}
  </>;
}
