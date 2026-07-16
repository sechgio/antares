import { useEffect, useRef } from 'react';
import { AlertTriangle, Info, ShieldCheck } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';

export default function Dialog() {
  const { isOpen, options, closeDialog } = useDialog();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog();
    };
    if (isOpen) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeDialog]);

  if (!isOpen || !options) return null;

  const {
    title,
    description,
    confirmLabel = 'Aceptar',
    cancelLabel = 'Cancelar',
    type = 'confirm',
    onConfirm,
    onCancel,
  } = options;

  const handleConfirm = () => {
    onConfirm?.();
    closeDialog();
  };

  const handleCancel = () => {
    onCancel?.();
    closeDialog();
  };

  const isDestructive = type === 'destructive';
  const Icon = isDestructive ? AlertTriangle : type === 'alert' ? ShieldCheck : Info;
  const signal = isDestructive ? 'var(--accent-red)' : 'var(--accent-primary)';
  const signalHover = isDestructive ? 'var(--accent-red)' : 'var(--accent-primary-hover)';
  const confirmFg = isDestructive ? 'var(--text-on-danger, #fff)' : 'var(--text-on-accent)';

  return (
    <div
      ref={overlayRef}
      data-testid="app-dialog-overlay"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--bg-base) 88%, transparent)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => {
        if (e.target === overlayRef.current) handleCancel();
      }}
    >
      <div
        data-testid="app-dialog"
        className="w-full max-w-[28rem] rounded-xl p-5 animate-scale-in"
        style={{
          backgroundColor: 'var(--bg-base)',
          color: 'var(--text-primary)',
          border: '1px solid color-mix(in srgb, var(--accent-primary) 32%, var(--border-subtle))',
          boxShadow:
            '0 0 0 1px color-mix(in srgb, var(--accent-primary) 18%, transparent), 0 24px 64px color-mix(in srgb, var(--bg-base) 70%, transparent)',
        }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
      >
        <div className="mb-5 flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{
              color: signal,
              border: `1px solid ${signal}`,
              backgroundColor: `color-mix(in srgb, ${signal} 12%, var(--bg-surface))`,
            }}
          >
            <Icon size={20} strokeWidth={1.9} />
          </div>
          <div className="min-w-0 pt-0.5">
            <h3
              id="app-dialog-title"
              className="text-[16px] font-semibold leading-6"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </h3>
            {description && (
              <p className="mt-1.5 text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {type !== 'alert' && (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md px-4 py-2 text-[13px] font-medium transition-colors"
              style={{
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-medium)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent-primary)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-medium)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-md px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{
              color: confirmFg,
              backgroundColor: signal,
              border: `1px solid ${signalHover}`,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
