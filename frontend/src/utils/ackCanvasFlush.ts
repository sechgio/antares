import { flushEditorSessions } from '../components/editor/runtime/editorLifecycle';

export async function acknowledgeCanvasFlush(): Promise<void> {
  const { errors } = await flushEditorSessions();
  if (errors.length > 0) {
    await window.electronAPI?.canvasFlushAck?.(false);
    throw new Error(errors.join('\n'));
  }
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
