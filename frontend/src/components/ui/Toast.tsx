
import { useToast, type ToastItem } from '../../hooks/useToast';
import { memo } from 'react';

const typeStyles: Record<string, { bg: string; border: string; icon: string }> = {
  success: { bg: 'bg-accent-green/10', border: 'border-accent-green/20', icon: 'text-accent-green' },
  error: { bg: 'bg-accent-red/10', border: 'border-accent-red/20', icon: 'text-accent-red' },
  warning: { bg: 'bg-accent-yellow/10', border: 'border-accent-yellow/20', icon: 'text-accent-yellow' },
  info: { bg: 'bg-accent-blue/10', border: 'border-accent-blue/20', icon: 'text-accent-blue' },
};

const ToastItem = memo(function ToastItem({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  const styles = typeStyles[toast.type] || typeStyles.info;

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border ${styles.bg} ${styles.border} shadow-lg min-w-[280px] max-w-[400px] animate-slide-left`}
    >
      <div className={`mt-0.5 ${styles.icon}`}>
        {toast.type === 'success' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        )}
        {toast.type === 'error' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        )}
        {toast.type === 'warning' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        )}
        {toast.type === 'info' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-txt-primary leading-snug">{toast.message}</p>
        {toast.action && (
          <button
            onClick={() => { toast.action?.onClick(); onRemove(toast.id); }}
            className="mt-1.5 text-xs font-semibold text-accent-orange hover:text-accent-orange-hover underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="text-txt-muted hover:text-txt-primary transition-colors shrink-0 mt-0.5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
});

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="fixed top-4 right-4 z-[90] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}
