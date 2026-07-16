import { Bell } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDueNotifications } from '../espacios/hooks/useDueNotifications';
import { formatRelativeDate } from '../espacios/utils/dates';
import type { DueNotification, DueUrgency } from '../espacios/utils/dueNotifications';
import { writeEspaciosFocusTarget } from '../espacios/utils/focusTarget';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface TaskNotificationsBellProps {
  onOpenEspacios?: () => void;
}

interface MenuPosition {
  top: number;
  right: number;
}

const URGENCY_DOT: Record<DueUrgency, string> = {
  overdue: 'var(--accent-red)',
  today: 'var(--accent-yellow)',
  soon: 'var(--accent-primary)',
};

const URGENCY_LABEL: Record<DueUrgency, string> = {
  overdue: 'Vencida',
  today: 'Vence hoy',
  soon: 'Próxima',
};

export default function TaskNotificationsBell({ onOpenEspacios }: TaskNotificationsBellProps) {
  const { items, count, loading, error, refresh } = useDueNotifications(true);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
    void refresh();
  }, [open, refresh, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onLayout = () => updatePosition();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, updatePosition]);

  const handleSelect = (item: DueNotification) => {
    writeEspaciosFocusTarget({
      tareaId: item.id,
      proyectoId: item.proyecto_id,
      espacioId: item.espacio_id,
    });
    setOpen(false);
    onOpenEspacios?.();
  };

  const badgeLabel = count > 9 ? '9+' : String(count);
  const tooltipLabel = count > 0 ? `${count} tarea${count === 1 ? '' : 's'} por vencer` : 'Notificaciones';

  return (
    <>
      <div className="group relative flex h-full">
        <button
          ref={triggerRef}
          type="button"
          data-testid="titlebar-notifications-button"
          aria-label={count > 0 ? `Notificaciones: ${count} tareas por vencer` : 'Notificaciones de tareas'}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="app-titlebar-button relative flex h-full w-10 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Bell size={14} strokeWidth={1.8} />
          {count > 0 && (
            <span
              className="absolute right-1.5 top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent-red)] px-0.5 text-[9px] font-semibold leading-none text-[var(--text-on-accent)]"
              aria-hidden
            >
              {badgeLabel}
            </span>
          )}
        </button>
        {!open && (
          <HoverTooltip label={tooltipLabel} placement="bottom" groupHoverClass="group-hover:opacity-100" />
        )}
      </div>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Tareas cercanas a vencer"
            className="fixed z-[220] w-[320px] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] shadow-[0_16px_48px_color-mix(in_srgb,var(--bg-base)_60%,transparent),0_0_0_1px_color-mix(in_srgb,var(--border-subtle)_80%,transparent)]"
            style={
              position
                ? { top: position.top, right: position.right }
                : { top: -9999, right: 0, visibility: 'hidden' }
            }
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2.5">
              <div>
                <p className="text-[12px] font-semibold text-[var(--text-primary)]">Vencimientos</p>
                <p className="text-[11px] text-[var(--text-muted)]">Tareas de Espacios · próximos 3 días</p>
              </div>
              {count > 0 && (
                <span className="rounded-full bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-primary)]">
                  {count}
                </span>
              )}
            </div>

            <div className="max-h-[360px] overflow-y-auto p-1">
              {loading && items.length === 0 && (
                <p className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">Cargando…</p>
              )}

              {!loading && error && (
                <div className="px-3 py-4 text-center">
                  <p className="text-[12px] text-[var(--text-secondary)]">{error}</p>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="mt-2 text-[11px] font-medium text-[var(--accent-primary)] hover:underline"
                  >
                    Reintentar
                  </button>
                </div>
              )}

              {!loading && !error && items.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <Bell className="mx-auto mb-2 h-5 w-5 text-[var(--text-muted)] opacity-50" strokeWidth={1.5} />
                  <p className="text-[12px] font-medium text-[var(--text-secondary)]">Todo al día</p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    No hay tareas vencidas ni por vencer
                  </p>
                </div>
              )}

              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-base)]/70"
                >
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: URGENCY_DOT[item.urgency] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                      {item.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
                      <span className="truncate">{item.proyecto_name}</span>
                      <span aria-hidden>·</span>
                      <span
                        className={
                          item.urgency === 'overdue'
                            ? 'font-medium text-[var(--accent-red)]'
                            : item.urgency === 'today'
                              ? 'font-medium text-[var(--accent-yellow)]'
                              : undefined
                        }
                      >
                        {formatRelativeDate(item.due_date)}
                      </span>
                      <span className="rounded px-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        {URGENCY_LABEL[item.urgency]}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {onOpenEspacios && (
              <div className="border-t border-[var(--border-subtle)] p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenEspacios();
                  }}
                  className="w-full rounded-lg px-2.5 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-base)]/70 hover:text-[var(--text-primary)]"
                >
                  Ir a Espacios
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
