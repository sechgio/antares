/** Acknowledge the main-process Canvas shutdown request. */
export async function acknowledgeCanvasFlush(): Promise<void> {
  const bridge = window.electronAPI;
  if (bridge?.canvasFlushAck) {
    await bridge.canvasFlushAck();
    return;
  }
  // Keep the fallback for a renderer that is hot-reloaded against an older
  // preload. Current preloads always expose the private bridge above.
  if (bridge?.invoke) await bridge.invoke('canvas-flush-ack', {});
}
