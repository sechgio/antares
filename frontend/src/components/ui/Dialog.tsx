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

  const confirmClasses =
    type === 'destructive'
      ? 'bg-[var(--accent-red)] hover:opacity-90 border-[var(--accent-red)]'
      : 'bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] border-[var(--accent-primary)]';

  const Icon = type === 'destructive' ? AlertTriangle : type === 'alert' ? ShieldCheck : Info;
  const iconClasses =
    type === 'destructive'
      ? 'border-[var(--accent-red)] bg-[var(--bg-elevated)] text-[var(--accent-red)]'
      : 'border-[var(--accent-primary)] bg-[var(--bg-elevated)] text-[var(--accent-primary-hover)]';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 72%, transparent)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === overlayRef.current) handleCancel();
      }}
    >
      <div className="w-full max-w-[28rem] rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] p-5 shadow-elevated animate-scale-in">
        <div className="mb-5 flex items-start gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${iconClasses}`}>
            <Icon size={20} strokeWidth={1.9} />
          </div>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-[16px] font-semibold leading-6 text-[var(--text-primary)]">{title}</h3>
            {description && <p className="mt-1.5 text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {type !== 'alert' && (
            <button
              onClick={handleCancel}
              className="rounded-md border border-[var(--border-medium)] px-4 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-all hover:border-[var(--border-active)] hover:text-[var(--text-primary)]"
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`rounded-md border px-4 py-2 text-[13px] font-semibold text-[var(--text-on-accent)] transition-all ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
