export async function acknowledgeCanvasFlush(): Promise<void> {
  const bridge = window.electronAPI;
  if (bridge?.canvasFlushAck) {
    await bridge.canvasFlushAck();
    return;
  }
  if (bridge?.invoke) await bridge.invoke('canvas-flush-ack', {});
}
