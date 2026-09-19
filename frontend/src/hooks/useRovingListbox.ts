import { useEffect, type KeyboardEvent, type RefObject } from 'react';

/**
 * Navegación tipo listbox compartida: al abrir enfoca la opción seleccionada
 * (`aria-selected`), opcionalmente cayendo a la primera opción, y mueve el
 * foco con flechas/Home/End. Enter/Espacio elige la opción enfocada leyendo
 * su `data-value`.
 */
export function useRovingListbox(
  listRef: RefObject<HTMLElement | null>,
  open: boolean,
  pick: (value: string) => void,
  { focusFallback = false }: { focusFallback?: boolean } = {},
): (event: KeyboardEvent) => void {
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const selectedBtn = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (focusFallback) {
      (selectedBtn ?? list?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    } else {
      selectedBtn?.focus();
    }
  }, [open, listRef, focusFallback]);

  return (event: KeyboardEvent) => {
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    if (items.length === 0) return;
    const idx = items.findIndex((el) => el === document.activeElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(idx + 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      const val = active?.dataset.value;
      if (val != null) pick(val);
    }
  };
}
