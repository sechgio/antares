import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

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
}: ModalShellProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const maxWidth = size === 'md' ? 'max-w-md' : 'max-w-sm';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--bg-base) 85%, transparent)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        className={`w-full ${maxWidth} animate-scale-in rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)]`}
        style={{
          boxShadow:
            '0 24px 48px color-mix(in srgb, var(--bg-base) 55%, transparent), 0 0 0 1px color-mix(in srgb, var(--border-subtle) 80%, transparent)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="espacios-modal-title"
      >
        <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
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
            <h2 id="espacios-modal-title" className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}