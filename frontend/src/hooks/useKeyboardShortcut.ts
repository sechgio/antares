import { useEffect, useRef } from 'react';

export function useKeyboardShortcut(
  key: string,
  callback: (e: KeyboardEvent) => void,
  options?: { ctrl?: boolean; shift?: boolean; alt?: boolean; preventDefault?: boolean }
) {
  const callbackRef = useRef(callback);
  const optionsRef = useRef(options);

  useEffect(() => {
    callbackRef.current = callback;
    optionsRef.current = options;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const opts = optionsRef.current;
      const normalizedKey = key.toLowerCase();
      const ctrlOk = !opts?.ctrl || e.ctrlKey || e.metaKey;
      const shiftOk = !opts?.shift || e.shiftKey;
      const altOk = !opts?.alt || e.altKey;
      const keyOk = e.key.toLowerCase() === normalizedKey || e.code.toLowerCase() === `key${normalizedKey}`;

      if (keyOk && ctrlOk && shiftOk && altOk) {
        if (opts?.preventDefault !== false) e.preventDefault();
        callbackRef.current(e);
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [key]);
}
