import { useEffect, useRef } from 'react';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  const attr = target.getAttribute('contenteditable');
  return attr === '' || attr === 'true';
}

// Una vista a pantalla completa puede declarar que sus atajos mandan sobre los
// del shell mientras está activa. Canvas usa Ctrl+0, Ctrl+Shift+I y Ctrl+Shift+V,
// que App también capturaba: el shell se registra en fase capture sobre window,
// su handler corre antes que el de la vista y preventDefault no detiene la
// propagación, así que ambos se ejecutaban y el usuario salía despedido del
// editor justo al usar un atajo documentado del propio Canvas.
const shellShortcutOwners = new Set<string>();

export function claimShellShortcuts(owner: string, claim: boolean): void {
  if (claim) shellShortcutOwners.add(owner);
  else shellShortcutOwners.delete(owner);
}

function isModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector(
    '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
  ) !== null;
}

export function useKeyboardShortcut(
  key: string,
  callback: (e: KeyboardEvent) => void,
  options?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    preventDefault?: boolean;
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
        // Con un modal abierto el atajo desmontaba la vista que esperaba el
        // diálogo (ErrorBoundary lleva key={activeTab}) y dejaba el diálogo
        // huérfano sobre otra herramienta.
        if (isModalOpen()) return;
        if (shellShortcutOwners.size > 0) return;
        if (opts?.preventDefault !== false) e.preventDefault();
        callbackRef.current(e);
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [key]);
}
