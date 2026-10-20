import { useCallback } from 'react';
import { errorMessage } from '../utils/errors';
import { useToast } from './useToast';

interface ToastActionOptions {
  success?: string;
  error: string;
  rethrow?: boolean;
}

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
