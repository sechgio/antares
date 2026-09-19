import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import Button from '../../ui/Button';

interface ModalShellProps {
  open: boolean;
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconColor?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md';
  placement?: 'center' | 'right';
  closeDisabled?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export default function ModalShell({
  open,
  title,
  description,
  icon: Icon,
  iconColor = 'var(--accent-primary)',
  onClose,
  children,
  footer,
  size = 'sm',
  placement = 'center',
  closeDisabled = false,
  initialFocusRef,
}: ModalShellProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const isDrawer = placement === 'right';

  useFocusTrap(dialogRef, open, initialFocusRef);

  useEffect(() => {
    if (!open || closeDisabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Let a nested date/status/priority picker consume Escape first.
      if (dialogRef.current?.querySelector('[aria-expanded="true"]')) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeDisabled, onClose]);

  if (!open) return null;

  const maxWidth = size === 'md' ? 'max-w-md' : 'max-w-sm';

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-50 flex ${isDrawer ? 'justify-end' : 'items-center justify-center p-4 animate-fade-in'}`}
      style={{
        backgroundColor: `color-mix(in srgb, var(--bg-base) ${isDrawer ? 30 : 85}%, transparent)`,
        backdropFilter: isDrawer ? undefined : 'blur(6px)',
      }}
      onClick={(e) => {
        if (!closeDisabled && e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`flex w-full min-h-0 flex-col border-[var(--border-subtle)] bg-[var(--bg-base)] ${
          isDrawer
            ? 'h-full max-w-xl border-l shadow-2xl'
            : `${maxWidth} max-h-[calc(100dvh-2rem)] animate-scale-in rounded-2xl border`
        }`}
        data-placement={placement}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          {Icon && (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: `color-mix(in srgb, ${iconColor} 14%, transparent)`,
                color: iconColor,
              }}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={closeDisabled}
            className="shrink-0"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_60%,transparent)] px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
