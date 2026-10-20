type EditorFlushHandler = () => Promise<void> | void;

const flushHandlers = new Set<EditorFlushHandler>();

export function registerEditorFlushHandler(handler: EditorFlushHandler): () => void {
  flushHandlers.add(handler);
  return () => {
    flushHandlers.delete(handler);
  };
}

export async function flushEditorSessions(): Promise<{ flushed: number; errors: string[] }> {
  const errors: string[] = [];
  let flushed = 0;
  for (const handler of [...flushHandlers]) {
    try {
      await handler();
      flushed += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { flushed, errors };
}
