import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { reportFrontendError } from '../utils/observability';

type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  action?: { label: string; onClick: () => void };
  duration?: number;
  view?: string;
  error?: unknown;
}

interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timeouts = toastTimeouts.current;
    return () => {
      for (const tid of timeouts.values()) {
        clearTimeout(tid);
      }
      timeouts.clear();
    };
  }, []);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);

    if (toast.type === 'error') {
      let errName: string | undefined;
      let errStack: string | undefined;
      if (toast.error instanceof Error) {
        errName = toast.error.name;
        errStack = toast.error.stack;
      } else if (toast.error && typeof toast.error === 'object' && 'name' in toast.error) {
        errName = String((toast.error as { name: unknown }).name);
      }
      reportFrontendError({
        kind: 'toast_error',
        view: toast.view ?? 'toast',
        name: errName ?? 'ToastError',
        message: toast.message || (toast.error instanceof Error ? toast.error.message : String(toast.error || 'Toast error')),
        stack: errStack,
      });
    }

    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      const tid = setTimeout(() => {
        toastTimeouts.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
      toastTimeouts.current.set(id, tid);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    const tid = toastTimeouts.current.get(id);
    if (tid) {
      clearTimeout(tid);
      toastTimeouts.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toasts, addToast, removeToast }), [toasts, addToast, removeToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
