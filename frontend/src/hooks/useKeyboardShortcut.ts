import { useEffect, useCallback } from 'react';

export function useKeyboardShortcut(
  key: string,
  callback: (e: KeyboardEvent) => void,
  options?: { ctrl?: boolean; shift?: boolean; alt?: boolean; preventDefault?: boolean }
) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      const ctrlOk = !options?.ctrl || e.ctrlKey || e.metaKey;
      const shiftOk = !options?.shift || e.shiftKey;
      const altOk = !options?.alt || e.altKey;

      if (e.key.toLowerCase() === key.toLowerCase() && ctrlOk && shiftOk && altOk) {
        if (options?.preventDefault !== false) e.preventDefault();
        callback(e);
      }
    },
    [key, callback, options]
  );

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}
