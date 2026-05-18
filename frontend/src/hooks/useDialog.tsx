import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

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
    // Cancel any pending close timer and resolve/reject previous pending promises
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
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (mountedRef.current) {
        setOptions(null);
        resolverRef.current = null;
        alertResolverRef.current = null;
      }
    }, 200);
  }, []);

  const confirm = useCallback((opts: Omit<DialogOptions, 'onConfirm' | 'onCancel'>): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!mountedRef.current) { resolve(false); return; }
      // Resolve any previous pending promise before creating a new one
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setOptions({
        ...opts,
        type: 'confirm',
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
      // Resolve any previous pending alert promise before creating a new one
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

  return (
    <DialogContext.Provider value={{ isOpen, options, openDialog, closeDialog, confirm, alert }}>
      {children}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}
