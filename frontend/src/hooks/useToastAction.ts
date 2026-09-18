import { useCallback } from 'react';
import { errorMessage } from '../utils/errors';
import { useToast } from './useToast';

export interface ToastActionOptions {
  /** Mensaje de éxito; si se omite no se emite toast al resolver. */
  success?: string;
  /** Fallback cuando el error no trae mensaje propio. */
  error: string;
  /** true (default): propaga el error tras el toast (formularios/modales).
   *  false: lo traga (patches fire-and-forget). */
  rethrow?: boolean;
}

// Ejecuta una acción async y publica el resultado vía toast: `success` al
// resolver, `errorMessage(err, error)` al rechazar.
export function useToastAction() {
  const { addToast } = useToast();
  return useCallback(
    async <T>(action: () => Promise<T>, opts: ToastActionOptions): Promise<T | undefined> => {
      try {
        const result = await action();
        if (opts.success) addToast({ message: opts.success, type: 'success' });
        return result;
      } catch (err) {
        addToast({ message: errorMessage(err, opts.error), type: 'error' });
        if (opts.rethrow === false) return undefined;
        throw err;
      }
    },
    [addToast],
  );
}
