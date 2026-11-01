import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Mide el alto del viewport de virtualización: fija el alto inicial al activarse
 * y lo mantiene al día con un ResizeObserver mientras la medición siga activa.
 */
export function useViewportHeight(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => setHeight(Math.floor(el.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return { containerRef, height };
}
