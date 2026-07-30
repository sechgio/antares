import { useEffect, useRef } from 'react';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  // jsdom often leaves isContentEditable false; also honor the attribute.
  const attr = target.getAttribute('contenteditable');
  return attr === '' || attr === 'true';
}

export function useKeyboardShortcut(
  key: string,
  callback: (e: KeyboardEvent) => void,
  options?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    preventDefault?: boolean;
    /** When true, fire even if focus is in an input/textarea/select/contentEditable. */
    allowInInput?: boolean;
  }
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
      if (!opts?.allowInInput && isEditableTarget(e.target)) return;

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
