import { useEffect, useRef } from 'react';
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
      ? 'bg-accent-red hover:opacity-90 border-accent-red'
      : 'bg-accent-orange hover:bg-accent-orange-hover border-accent-orange';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 72%, transparent)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === overlayRef.current) handleCancel();
      }}
    >
      <div className="w-full max-w-md bg-dark-surface border border-bdr-medium rounded-2xl shadow-elevated p-6 animate-scale-in">
        <h3 className="text-lg font-bold text-txt-primary mb-2">{title}</h3>
        {description && <p className="text-sm text-txt-secondary mb-6 leading-relaxed">{description}</p>}

        <div className="flex items-center justify-end gap-3">
          {type !== 'alert' && (
            <button
              onClick={handleCancel}
              className="px-5 py-2 rounded-btn text-sm font-medium text-txt-secondary border border-bdr-medium hover:border-bdr-active hover:text-txt-primary transition-all"
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`px-5 py-2 rounded-btn text-sm font-medium text-[var(--text-on-accent)] border transition-all ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
