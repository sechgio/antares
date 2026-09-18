export function createFrameRectCache(
  frame: HTMLElement,
  zoomRef: { current: number },
): { read: () => DOMRect } {
  let zoom = zoomRef.current;
  let rect = frame.getBoundingClientRect();
  return {
    read() {
      if (zoomRef.current !== zoom) {
        zoom = zoomRef.current;
        rect = frame.getBoundingClientRect();
      }
      return rect;
    },
  };
}
