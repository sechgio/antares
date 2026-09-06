import { memo } from 'react';
import { useToast, type ToastItem } from '../../hooks/useToast';

const typeIcon: Record<string, string> = {
  success: 'text-[var(--accent-green)]',
  error: 'text-[var(--accent-red)]',
  warning: 'text-[var(--accent-yellow)]',
  info: 'text-[var(--accent-blue)]',
};

const ToastCard = memo(function ToastCard({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  const iconClass = typeIcon[toast.type] || typeIcon.info;

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-testid="app-toast"
      className="pointer-events-auto flex max-w-[min(400px,calc(100vw-2rem))] items-center gap-2 rounded-full border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[var(--text-primary)] shadow-lg animate-slide-left"
    >
      <div className={`shrink-0 ${iconClass}`} aria-hidden="true">
        {toast.type === 'success' && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        )}
        {toast.type === 'error' && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        )}
        {toast.type === 'warning' && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        )}
        {toast.type === 'info' && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-snug text-[var(--text-primary)]">{toast.message}</p>
        {toast.action && (
          <button
            type="button"
            onClick={() => { toast.action?.onClick(); onRemove(toast.id); }}
            className="mt-1 text-[11px] font-semibold text-[var(--accent-primary)] underline hover:text-[var(--accent-primary-hover)]"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Cerrar notificación"
        onClick={() => onRemove(toast.id)}
        className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
});

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div
      data-testid="app-toast-container"
      className="pointer-events-none fixed top-20 right-4 z-[200] flex flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}
