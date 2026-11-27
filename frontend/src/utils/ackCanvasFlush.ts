export async function acknowledgeCanvasFlush(): Promise<void> {
  await window.electronAPI?.canvasFlushAck?.();
}

let canvasFlushOwners = 0;

export function registerCanvasFlushOwner(): () => void {
  canvasFlushOwners += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    canvasFlushOwners -= 1;
  };
}

export function hasCanvasFlushOwner(): boolean {
  return canvasFlushOwners > 0;
}
