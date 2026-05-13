import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return () => {
      // Clear all pending timeouts on unmount
      for (const tid of toastTimeouts.values()) {
        clearTimeout(tid);
      }
      toastTimeouts.clear();
    };
  }, []);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);

    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      const tid = setTimeout(() => {
        toastTimeouts.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
      toastTimeouts.set(id, tid);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    const tid = toastTimeouts.get(id);
    if (tid) {
      clearTimeout(tid);
      toastTimeouts.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
