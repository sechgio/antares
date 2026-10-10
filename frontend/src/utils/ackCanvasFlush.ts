export async function acknowledgeCanvasFlush(): Promise<void> {
  await window.electronAPI?.canvasFlushAck?.();
}

// El proceso principal da por terminado el flush con el primer ack que recibe.
// Mientras Canvas tiene su handler suscrito, solo él puede acusar: así el ack
// llega después de guardar y no antes. App cubre la ventana en que el chunk
// lazy de Canvas aún no se ha suscrito.
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
