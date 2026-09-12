import { useEffect, useRef } from 'react';

export function useContextMenuSurface(x: number, y: number, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [onClose]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const padding = 8;
    const rect = element.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - padding) {
      left = window.innerWidth - rect.width - padding;
    }
    if (top + rect.height > window.innerHeight - padding) {
      top = window.innerHeight - rect.height - padding;
    }
    element.style.left = `${Math.max(padding, left)}px`;
    element.style.top = `${Math.max(padding, top)}px`;
  }, [x, y]);

  return ref;
}
