import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';

export interface DialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'confirm' | 'alert' | 'destructive';
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface DialogContextValue {
  isOpen: boolean;
  options: DialogOptions | null;
  openDialog: (options: DialogOptions) => void;
  closeDialog: () => void;
  confirm: (options: Omit<DialogOptions, 'onConfirm' | 'onCancel'>) => Promise<boolean>;
  alert: (options: Omit<DialogOptions, 'type' | 'cancelLabel' | 'onConfirm' | 'onCancel'>) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<DialogOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const alertResolverRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
      if (alertResolverRef.current) {
        alertResolverRef.current();
        alertResolverRef.current = null;
      }
    };
  }, []);

  const openDialog = useCallback((opts: DialogOptions) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    if (alertResolverRef.current) {
      alertResolverRef.current();
      alertResolverRef.current = null;
    }
    setOptions(opts);
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    // Toda salida del diálogo debe resolver la promesa pendiente. Escape, el
    // clic en el overlay y openDialog llegaban aquí sin pasar por onCancel, así
    // que el resolver se descartaba sin llamarse y el `await confirm(...)` del
    // llamador quedaba colgado para siempre (en el peor caso, sin poder salir
    // de la vista). Las promesas ya resueltas por onConfirm/onCancel ignoran
    // esta segunda llamada, así que el camino normal no cambia.
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    if (alertResolverRef.current) {
      alertResolverRef.current();
      alertResolverRef.current = null;
    }
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (mountedRef.current) setOptions(null);
    }, 200);
  }, []);

  const confirm = useCallback((opts: Omit<DialogOptions, 'onConfirm' | 'onCancel'>): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!mountedRef.current) { resolve(false); return; }
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setOptions({
        ...opts,
        type: opts.type ?? 'confirm',
        onConfirm: () => {
          resolve(true);
          closeDialog();
        },
        onCancel: () => {
          resolve(false);
          closeDialog();
        },
      });
      setIsOpen(true);
    });
  }, [closeDialog]);

  const alert = useCallback((opts: Omit<DialogOptions, 'type' | 'cancelLabel' | 'onConfirm' | 'onCancel'>): Promise<void> => {
    return new Promise((resolve) => {
      if (!mountedRef.current) { resolve(); return; }
      if (alertResolverRef.current) alertResolverRef.current();
      alertResolverRef.current = resolve;
      setOptions({
        ...opts,
        type: 'alert',
        onConfirm: () => {
          resolve();
          closeDialog();
        },
      });
      setIsOpen(true);
    });
  }, [closeDialog]);

  const value = useMemo(
    () => ({ isOpen, options, openDialog, closeDialog, confirm, alert }),
    [isOpen, options, openDialog, closeDialog, confirm, alert],
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}
