/** Resolve Ctrl/Cmd+Z / Shift+Z / Y to undo|redo. Uses `code` so Shift/CapsLock work. */
export function matchHistoryShortcut(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  code: string;
}): 'undo' | 'redo' | null {
  if (!e.ctrlKey && !e.metaKey) return null;
  if (e.code === 'KeyY') return 'redo';
  if (e.code === 'KeyZ') return e.shiftKey ? 'redo' : 'undo';
  return null;
}
