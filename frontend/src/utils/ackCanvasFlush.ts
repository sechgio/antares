export async function acknowledgeCanvasFlush(): Promise<void> {
  await window.electronAPI?.canvasFlushAck?.();
}
